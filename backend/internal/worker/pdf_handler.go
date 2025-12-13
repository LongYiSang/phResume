package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"strings"
	"time"

	"github.com/go-rod/rod"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

// PDFTaskHandler 负责消费 PDF 生成任务。
type PDFTaskHandler struct {
	db                 *gorm.DB
	storage            *storage.Client
	redisClient        *redis.Client
	logger             *slog.Logger
	internalSecret     string
	internalAPIBaseURL string
	frontendBaseURL    string
}

// NewPDFTaskHandler 创建任务处理器。
func NewPDFTaskHandler(
	db *gorm.DB,
	storage *storage.Client,
	redisClient *redis.Client,
	logger *slog.Logger,
	internalSecret string,
	internalAPIBaseURL string,
	frontendBaseURL string,
	internalAPIBaseURL string,
	frontendBaseURL string,
) *PDFTaskHandler {
	return &PDFTaskHandler{
		db:                 db,
		storage:            storage,
		redisClient:        redisClient,
		logger:             logger,
		internalSecret:     internalSecret,
		internalAPIBaseURL: strings.TrimRight(strings.TrimSpace(internalAPIBaseURL), "/"),
		frontendBaseURL:    strings.TrimRight(strings.TrimSpace(frontendBaseURL), "/"),
	}
}

// ProcessTask 实现 asynq.Handler。
func (h *PDFTaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	log := h.logger

	var payload tasks.PDFGeneratePayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		log.Error("unmarshal task payload failed", slog.Any("error", err))
		return err
	}

	log = log.With(
		slog.String("correlation_id", payload.CorrelationID),
		slog.Int("resume_id", int(payload.ResumeID)),
	)
	log.Info("Starting WYSIWYG PDF generation task...")

	var resume database.Resume
	if err := h.db.WithContext(ctx).First(&resume, payload.ResumeID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Warn("resume not found, skipping task")
			return nil
		}
		log.Error("query resume failed", slog.Any("error", err))
		return err
	}

	pdfBytes, page, cleanup, err := h.generatePDFFromFrontend(ctx, resume.ID)
	if err != nil {
		log.Error("generate pdf via frontend failed", slog.Any("error", err))
		return err
	}
	defer cleanup()

	objectName := fmt.Sprintf("generated-resumes/%d/%s.pdf", resume.UserID, uuid.NewString())
	pdfReader := bytes.NewReader(pdfBytes)
	if _, err := h.storage.UploadFile(ctx, objectName, pdfReader, int64(len(pdfBytes)), "application/pdf"); err != nil {
		log.Error("upload pdf to minio failed", slog.Any("error", err))
		return err
	}

	update := map[string]any{
		"pdf_url": objectName,
		"status":  "completed",
	}
	if err := h.db.WithContext(ctx).Model(&resume).Updates(update).Error; err != nil {
		log.Error("update resume failed", slog.Any("error", err))
		return err
	}

	message := map[string]any{
		"status":    "completed",
		"resume_id": resume.ID,
	}
	data, err := json.Marshal(message)
	if err != nil {
		log.Error("marshal notification payload failed", slog.Any("error", err))
		return err
	}

	channel := fmt.Sprintf("user_notify:%d", resume.UserID)
	if err := h.redisClient.Publish(ctx, channel, data).Err(); err != nil {
		log.Error("publish redis notification failed", slog.Any("error", err))
		return err
	}

	if err := h.generatePreviewImage(ctx, &resume, page); err != nil {
		log.Warn("generate resume preview failed", slog.Any("error", err))
	}

	log.Info("Published notification to channel", slog.String("channel", channel))
	log.Info("PDF generation task completed successfully.")
	return nil
}

func (h *PDFTaskHandler) generatePDFFromFrontend(ctx context.Context, resumeID uint) (_ []byte, page *rod.Page, cleanup func(), err error) {
	cleanup = func() {}
	defer func() {
		if err != nil {
			cleanup()
		}
	}()

	printData, err := fetchInternalPrintData(ctx, h.internalAPIBaseURL, resumePrintPath, resumeID, h.internalSecret)
	if err != nil {
		return nil, nil, cleanup, err
	}

	targetURL := fmt.Sprintf("%s/print/%d", h.frontendBaseURL, resumeID)

	injectionScript := buildPrintDataInjectionScript(printData)
	page, cleanup, err = renderFrontendPage(h.logger, targetURL, injectionScript)
	if err != nil {
		return nil, nil, cleanup, err
	}

	data, err := exportPDF(page)
	if err != nil {
		return nil, nil, cleanup, err
	}

	return data, page, cleanup, nil
}

func (h *PDFTaskHandler) generatePreviewImage(ctx context.Context, resume *database.Resume, page *rod.Page) error {
	const (
		previewQuality = 80
		presignTTL     = 7 * 24 * time.Hour
	)

	previewBytes, err := capturePreparedScreenshot(page, previewQuality)
	if err != nil {
		return fmt.Errorf("capture preview screenshot: %w", err)
	}

	objectName := fmt.Sprintf("resume/%d/preview_%d.jpg", resume.ID, time.Now().Unix())
	reader := bytes.NewReader(previewBytes)
	if _, err := h.storage.UploadFile(ctx, objectName, reader, int64(len(previewBytes)), "image/jpeg"); err != nil {
		return fmt.Errorf("upload preview image: %w", err)
	}

	presignedURL, err := h.storage.GeneratePresignedURL(ctx, objectName, presignTTL)
	if err != nil {
		return fmt.Errorf("generate preview presigned url: %w", err)
	}

	if err := h.db.WithContext(ctx).Model(resume).Update("preview_image_url", presignedURL).Error; err != nil {
		return fmt.Errorf("update resume preview url: %w", err)
	}

	return nil
}

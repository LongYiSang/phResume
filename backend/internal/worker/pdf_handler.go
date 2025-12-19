package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/go-rod/rod"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/errcode"
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
func (h *PDFTaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) (retErr error) {
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

	log = log.With(slog.Uint64("user_id", uint64(resume.UserID)))

	defer func() {
		if retErr == nil {
			return
		}
		if !isFinalAsynqAttempt(ctx) {
			return
		}

		notify := PDFGenerationNotifyMessage{
			Status:        "error",
			ResumeID:      resume.ID,
			CorrelationID: payload.CorrelationID,
			ErrorCode:     errcode.SystemError,
			ErrorMessage:  strings.TrimSpace(retErr.Error()),
		}
		if err := h.publishPDFGenerationNotify(ctx, resume.UserID, notify); err != nil {
			log.Error("publish pdf error notification failed", slog.Any("error", err))
		}
	}()

	pdfBytes, page, cleanup, missingKeys, resourceMissing, err := h.generatePDFFromFrontend(ctx, resume.ID, payload.CorrelationID)
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

	notify := PDFGenerationNotifyMessage{
		Status:        "completed",
		ResumeID:      resume.ID,
		CorrelationID: payload.CorrelationID,
		ErrorCode:     errcode.OK,
		ErrorMessage:  "",
	}
	if resourceMissing {
		notify.ErrorCode = errcode.ResourceMissing
		notify.ErrorMessage = "部分图片资源缺失/无效，已自动跳过并继续生成"
		notify.MissingKeys = missingKeys
		log.Warn("pdf generated with missing assets",
			slog.Int("missing_count", len(missingKeys)),
			slog.Any("missing_keys", missingKeys),
		)
	}
	if err := h.publishPDFGenerationNotify(ctx, resume.UserID, notify); err != nil {
		log.Error("publish redis notification failed", slog.Any("error", err))
		return err
	}

	if err := h.generatePreviewImage(ctx, &resume, page); err != nil {
		log.Warn("generate resume preview failed", slog.Any("error", err))
	}

	log.Info("PDF generation task completed successfully.")
	return nil
}

func (h *PDFTaskHandler) publishPDFGenerationNotify(ctx context.Context, userID uint, notify PDFGenerationNotifyMessage) error {
	data, err := json.Marshal(notify)
	if err != nil {
		return fmt.Errorf("marshal notification payload: %w", err)
	}
	channel := fmt.Sprintf("user_notify:%d", userID)
	if err := h.redisClient.Publish(ctx, channel, data).Err(); err != nil {
		return fmt.Errorf("publish redis notification to %q: %w", channel, err)
	}
	return nil
}

func isFinalAsynqAttempt(ctx context.Context) bool {
	retryCount, ok1 := asynq.GetRetryCount(ctx)
	maxRetry, ok2 := asynq.GetMaxRetry(ctx)
	if !ok1 || !ok2 {
		return false
	}
	return retryCount >= maxRetry
}

type printDataWarning struct {
	Code        int      `json:"code"`
	Message     string   `json:"message"`
	MissingKeys []string `json:"missing_keys"`
}

type printDataMeta struct {
	Warnings []printDataWarning `json:"warnings"`
}

func extractResourceMissingWarning(printData []byte) (missingKeys []string, hasWarning bool) {
	var meta printDataMeta
	if err := json.Unmarshal(printData, &meta); err != nil {
		return nil, false
	}
	uniq := make(map[string]struct{})
	var result []string
	for _, w := range meta.Warnings {
		if w.Code != errcode.ResourceMissing {
			continue
		}
		hasWarning = true
		for _, k := range w.MissingKeys {
			key := strings.TrimSpace(k)
			if key == "" {
				continue
			}
			if _, ok := uniq[key]; ok {
				continue
			}
			uniq[key] = struct{}{}
			result = append(result, key)
		}
	}
	return result, hasWarning
}

func (h *PDFTaskHandler) generatePDFFromFrontend(ctx context.Context, resumeID uint, correlationID string) (_ []byte, page *rod.Page, cleanup func(), missingKeys []string, resourceMissing bool, err error) {
	cleanup = func() {}
	defer func() {
		if err != nil {
			cleanup()
		}
	}()

	printData, err := fetchInternalPrintData(ctx, h.internalAPIBaseURL, resumePrintPath, resumeID, h.internalSecret, correlationID)
	if err != nil {
		return nil, nil, cleanup, nil, false, err
	}
	missingKeys, resourceMissing = extractResourceMissingWarning(printData)

	targetURL := fmt.Sprintf("%s/print/%d", h.frontendBaseURL, resumeID)

	injectionScript := buildPrintDataBootstrapScript(printData)
	page, cleanup, err = renderFrontendPage(h.logger, targetURL, injectionScript)
	if err != nil {
		return nil, nil, cleanup, missingKeys, resourceMissing, err
	}

	data, err := exportPDF(page)
	if err != nil {
		return nil, nil, cleanup, missingKeys, resourceMissing, err
	}

	return data, page, cleanup, missingKeys, resourceMissing, nil
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

	objectName := fmt.Sprintf("thumbnails/resume/%d/preview.jpg", resume.ID)
	reader := bytes.NewReader(previewBytes)
	if _, err := h.storage.UploadFile(ctx, objectName, reader, int64(len(previewBytes)), "image/jpeg"); err != nil {
		return fmt.Errorf("upload preview image: %w", err)
	}

	presignedURL, err := h.storage.GeneratePresignedURL(ctx, objectName, presignTTL)
	if err != nil {
		return fmt.Errorf("generate preview presigned url: %w", err)
	}

	if err := h.db.WithContext(ctx).Model(resume).Updates(map[string]any{
		"preview_image_url":  presignedURL,
		"preview_object_key": objectName,
	}).Error; err != nil {
		return fmt.Errorf("update resume preview url: %w", err)
	}

	return nil
}

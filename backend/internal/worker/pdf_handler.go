package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
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
	db             *gorm.DB
	storage        *storage.Client
	redisClient    *redis.Client
	logger         *slog.Logger
	internalSecret string
}

// NewPDFTaskHandler 创建任务处理器。
func NewPDFTaskHandler(
	db *gorm.DB,
	storage *storage.Client,
	redisClient *redis.Client,
	logger *slog.Logger,
	internalSecret string,
) *PDFTaskHandler {
	return &PDFTaskHandler{
		db:             db,
		storage:        storage,
		redisClient:    redisClient,
		logger:         logger,
		internalSecret: internalSecret,
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

	if h.internalSecret == "" {
		err := fmt.Errorf("internal api secret missing")
		log.Error("internal api secret missing", slog.Any("error", err))
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

	pdfBytes, err := h.generatePDFFromFrontend(resume.ID)
	if err != nil {
		log.Error("generate pdf via frontend failed", slog.Any("error", err))
		return err
	}

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

	log.Info("Published notification to channel", slog.String("channel", channel))
	log.Info("PDF generation task completed successfully.")
	return nil
}

func (h *PDFTaskHandler) generatePDFFromFrontend(resumeID uint) ([]byte, error) {
	targetURL := fmt.Sprintf(
		"http://frontend:3000/print/%d?internal_token=%s",
		resumeID,
		url.QueryEscape(h.internalSecret),
	)
	h.logger.Info("Worker: Navigating to frontend print page...", slog.String("url", targetURL))

	launch := launcher.New().
		Headless(true).
		NoSandbox(true)

	if path, ok := launcher.LookPath(); ok {
		launch = launch.Bin(path)
	}

	browserURL, err := launch.Launch()
	if err != nil {
		return nil, fmt.Errorf("launch chromium: %w", err)
	}
	defer launch.Cleanup()

	browser := rod.New().ControlURL(browserURL).Timeout(90 * time.Second)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("connect browser: %w", err)
	}
	defer func() {
		_ = browser.Close()
	}()

	page := browser.MustPage(targetURL)
	defer func() {
		_ = page.Close()
	}()

	page.MustWaitLoad()
	h.logger.Info("Worker: Waiting for frontend render signal (#pdf-render-ready)...")
	page.Timeout(30 * time.Second).MustElement("#pdf-render-ready")
	h.logger.Info("Worker: Render signal received.")

	if err := (proto.EmulationSetEmulatedMedia{Media: "screen"}).Call(page); err != nil {
		return nil, fmt.Errorf("set emulated media: %w", err)
	}

	params := &proto.PagePrintToPDF{
		PrintBackground:   true,
		PaperWidth:        float64Ptr(8.27),
		PaperHeight:       float64Ptr(11.69),
		MarginTop:         float64Ptr(0),
		MarginBottom:      float64Ptr(0),
		MarginLeft:        float64Ptr(0),
		MarginRight:       float64Ptr(0),
		PreferCSSPageSize: true,
	}

	reader, err := page.PDF(params)
	if err != nil {
		return nil, fmt.Errorf("export pdf: %w", err)
	}
	defer func() {
		_ = reader.Close()
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read pdf bytes: %w", err)
	}

	return data, nil
}

func float64Ptr(value float64) *float64 {
	return &value
}

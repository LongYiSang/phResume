package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

// TemplatePreviewHandler 负责模板缩略图生成任务。
type TemplatePreviewHandler struct {
	db             *gorm.DB
	storage        *storage.Client
	logger         *slog.Logger
	internalSecret string
}

func NewTemplatePreviewHandler(
	db *gorm.DB,
	storageClient *storage.Client,
	logger *slog.Logger,
	internalSecret string,
) *TemplatePreviewHandler {
	return &TemplatePreviewHandler{
		db:             db,
		storage:        storageClient,
		logger:         logger,
		internalSecret: internalSecret,
	}
}

func (h *TemplatePreviewHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	log := h.logger

	var payload tasks.TemplatePreviewPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		log.Error("unmarshal template preview payload failed", slog.Any("error", err))
		return err
	}

	if h.internalSecret == "" {
		err := fmt.Errorf("internal api secret missing")
		log.Error("internal api secret missing", slog.Any("error", err))
		return err
	}

	log = log.With(
		slog.Int("template_id", int(payload.TemplateID)),
		slog.String("correlation_id", payload.CorrelationID),
	)
	log.Info("Starting template preview generation task...")

	var template database.Template
	if err := h.db.WithContext(ctx).First(&template, payload.TemplateID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Warn("template not found, skipping task")
			return nil
		}
		log.Error("query template failed", slog.Any("error", err))
		return err
	}

	targetURL := fmt.Sprintf(
		"http://frontend:3000/print-template/%d?internal_token=%s",
		template.ID,
		url.QueryEscape(h.internalSecret),
	)

	page, cleanup, err := renderFrontendPage(h.logger, targetURL)
	if err != nil {
		log.Error("render template page failed", slog.Any("error", err))
		return err
	}
	defer cleanup()

	const previewQuality = 80
	previewBytes, err := capturePreparedScreenshot(page, previewQuality)
	if err != nil {
		log.Error("capture template screenshot failed", slog.Any("error", err))
		return err
	}

	objectName := fmt.Sprintf("thumbnails/template/%d/preview.jpg", template.ID)
	if _, err := h.storage.UploadFile(ctx, objectName, bytes.NewReader(previewBytes), int64(len(previewBytes)), "image/jpeg"); err != nil {
		log.Error("upload template preview failed", slog.Any("error", err))
		return err
	}

	const presignTTL = 7 * 24 * time.Hour
	url, err := h.storage.GeneratePresignedURL(ctx, objectName, presignTTL)
	if err != nil {
		log.Error("generate template preview url failed", slog.Any("error", err))
		return err
	}

	if err := h.db.WithContext(ctx).
		Model(&template).
		Update("preview_image_url", url).Error; err != nil {
		log.Error("update template preview url failed", slog.Any("error", err))
		return err
	}

	log.Info("Template preview generation completed.")
	return nil
}

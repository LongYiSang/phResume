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

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

// TemplatePreviewHandler 负责模板缩略图生成任务。
type TemplatePreviewHandler struct {
	db                 *gorm.DB
	storage            *storage.Client
	logger             *slog.Logger
	internalSecret     string
	internalAPIBaseURL string
	frontendBaseURL    string
}

func NewTemplatePreviewHandler(
	db *gorm.DB,
	storageClient *storage.Client,
	logger *slog.Logger,
	internalSecret string,
	internalAPIBaseURL string,
	frontendBaseURL string,
) *TemplatePreviewHandler {
	return &TemplatePreviewHandler{
		db:                 db,
		storage:            storageClient,
		logger:             logger,
		internalSecret:     internalSecret,
		internalAPIBaseURL: strings.TrimRight(strings.TrimSpace(internalAPIBaseURL), "/"),
		frontendBaseURL:    strings.TrimRight(strings.TrimSpace(frontendBaseURL), "/"),
	}
}

func (h *TemplatePreviewHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	log := h.logger

	var payload tasks.TemplatePreviewPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		log.Error("unmarshal template preview payload failed", slog.Any("error", err))
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

	printData, err := fetchInternalPrintData(ctx, h.internalAPIBaseURL, templatePrintPath, template.ID, h.internalSecret)
	if err != nil {
		log.Error("fetch internal print data failed", slog.Any("error", err))
		return err
	}

	targetURL := fmt.Sprintf("%s/print-template/%d", h.frontendBaseURL, template.ID)

	injectionScript := buildPrintDataBootstrapScript(printData)
	page, cleanup, err := renderFrontendPage(h.logger, targetURL, injectionScript)
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
		Updates(map[string]any{
			"preview_image_url":  url,
			"preview_object_key": objectName,
		}).Error; err != nil {
		log.Error("update template preview url failed", slog.Any("error", err))
		return err
	}

	log.Info("Template preview generation completed.")
	return nil
}

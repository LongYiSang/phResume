package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log/slog"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/pdf"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

const resumeHTMLTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{ .Title }}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { font-size: 28px; margin-bottom: 12px; }
    section { margin-bottom: 24px; }
    .content { white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <h1>{{ .Title }}</h1>
  </header>
  <section class="content">
    {{ safeHTML .Content }}
  </section>
</body>
</html>`

// PDFTaskHandler 负责消费 PDF 生成任务。
type PDFTaskHandler struct {
	db          *gorm.DB
	storage     *storage.Client
	redisClient *redis.Client
	logger      *slog.Logger
}

// NewPDFTaskHandler 创建任务处理器。
func NewPDFTaskHandler(db *gorm.DB, storage *storage.Client, redisClient *redis.Client, logger *slog.Logger) *PDFTaskHandler {
	return &PDFTaskHandler{
		db:          db,
		storage:     storage,
		redisClient: redisClient,
		logger:      logger,
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
	log.Info("Starting PDF generation task...")

	var resume database.Resume
	if err := h.db.WithContext(ctx).First(&resume, payload.ResumeID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Warn("resume not found, skipping task")
			return nil
		}
		log.Error("query resume failed", slog.Any("error", err))
		return err
	}

	htmlString, err := renderResumeHTML(resume)
	if err != nil {
		log.Error("render resume html failed", slog.Any("error", err))
		return err
	}

	pdfBytes, err := pdf.GeneratePDFFromHTML(htmlString)
	if err != nil {
		log.Error("generate pdf failed", slog.Any("error", err))
		return err
	}

	objectName := fmt.Sprintf("resumes/%d/%s.pdf", resume.ID, uuid.NewString())
	pdfReader := bytes.NewReader(pdfBytes)
	_, err = h.storage.UploadFile(ctx, objectName, pdfReader, int64(len(pdfBytes)), "application/pdf")
	if err != nil {
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

func renderResumeHTML(resume database.Resume) (string, error) {
	tmpl, err := template.New("resume").Funcs(template.FuncMap{
		"safeHTML": func(content string) template.HTML {
			return template.HTML(content)
		},
	}).Parse(resumeHTMLTemplate)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	var buffer bytes.Buffer
	if err := tmpl.Execute(&buffer, resume); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buffer.String(), nil
}

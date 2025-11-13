package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/microcosm-cc/bluemonday"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/pdf"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

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

var (
	htmlSanitizer = func() *bluemonday.Policy {
		policy := bluemonday.UGCPolicy()
		policy.AllowElements("div", "span")
		policy.AllowURLSchemes("http", "https", "mailto")
		return policy
	}()

	cssValuePattern = regexp.MustCompile(`^[a-zA-Z0-9#%(),./\s:\-+"']+$`)

	allowedCSSProperties = map[string]struct{}{
		"font-size":        {},
		"font-weight":      {},
		"font-family":      {},
		"line-height":      {},
		"letter-spacing":   {},
		"text-transform":   {},
		"text-align":       {},
		"color":            {},
		"background-color": {},
		"border":           {},
		"border-top":       {},
		"border-bottom":    {},
		"border-left":      {},
		"border-right":     {},
		"border-color":     {},
		"border-width":     {},
		"border-style":     {},
		"border-radius":    {},
		"padding":          {},
		"padding-top":      {},
		"padding-bottom":   {},
		"padding-left":     {},
		"padding-right":    {},
		"margin":           {},
		"margin-top":       {},
		"margin-bottom":    {},
		"margin-left":      {},
		"margin-right":     {},
		"width":            {},
		"height":           {},
		"max-width":        {},
		"max-height":       {},
		"object-fit":       {},
		"display":          {},
		"gap":              {},
		"justify-content":  {},
		"align-items":      {},
	}
)

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

	var resumeJSON ResumeJSON
	if err := json.Unmarshal(resume.Content, &resumeJSON); err != nil {
		log.Error("Failed to unmarshal JSONB content", slog.Any("error", err))
		return err
	}
	ensureResumeDefaults(&resumeJSON)

	if err := h.prepareImageItems(ctx, resume.UserID, resumeJSON.Items, log); err != nil {
		return err
	}

	htmlString, err := renderResumeHTML(resumeJSON)
	if err != nil {
		log.Error("render resume html failed", slog.Any("error", err))
		return err
	}

	pdfBytes, err := pdf.GeneratePDFFromHTML(htmlString)
	if err != nil {
		log.Error("generate pdf failed", slog.Any("error", err))
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

func (h *PDFTaskHandler) prepareImageItems(ctx context.Context, userID uint, items []Item, log *slog.Logger) error {
	if len(items) == 0 {
		return nil
	}

	expectedPrefix := fmt.Sprintf("user-assets/%d/", userID)
	for idx := range items {
		if items[idx].Type != "image" {
			continue
		}
		objectKey := strings.TrimSpace(items[idx].Content)
		if objectKey == "" {
			log.Warn("image item missing object key", slog.String("item_id", items[idx].ID))
			return fmt.Errorf("image object key missing")
		}
		if !strings.HasPrefix(objectKey, expectedPrefix) {
			log.Error("image object key does not belong to user", slog.String("object_key", objectKey))
			return fmt.Errorf("object key validation failed")
		}

		obj, err := h.storage.GetObject(ctx, objectKey)
		if err != nil {
			log.Error("Failed to fetch image from storage", slog.String("object_key", objectKey), slog.Any("error", err))
			return err
		}

		info, err := obj.Stat()
		if err != nil {
			_ = obj.Close()
			log.Error("Failed to stat image object", slog.String("object_key", objectKey), slog.Any("error", err))
			return err
		}

		imageBytes, err := io.ReadAll(obj)
		_ = obj.Close()
		if err != nil {
			log.Error("Failed to read image object", slog.String("object_key", objectKey), slog.Any("error", err))
			return err
		}

		contentType := info.ContentType
		if contentType == "" {
			contentType = "image/png"
		}

		base64Image := base64.StdEncoding.EncodeToString(imageBytes)
		dataURI := fmt.Sprintf("data:%s;base64,%s", contentType, base64Image)
		items[idx].Content = dataURI
	}

	return nil
}

func renderResumeHTML(resume ResumeJSON) (string, error) {
	tmpl, err := template.New("pdf").Funcs(template.FuncMap{
		"safeHTML": safeHTML,
		"safeCSS":  safeCSS,
		"safeURL":  safeURL,
		"add": func(a, b int) int {
			return a + b
		},
	}).Parse(PDFTemplateString)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	var buffer bytes.Buffer
	if err := tmpl.Execute(&buffer, resume); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buffer.String(), nil
}

func ensureResumeDefaults(resume *ResumeJSON) {
	if resume.LayoutSettings.Columns <= 0 {
		resume.LayoutSettings.Columns = 24
	}
	if resume.LayoutSettings.RowHeightPx <= 0 {
		resume.LayoutSettings.RowHeightPx = 10
	}
	if resume.LayoutSettings.FontFamily == "" {
		resume.LayoutSettings.FontFamily = "Arial"
	}
	if resume.LayoutSettings.FontSizePt <= 0 {
		resume.LayoutSettings.FontSizePt = 10
	}
	if resume.LayoutSettings.MarginPx < 0 {
		resume.LayoutSettings.MarginPx = 0
	}
	if resume.LayoutSettings.AccentColor == "" {
		resume.LayoutSettings.AccentColor = "#000000"
	}

	for idx := range resume.Items {
		if resume.Items[idx].Layout.W <= 0 {
			resume.Items[idx].Layout.W = 1
		}
		if resume.Items[idx].Layout.H <= 0 {
			resume.Items[idx].Layout.H = 1
		}
		if resume.Items[idx].Style == nil {
			resume.Items[idx].Style = map[string]interface{}{}
		}
	}
}

func safeHTML(content string) template.HTML {
	if content == "" {
		return ""
	}
	sanitized := htmlSanitizer.Sanitize(content)
	return template.HTML(sanitized)
}

func safeCSS(style map[string]interface{}) template.CSS {
	if len(style) == 0 {
		return ""
	}

	keys := make([]string, 0, len(style))
	for key := range style {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var builder strings.Builder
	for _, originalKey := range keys {
		value := style[originalKey]
		property := camelToKebab(originalKey)
		if property == "" {
			continue
		}
		if _, ok := allowedCSSProperties[property]; !ok {
			continue
		}

		valueStr := cssValueToString(value)
		if valueStr == "" {
			continue
		}
		lower := strings.ToLower(valueStr)
		if strings.Contains(lower, "expression") || strings.Contains(lower, "javascript:") {
			continue
		}
		if !cssValuePattern.MatchString(valueStr) {
			continue
		}

		builder.WriteString(property)
		builder.WriteString(":")
		builder.WriteString(valueStr)
		if !strings.HasSuffix(valueStr, ";") {
			builder.WriteString(";")
		}
	}

	return template.CSS(builder.String())
}

func safeURL(value string) template.URL {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if strings.HasPrefix(trimmed, "data:image/") ||
		strings.HasPrefix(trimmed, "https://") ||
		strings.HasPrefix(trimmed, "http://") {
		return template.URL(trimmed)
	}

	return ""
}

func camelToKebab(input string) string {
	if input == "" {
		return ""
	}

	var builder strings.Builder
	for idx, r := range input {
		switch {
		case r == '_' || r == '-':
			builder.WriteByte('-')
		case unicode.IsUpper(r):
			if idx > 0 {
				builder.WriteByte('-')
			}
			builder.WriteRune(unicode.ToLower(r))
		default:
			builder.WriteRune(unicode.ToLower(r))
		}
	}
	return builder.String()
}

func cssValueToString(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	case int:
		return strconv.Itoa(v)
	case int8:
		return strconv.FormatInt(int64(v), 10)
	case int16:
		return strconv.FormatInt(int64(v), 10)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case uint:
		return strconv.FormatUint(uint64(v), 10)
	case uint8:
		return strconv.FormatUint(uint64(v), 10)
	case uint16:
		return strconv.FormatUint(uint64(v), 10)
	case uint32:
		return strconv.FormatUint(uint64(v), 10)
	case uint64:
		return strconv.FormatUint(v, 10)
	case float32:
		return strings.TrimRight(strings.TrimRight(strconv.FormatFloat(float64(v), 'f', 6, 32), "0"), ".")
	case float64:
		return strings.TrimRight(strings.TrimRight(strconv.FormatFloat(v, 'f', 6, 64), "0"), ".")
	default:
		return ""
	}
}

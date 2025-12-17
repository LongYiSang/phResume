package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"phResume/internal/api/middleware"
	"phResume/internal/database"
	"phResume/internal/resume"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

// TemplateHandler 负责模板相关的 API。
type TemplateHandler struct {
	db             *gorm.DB
	asynqClient    *asynq.Client
	storage        *storage.Client
	internalSecret string
	maxTemplates   int
}

func NewTemplateHandler(
	db *gorm.DB,
	asynqClient *asynq.Client,
	storageClient *storage.Client,
	internalSecret string,
	maxTemplates int,
) *TemplateHandler {
	return &TemplateHandler{
		db:             db,
		asynqClient:    asynqClient,
		storage:        storageClient,
		internalSecret: internalSecret,
		maxTemplates:   maxTemplates,
	}
}

type createTemplateRequest struct {
	Title   string         `json:"title" binding:"required"`
	Content datatypes.JSON `json:"content" binding:"required"`
	// 目前创建默认私有，若后续需要开放，可增加 IsPublic 入参并严格校验
}

type templateListItem struct {
	ID              uint   `json:"id"`
	Title           string `json:"title"`
	PreviewImageURL string `json:"preview_image_url,omitempty"`
	IsOwner         bool   `json:"is_owner"`
}

type templateDetailResponse struct {
	ID              uint           `json:"id"`
	Title           string         `json:"title"`
	Content         datatypes.JSON `json:"content"`
	PreviewImageURL string         `json:"preview_image_url,omitempty"`
}

// POST /v1/templates
// 创建模板：默认私有，Owner 为当前用户。
func (h *TemplateHandler) CreateTemplate(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	var req createTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	model := database.Template{
		Title:    req.Title,
		Content:  req.Content,
		UserID:   userID,
		IsPublic: false,
	}

	var count int64
	if err := h.db.WithContext(c.Request.Context()).
		Model(&database.Template{}).
		Where("user_id = ? AND is_public = ?", userID, false).
		Count(&count).Error; err != nil {
		Internal(c, "failed to count templates")
		return
	}
	if h.maxTemplates > 0 && count >= int64(h.maxTemplates) {
		Forbidden(c, "template limit reached")
		return
	}

	if err := h.db.WithContext(c.Request.Context()).Create(&model).Error; err != nil {
		Internal(c, "failed to create template")
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":    model.ID,
		"title": model.Title,
	})
}

// DELETE /v1/templates/:id
// 删除模板，仅允许 Owner 删除私有模板。
func (h *TemplateHandler) DeleteTemplate(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		BadRequest(c, "invalid template id")
		return
	}

	var model database.Template
	if err := h.db.WithContext(c.Request.Context()).
		First(&model, uint(id)).Error; err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "template not found")
		default:
			Internal(c, "failed to query template")
		}
		return
	}

	if model.UserID != userID {
		Forbidden(c, "access denied")
		return
	}

	ctx := c.Request.Context()
	logger := middleware.LoggerFromContext(c).With(
		slog.Uint64("user_id", uint64(userID)),
		slog.Uint64("template_id", uint64(model.ID)),
	)

	previewKey := strings.TrimSpace(model.PreviewObjectKey)
	previewPrefix := fmt.Sprintf("thumbnails/template/%d/", model.ID)

	if previewKey != "" {
		if err := h.storage.DeleteObject(ctx, previewKey); err != nil {
			logger.Error("delete template preview object failed", slog.String("object_key", previewKey), slog.Any("error", err))
			Internal(c, "failed to delete template preview")
			return
		}
	} else {
		if err := h.storage.DeletePrefix(ctx, previewPrefix); err != nil {
			logger.Error("delete template preview prefix failed", slog.String("prefix", previewPrefix), slog.Any("error", err))
			Internal(c, "failed to delete template preview")
			return
		}
	}

	if err := h.db.WithContext(ctx).Delete(&database.Template{}, model.ID).Error; err != nil {
		logger.Error("delete template record failed", slog.Any("error", err))
		Internal(c, "failed to delete template")
		return
	}

	c.Status(http.StatusNoContent)
}

// GET /v1/templates
// 列表：返回当前用户模板 ∪ 所有公开模板（去重由主键自然保证）。
func (h *TemplateHandler) ListTemplates(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	var templates []database.Template
	if err := h.db.WithContext(c.Request.Context()).
		Where("user_id = ? OR is_public = ?", userID, true).
		Order("updated_at DESC").
		Find(&templates).Error; err != nil {
		Internal(c, "failed to list templates")
		return
	}

	items := make([]templateListItem, 0, len(templates))
	for _, t := range templates {
		items = append(items, templateListItem{
			ID:              t.ID,
			Title:           t.Title,
			PreviewImageURL: t.PreviewImageURL,
			IsOwner:         t.UserID == userID,
		})
	}
	c.JSON(http.StatusOK, items)
}

// GET /v1/templates/:id
// 详情：允许 Owner 访问，或公开模板允许任何已登录用户访问。
func (h *TemplateHandler) GetTemplate(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		BadRequest(c, "invalid template id")
		return
	}

	var model database.Template
	if err := h.db.WithContext(c.Request.Context()).
		First(&model, uint(id)).Error; err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "template not found")
		default:
			Internal(c, "failed to query template")
		}
		return
	}

	if model.UserID != userID && !model.IsPublic {
		Forbidden(c, "access denied")
		return
	}

	c.JSON(http.StatusOK, templateDetailResponse{
		ID:              model.ID,
		Title:           model.Title,
		Content:         model.Content,
		PreviewImageURL: model.PreviewImageURL,
	})
}

// POST /v1/templates/:id/generate-preview
func (h *TemplateHandler) GeneratePreview(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		BadRequest(c, "invalid template id")
		return
	}

	var model database.Template
	if err := h.db.WithContext(c.Request.Context()).
		First(&model, uint(id)).Error; err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "template not found")
		default:
			Internal(c, "failed to query template")
		}
		return
	}

	if model.UserID != userID {
		Forbidden(c, "access denied")
		return
	}

	correlationID := middleware.GetCorrelationID(c)
	task, err := tasks.NewTemplatePreviewTask(model.ID, correlationID)
	if err != nil {
		Internal(c, "failed to create preview task")
		return
	}

	info, err := h.asynqClient.Enqueue(task, asynq.MaxRetry(5))
	if err != nil {
		Internal(c, "failed to enqueue preview task")
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message": "template preview generation scheduled",
		"task_id": info.ID,
	})
}

// GET /v1/templates/print/:id
func (h *TemplateHandler) GetPrintTemplateData(c *gin.Context) {
	templateID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		BadRequest(c, "invalid template id")
		return
	}

	var templateModel database.Template
	ctx := c.Request.Context()
	if err := h.db.WithContext(ctx).First(&templateModel, uint(templateID)).Error; err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "template not found")
		default:
			Internal(c, "failed to load template")
		}
		return
	}

	var content resume.Content
	if err := json.Unmarshal(templateModel.Content, &content); err != nil {
		Internal(c, "failed to decode template")
		return
	}

	if err := inlineContentImages(ctx, h.storage, templateModel.UserID, &content); err != nil {
		if status, ok := statusFromInlineError(err); ok {
			Error(c, status, err.Error())
			return
		}
		Internal(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, content)
}

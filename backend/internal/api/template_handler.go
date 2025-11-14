package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"phResume/internal/database"
)

// TemplateHandler 负责模板相关的 API。
type TemplateHandler struct {
	db *gorm.DB
}

func NewTemplateHandler(db *gorm.DB) *TemplateHandler {
	return &TemplateHandler{db: db}
}

type createTemplateRequest struct {
	Title           string         `json:"title" binding:"required"`
	Content         datatypes.JSON `json:"content" binding:"required"`
	PreviewImageURL *string        `json:"preview_image_url"`
	// 目前创建默认私有，若后续需要开放，可增加 IsPublic 入参并严格校验
}

type templateListItem struct {
	ID              uint   `json:"id"`
	Title           string `json:"title"`
	PreviewImageURL string `json:"preview_image_url,omitempty"`
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
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req createTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	model := database.Template{
		Title:    req.Title,
		Content:  req.Content,
		UserID:   userID,
		IsPublic: false,
	}
	if req.PreviewImageURL != nil {
		model.PreviewImageURL = *req.PreviewImageURL
	}

	if err := h.db.WithContext(c.Request.Context()).Create(&model).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create template"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"id":    model.ID,
		"title": model.Title,
	})
}

// GET /v1/templates
// 列表：返回当前用户模板 ∪ 所有公开模板（去重由主键自然保证）。
func (h *TemplateHandler) ListTemplates(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var templates []database.Template
	if err := h.db.WithContext(c.Request.Context()).
		Where("user_id = ? OR is_public = ?", userID, true).
		Order("updated_at DESC").
		Find(&templates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list templates"})
		return
	}

	items := make([]templateListItem, 0, len(templates))
	for _, t := range templates {
		items = append(items, templateListItem{
			ID:              t.ID,
			Title:           t.Title,
			PreviewImageURL: t.PreviewImageURL,
		})
	}
	c.JSON(http.StatusOK, items)
}

// GET /v1/templates/:id
// 详情：允许 Owner 访问，或公开模板允许任何已登录用户访问。
func (h *TemplateHandler) GetTemplate(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid template id"})
		return
	}

	var model database.Template
	if err := h.db.WithContext(c.Request.Context()).
		First(&model, uint(id)).Error; err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "template not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query template"})
		}
		return
	}

	if model.UserID != userID && !model.IsPublic {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	c.JSON(http.StatusOK, templateDetailResponse{
		ID:              model.ID,
		Title:           model.Title,
		Content:         model.Content,
		PreviewImageURL: model.PreviewImageURL,
	})
}

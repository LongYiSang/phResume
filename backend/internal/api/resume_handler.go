package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

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

// ResumeHandler 负责处理与简历相关的 API 请求。
type ResumeHandler struct {
	db             *gorm.DB
	asynqClient    *asynq.Client
	storage        *storage.Client
	internalSecret string
}

// NewResumeHandler 构造 ResumeHandler。
func NewResumeHandler(db *gorm.DB, asynqClient *asynq.Client, storageClient *storage.Client, internalSecret string) *ResumeHandler {
	return &ResumeHandler{
		db:             db,
		asynqClient:    asynqClient,
		storage:        storageClient,
		internalSecret: internalSecret,
	}
}

var errInvalidResumeID = errors.New("invalid resume id")

type createResumeRequest struct {
	Title   string         `json:"title" binding:"required"`
	Content datatypes.JSON `json:"content" binding:"required"`
}

type resumeResponse struct {
	ID      uint           `json:"id"`
	Title   string         `json:"title"`
	Content datatypes.JSON `json:"content"`
}

// CreateResume 创建简历并保存到数据库。
func (h *ResumeHandler) CreateResume(c *gin.Context) {
	var req createResumeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	ctx := c.Request.Context()
	var resume database.Resume
	err := h.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at desc").
		First(&resume).Error

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		resume = database.Resume{
			Title:   req.Title,
			Content: req.Content,
			UserID:  userID,
		}
		if createErr := h.db.WithContext(ctx).Create(&resume).Error; createErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create resume"})
			return
		}
		c.JSON(http.StatusCreated, newResumeResponse(resume))
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upsert resume"})
		return
	default:
		updates := map[string]any{
			"title":   req.Title,
			"content": req.Content,
		}
		if updateErr := h.db.WithContext(ctx).Model(&resume).Updates(updates).Error; updateErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update resume"})
			return
		}
		if err := h.db.WithContext(ctx).First(&resume, resume.ID).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load resume"})
			return
		}
		c.JSON(http.StatusOK, newResumeResponse(resume))
	}
}

// GetLatestResume 返回用户最近的简历，或默认模板。
func (h *ResumeHandler) GetLatestResume(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	ctx := c.Request.Context()
	var resume database.Resume
	err := h.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at desc").
		First(&resume).Error

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusOK, resumeResponse{
			ID:      0,
			Title:   defaultResumeTitle,
			Content: defaultResumeContent(),
		})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query latest resume"})
		return
	default:
		c.JSON(http.StatusOK, newResumeResponse(resume))
	}
}

// DownloadResume 将 PDF 生成任务入队并立即返回 202。

func (h *ResumeHandler) DownloadResume(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	resume, err := h.getResumeForUser(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, errInvalidResumeID):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resume id"})
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resume not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query resume"})
		}
		return
	}

	correlationID := middleware.GetCorrelationID(c)
	task, err := tasks.NewPDFGenerateTask(resume.ID, correlationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create task"})
		return
	}

	info, err := h.asynqClient.Enqueue(task, asynq.MaxRetry(5))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue pdf generation"})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message": "PDF generation request accepted",
		"task_id": info.ID,
	})
}

func userIDFromContext(c *gin.Context) (uint, bool) {
	value, exists := c.Get("userID")
	if !exists {
		return 0, false
	}

	switch v := value.(type) {
	case uint:
		return v, true
	case int:
		if v < 0 {
			return 0, false
		}
		return uint(v), true
	case uint64:
		return uint(v), true
	case int64:
		if v < 0 {
			return 0, false
		}
		return uint(v), true
	default:
		return 0, false
	}
}

// GetDownloadLink 生成简历 PDF 的预签名下载链接。
func (h *ResumeHandler) GetDownloadLink(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	resume, err := h.getResumeForUser(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, errInvalidResumeID):
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resume id"})
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resume not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query resume"})
		}
		return
	}

	if resume.PdfUrl == "" {
		c.JSON(http.StatusConflict, gin.H{"error": "pdf not ready"})
		return
	}

	signedURL, err := h.storage.GeneratePresignedURL(c.Request.Context(), resume.PdfUrl, 5*time.Minute)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate download link"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": signedURL})
}

// GetPrintResumeData 返回渲染 PDF 所需的 JSON 数据，附带预签名图像链接。
func (h *ResumeHandler) GetPrintResumeData(c *gin.Context) {
	if h.internalSecret == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal api secret is not configured"})
		return
	}

	token := strings.TrimSpace(c.Query("internal_token"))
	if token == "" || token != h.internalSecret {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	resumeID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resume id"})
		return
	}

	var resumeModel database.Resume
	ctx := c.Request.Context()
	if err := h.db.WithContext(ctx).First(&resumeModel, uint(resumeID)).Error; err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "resume not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load resume"})
		}
		return
	}

	var content resume.Content
	if err := json.Unmarshal(resumeModel.Content, &content); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decode resume"})
		return
	}

	imagePrefix := fmt.Sprintf("user-assets/%d/", resumeModel.UserID)
	for idx := range content.Items {
		if content.Items[idx].Type != "image" {
			continue
		}
		objectKey := strings.TrimSpace(content.Items[idx].Content)
		if objectKey == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "image object key missing"})
			return
		}
		if !strings.HasPrefix(objectKey, imagePrefix) {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid image object key"})
			return
		}
		obj, err := h.storage.GetObject(ctx, objectKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch image"})
			return
		}
		stat, statErr := obj.Stat()
		contentType := "image/png"
		if statErr == nil && stat.ContentType != "" {
			contentType = stat.ContentType
		}
		imageBytes, err := io.ReadAll(obj)
		_ = obj.Close()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read image"})
			return
		}
		base64Image := base64.StdEncoding.EncodeToString(imageBytes)
		dataURI := fmt.Sprintf("data:%s;base64,%s", contentType, base64Image)
		content.Items[idx].Content = dataURI
	}

	c.JSON(http.StatusOK, content)
}

func (h *ResumeHandler) getResumeForUser(ctx context.Context, idParam string, userID uint) (*database.Resume, error) {
	resumeID, err := strconv.ParseUint(idParam, 10, 64)
	if err != nil {
		return nil, errInvalidResumeID
	}

	var resume database.Resume
	if err := h.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", uint(resumeID), userID).
		First(&resume).Error; err != nil {
		return nil, err
	}

	return &resume, nil
}

const defaultResumeTitle = "我的第一份简历"

func defaultResumeContent() datatypes.JSON {
	layoutSettings := map[string]any{
		"columns":       24,
		"row_height_px": 10,
		"accent_color":  "#3388ff",
		"font_family":   "Arial",
		"font_size_pt":  10,
		"margin_px":     30,
	}

	items := []map[string]any{
		{
			"id":      "item-1",
			"type":    "text",
			"content": "你的名字",
			"style": map[string]any{
				"fontSize":   "24pt",
				"fontWeight": "bold",
			},
			"layout": map[string]any{
				"x": 0,
				"y": 2,
				"w": 16,
				"h": 6,
			},
		},
		{
			"id":      "item-2",
			"type":    "text",
			"content": "你的职位/头衔",
			"style": map[string]any{
				"fontSize": "14pt",
			},
			"layout": map[string]any{
				"x": 0,
				"y": 8,
				"w": 16,
				"h": 4,
			},
		},
		{
			"id":      "item-3",
			"type":    "text",
			"content": "你的联系方式：\n电话: 123-456-7890\n邮箱: hello@example.com",
			"style": map[string]any{
				"fontSize": "10pt",
			},
			"layout": map[string]any{
				"x": 16,
				"y": 2,
				"w": 8,
				"h": 10,
			},
		},
	}

	for _, item := range items {
		if _, ok := item["style"]; !ok || item["style"] == nil {
			item["style"] = map[string]any{}
		}
	}

	template := map[string]any{
		"layout_settings": layoutSettings,
		"items":           items,
	}

	data, err := json.Marshal(template)
	if err != nil {
		return datatypes.JSON([]byte("{}"))
	}
	return datatypes.JSON(data)
}

func newResumeResponse(resume database.Resume) resumeResponse {
	return resumeResponse{
		ID:      resume.ID,
		Title:   resume.Title,
		Content: resume.Content,
	}
}

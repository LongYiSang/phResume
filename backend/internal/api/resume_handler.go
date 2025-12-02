package api

import (
	"context"
	"encoding/json"
	"errors"
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
	maxResumes     int
}

// NewResumeHandler 构造 ResumeHandler。
func NewResumeHandler(db *gorm.DB, asynqClient *asynq.Client, storageClient *storage.Client, internalSecret string, maxResumes int) *ResumeHandler {
	return &ResumeHandler{
		db:             db,
		asynqClient:    asynqClient,
		storage:        storageClient,
		internalSecret: internalSecret,
		maxResumes:     maxResumes,
	}
}

var errInvalidResumeID = errors.New("invalid resume id")

type createResumeRequest struct {
	Title           string         `json:"title" binding:"required"`
	Content         datatypes.JSON `json:"content" binding:"required"`
	PreviewImageURL *string        `json:"preview_image_url"`
}

type resumeListItem struct {
	ID              uint      `json:"id"`
	Title           string    `json:"title"`
	PreviewImageURL string    `json:"preview_image_url,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type resumeResponse struct {
	ID              uint           `json:"id"`
	Title           string         `json:"title"`
	Content         datatypes.JSON `json:"content"`
	PreviewImageURL string         `json:"preview_image_url,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

// CreateResume 保存一份新的简历，超过限额则提示升级。
func (h *ResumeHandler) CreateResume(c *gin.Context) {
	var req createResumeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()

	var count int64
	if err := h.db.WithContext(ctx).
		Model(&database.Resume{}).
		Where("user_id = ?", userID).
		Count(&count).Error; err != nil {
		Internal(c, "failed to count resumes")
		return
	}

	if h.maxResumes > 0 && count >= int64(h.maxResumes) {
		Forbidden(c, "resume limit reached")
		return
	}

	resume := database.Resume{
		Title:   req.Title,
		Content: req.Content,
		UserID:  userID,
	}
	if req.PreviewImageURL != nil {
		resume.PreviewImageURL = *req.PreviewImageURL
	}

	if err := h.db.WithContext(ctx).Create(&resume).Error; err != nil {
		Internal(c, "failed to create resume")
		return
	}

	if err := h.setActiveResumeID(ctx, userID, &resume.ID); err != nil {
		Internal(c, "failed to mark active resume")
		return
	}

	c.JSON(http.StatusCreated, newResumeResponse(resume))
}

// GetLatestResume 返回用户最近的简历，或默认模板。
func (h *ResumeHandler) GetLatestResume(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()
	resume, err := h.findActiveOrLatestResume(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, resumeResponse{
				ID:        0,
				Title:     defaultResumeTitle,
				Content:   defaultResumeContent(),
				CreatedAt: time.Time{},
				UpdatedAt: time.Time{},
			})
			return
		}
		Internal(c, "failed to query latest resume")
		return
	}

	c.JSON(http.StatusOK, newResumeResponse(*resume))
}

// ListResumes 列出用户全部简历。
func (h *ResumeHandler) ListResumes(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()
	var resumes []database.Resume
	if err := h.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&resumes).Error; err != nil {
		Internal(c, "failed to list resumes")
		return
	}

	items := make([]resumeListItem, 0, len(resumes))
	for _, r := range resumes {
		items = append(items, resumeListItem{
			ID:              r.ID,
			Title:           r.Title,
			PreviewImageURL: r.PreviewImageURL,
			CreatedAt:       r.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, items)
}

// GetResume 返回指定 ID 的简历并标记为当前正在编辑。
func (h *ResumeHandler) GetResume(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	resume, err := h.getResumeForUser(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, errInvalidResumeID):
			BadRequest(c, "invalid resume id")
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "resume not found")
		default:
			Internal(c, "failed to query resume")
		}
		return
	}

	if err := h.setActiveResumeID(c.Request.Context(), userID, &resume.ID); err != nil {
		Internal(c, "failed to mark active resume")
		return
	}

	c.JSON(http.StatusOK, newResumeResponse(*resume))
}

// UpdateResume 覆盖指定简历。
func (h *ResumeHandler) UpdateResume(c *gin.Context) {
	var req createResumeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	resume, err := h.getResumeForUser(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, errInvalidResumeID):
			BadRequest(c, "invalid resume id")
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "resume not found")
		default:
			Internal(c, "failed to query resume")
		}
		return
	}

	updates := map[string]any{
		"title":   req.Title,
		"content": req.Content,
	}
	if req.PreviewImageURL != nil {
		updates["preview_image_url"] = *req.PreviewImageURL
	}

	ctx := c.Request.Context()
	if err := h.db.WithContext(ctx).Model(resume).Updates(updates).Error; err != nil {
		Internal(c, "failed to update resume")
		return
	}

	if err := h.db.WithContext(ctx).First(resume, resume.ID).Error; err != nil {
		Internal(c, "failed to reload resume")
		return
	}

	if err := h.setActiveResumeID(ctx, userID, &resume.ID); err != nil {
		Internal(c, "failed to mark active resume")
		return
	}

	c.JSON(http.StatusOK, newResumeResponse(*resume))
}

// DeleteResume 删除指定简历，并尝试回落到最近一份。
func (h *ResumeHandler) DeleteResume(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	resume, err := h.getResumeForUser(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, errInvalidResumeID):
			BadRequest(c, "invalid resume id")
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "resume not found")
		default:
			Internal(c, "failed to query resume")
		}
		return
	}

	ctx := c.Request.Context()
	if err := h.db.WithContext(ctx).Delete(&database.Resume{}, resume.ID).Error; err != nil {
		Internal(c, "failed to delete resume")
		return
	}

	if err := h.assignLatestResumeAsActive(ctx, userID); err != nil {
		Internal(c, "failed to update active resume")
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *ResumeHandler) setActiveResumeID(ctx context.Context, userID uint, resumeID *uint) error {
	var value any
	if resumeID != nil {
		value = *resumeID
	} else {
		value = nil
	}
	return h.db.WithContext(ctx).Model(&database.User{}).
		Where("id = ?", userID).
		Update("active_resume_id", value).Error
}

func (h *ResumeHandler) assignLatestResumeAsActive(ctx context.Context, userID uint) error {
	var resume database.Resume
	err := h.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at desc").
		First(&resume).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return h.setActiveResumeID(ctx, userID, nil)
	case err != nil:
		return err
	default:
		return h.setActiveResumeID(ctx, userID, &resume.ID)
	}
}

func (h *ResumeHandler) findActiveOrLatestResume(ctx context.Context, userID uint) (*database.Resume, error) {
	var user database.User
	if err := h.db.WithContext(ctx).
		Select("id", "active_resume_id").
		First(&user, userID).Error; err != nil {
		return nil, err
	}

	if user.ActiveResumeID != nil {
		var resume database.Resume
		if err := h.db.WithContext(ctx).
			Where("id = ? AND user_id = ?", *user.ActiveResumeID, userID).
			First(&resume).Error; err == nil {
			return &resume, nil
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	var latest database.Resume
	err := h.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at desc").
		First(&latest).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_ = h.setActiveResumeID(ctx, userID, nil)
		}
		return nil, err
	}

	if err := h.setActiveResumeID(ctx, userID, &latest.ID); err != nil {
		return nil, err
	}
	return &latest, nil
}

// DownloadResume 将 PDF 生成任务入队并立即返回 202。

func (h *ResumeHandler) DownloadResume(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	resume, err := h.getResumeForUser(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, errInvalidResumeID):
			BadRequest(c, "invalid resume id")
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "resume not found")
		default:
			Internal(c, "failed to query resume")
		}
		return
	}

	correlationID := middleware.GetCorrelationID(c)
	task, err := tasks.NewPDFGenerateTask(resume.ID, correlationID)
	if err != nil {
		Internal(c, "failed to create task")
		return
	}

	info, err := h.asynqClient.Enqueue(task, asynq.MaxRetry(5))
	if err != nil {
		Internal(c, "failed to enqueue pdf generation")
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
		AbortUnauthorized(c)
		return
	}

	resume, err := h.getResumeForUser(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		switch {
		case errors.Is(err, errInvalidResumeID):
			BadRequest(c, "invalid resume id")
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "resume not found")
		default:
			Internal(c, "failed to query resume")
		}
		return
	}

	if resume.PdfUrl == "" {
		Conflict(c, "pdf not ready")
		return
	}

	signedURL, err := h.storage.GeneratePresignedURL(c.Request.Context(), resume.PdfUrl, 5*time.Minute)
	if err != nil {
		Internal(c, "failed to generate download link")
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": signedURL})
}

// GetPrintResumeData 返回渲染 PDF 所需的 JSON 数据，附带预签名图像链接。
func (h *ResumeHandler) GetPrintResumeData(c *gin.Context) {
	if h.internalSecret == "" {
		Internal(c, "internal api secret is not configured")
		return
	}

	token := strings.TrimSpace(c.Query("internal_token"))
	if token == "" || token != h.internalSecret {
		Unauthorized(c)
		return
	}

	resumeID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		BadRequest(c, "invalid resume id")
		return
	}

	var resumeModel database.Resume
	ctx := c.Request.Context()
	if err := h.db.WithContext(ctx).First(&resumeModel, uint(resumeID)).Error; err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			NotFound(c, "resume not found")
		default:
			Internal(c, "failed to load resume")
		}
		return
	}

	var content resume.Content
	if err := json.Unmarshal(resumeModel.Content, &content); err != nil {
		Internal(c, "failed to decode resume")
		return
	}

	if err := inlineContentImages(ctx, h.storage, resumeModel.UserID, &content); err != nil {
		if status, ok := statusFromInlineError(err); ok {
			Error(c, status, err.Error())
			return
		}
		Internal(c, err.Error())
		return
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
		"margin_px":     36,
	}

	items := []map[string]any{
		{
			"id":      "item-1",
			"type":    "text",
			"content": "你的名字",
			"style": map[string]any{
				"fontSize":          "24pt",
				"fontWeight":        "bold",
				"backgroundColor":   "#f5e8ff",
				"backgroundOpacity": 0.75,
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
				"fontSize":          "14pt",
				"backgroundColor":   "#fff7d6",
				"backgroundOpacity": 0.68,
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
				"fontSize":          "10pt",
				"backgroundColor":   "#e7fbff",
				"backgroundOpacity": 0.72,
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
		ID:              resume.ID,
		Title:           resume.Title,
		Content:         resume.Content,
		PreviewImageURL: resume.PreviewImageURL,
		CreatedAt:       resume.CreatedAt,
		UpdatedAt:       resume.UpdatedAt,
	}
}

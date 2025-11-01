package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"phResume/internal/api/middleware"
	"phResume/internal/database"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

// ResumeHandler 负责处理与简历相关的 API 请求。
type ResumeHandler struct {
	db          *gorm.DB
	asynqClient *asynq.Client
	storage     *storage.Client
}

// NewResumeHandler 构造 ResumeHandler。
func NewResumeHandler(db *gorm.DB, asynqClient *asynq.Client, storageClient *storage.Client) *ResumeHandler {
	return &ResumeHandler{
		db:          db,
		asynqClient: asynqClient,
		storage:     storageClient,
	}
}

var errInvalidResumeID = errors.New("invalid resume id")

type createResumeRequest struct {
	Title   string `json:"title" binding:"required"`
	Content string `json:"content" binding:"required"`
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

	resume := database.Resume{
		Title:   req.Title,
		Content: req.Content,
		UserID:  userID,
	}

	if err := h.db.WithContext(c.Request.Context()).Create(&resume).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create resume"})
		return
	}

	c.JSON(http.StatusCreated, resume)
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

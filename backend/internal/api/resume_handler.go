package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"phResume/internal/api/middleware"
	"phResume/internal/database"
	"phResume/internal/tasks"
)

// ResumeHandler 负责处理与简历相关的 API 请求。
type ResumeHandler struct {
	db          *gorm.DB
	asynqClient *asynq.Client
}

// NewResumeHandler 构造 ResumeHandler。
func NewResumeHandler(db *gorm.DB, asynqClient *asynq.Client) *ResumeHandler {
	return &ResumeHandler{
		db:          db,
		asynqClient: asynqClient,
	}
}

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

	resume := database.Resume{
		Title:   req.Title,
		Content: req.Content,
		UserID:  1,
	}

	if err := h.db.WithContext(c.Request.Context()).Create(&resume).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create resume"})
		return
	}

	c.JSON(http.StatusCreated, resume)
}

// DownloadResume 将 PDF 生成任务入队并立即返回 202。
func (h *ResumeHandler) DownloadResume(c *gin.Context) {
	idParam := c.Param("id")
	resumeID, err := strconv.ParseUint(idParam, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resume id"})
		return
	}

	correlationID := middleware.GetCorrelationID(c)
	task, err := tasks.NewPDFGenerateTask(uint(resumeID), correlationID)
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

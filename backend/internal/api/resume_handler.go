package api

import (
	"bytes"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/pdf"
)

var resumeTemplate = template.Must(template.New("resume").Parse(`
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <title>{{.Title}}</title>
  <style>
    body { font-family: "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif; margin: 40px; color: #202124; }
    h1 { font-size: 28px; margin-bottom: 16px; }
    pre { white-space: pre-wrap; word-wrap: break-word; font-size: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <article>
    <h1>{{.Title}}</h1>
    <pre>{{.Content}}</pre>
  </article>
</body>
</html>
`))

// ResumeHandler 负责处理与简历相关的 API 请求。
type ResumeHandler struct {
	db *gorm.DB
}

// NewResumeHandler 构造 ResumeHandler。
func NewResumeHandler(db *gorm.DB) *ResumeHandler {
	return &ResumeHandler{db: db}
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

// DownloadResume 生成 PDF 并返回给客户端。
func (h *ResumeHandler) DownloadResume(c *gin.Context) {
	idParam := c.Param("id")
	resumeID, err := strconv.ParseUint(idParam, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resume id"})
		return
	}

	var resume database.Resume
	if err := h.db.WithContext(c.Request.Context()).First(&resume, resumeID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "resume not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query resume"})
		}
		return
	}

	var buf bytes.Buffer
	if err := resumeTemplate.Execute(&buf, resume); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to render resume"})
		return
	}

	pdfBytes, err := pdf.GeneratePDFFromHTML(buf.String())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate pdf"})
		return
	}

	filename := fmt.Sprintf("resume-%d.pdf", resume.ID)
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

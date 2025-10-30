package api

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes 注册 API 路由，不包含 /api 前缀。
func RegisterRoutes(router *gin.Engine, db *gorm.DB) {
	resumeHandler := NewResumeHandler(db)

	v1 := router.Group("/v1")
	{
		v1.POST("/resume", resumeHandler.CreateResume)
		v1.GET("/resume/:id/download", resumeHandler.DownloadResume)
	}
}

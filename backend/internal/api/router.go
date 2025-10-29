package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"phResume/internal/config"
)

// NewRouter 构建 Gin 路由引擎，目前仅暴露健康检查端点。
func NewRouter(_ *config.Config) *gin.Engine {
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	return router
}

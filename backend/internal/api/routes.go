package api

import (
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/api/middleware"
	"phResume/internal/auth"
	"phResume/internal/storage"
)

// RegisterRoutes 注册 API 路由，不包含 /api 前缀。
func RegisterRoutes(
	router *gin.Engine,
	db *gorm.DB,
	asynqClient *asynq.Client,
	authService *auth.AuthService,
	redisClient *redis.Client,
	logger *slog.Logger,
	storageClient *storage.Client,
	clamdAddr string,
) {
	resumeHandler := NewResumeHandler(db, asynqClient, storageClient)
	authHandler := NewAuthHandler(db, authService, redisClient, logger)
	wsHandler := NewWsHandler(redisClient, authService, logger)
	authMiddleware := middleware.AuthMiddleware(authService)
	assetHandler := NewAssetHandler(storageClient, logger, clamdAddr)

	v1 := router.Group("/v1")
	{
		v1.GET("/ws", wsHandler.HandleConnection)

		authGroup := v1.Group("/auth")
		{
			authGroup.POST("/register", authHandler.Register)
			authGroup.POST("/login", authHandler.Login)
			authGroup.POST("/refresh", authHandler.Refresh)
			authGroup.POST("/logout", authMiddleware, authHandler.Logout)
		}

		resumeGroup := v1.Group("/resume")
		resumeGroup.Use(authMiddleware)
		{
			resumeGroup.GET("/latest", resumeHandler.GetLatestResume)
			resumeGroup.POST("", resumeHandler.CreateResume)
			resumeGroup.GET("/:id/download", resumeHandler.DownloadResume)
			resumeGroup.GET("/:id/download-link", resumeHandler.GetDownloadLink)
		}

		assetGroup := v1.Group("/assets")
		assetGroup.Use(authMiddleware)
		{
			assetGroup.POST("/upload", assetHandler.UploadAsset)
			assetGroup.GET("/view", assetHandler.GetAssetURL)
		}
	}
}

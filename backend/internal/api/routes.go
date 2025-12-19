package api

import (
	"log/slog"
	"time"

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
	internalAPISecret string,
	clamdAddr string,
	maxResumes int,
	maxTemplates int,
	maxAssetsPerUser int,
	maxUploadsPerDay int,
	allowedOrigins []string,
	loginRateLimitPerHour int,
	loginLockThreshold int,
	loginLockTTL time.Duration,
	pdfRateLimitPerHour int,
	pdfDownloadTokenTTL time.Duration,
	uploadMaxBytes int,
	uploadMIMEWhitelist []string,
	cookieDomain string,
) {
	resumeHandler := NewResumeHandler(
		db,
		asynqClient,
		storageClient,
		internalAPISecret,
		maxResumes,
		redisClient,
		pdfRateLimitPerHour,
		pdfDownloadTokenTTL,
	)
	authHandler := NewAuthHandler(
		db,
		authService,
		redisClient,
		logger,
		loginRateLimitPerHour,
		loginLockThreshold,
		loginLockTTL,
		cookieDomain,
	)
	wsHandler := NewWsHandler(redisClient, authService, logger, allowedOrigins)
	authMiddleware := middleware.AuthMiddleware(authService)
	assetHandler := NewAssetHandler(db, storageClient, logger, clamdAddr, redisClient, maxAssetsPerUser, maxUploadsPerDay, uploadMaxBytes, uploadMIMEWhitelist)
	templateHandler := NewTemplateHandler(db, asynqClient, storageClient, internalAPISecret, maxTemplates)

	v1 := router.Group("/v1")
	{
		v1.GET("/ws", wsHandler.HandleConnection)

		authGroup := v1.Group("/auth")
		{
			authGroup.POST("/register", authHandler.Register)
			authGroup.POST("/login", authHandler.Login)
			authGroup.POST("/refresh", authHandler.Refresh)
			authGroup.POST("/logout", authMiddleware, authHandler.Logout)
			authGroup.POST("/change-password", authMiddleware, authHandler.ChangePassword)
		}

		v1.GET("/resume/print/:id", middleware.InternalSecretMiddleware(resumeHandler.internalSecret), resumeHandler.GetPrintResumeData)
		v1.GET("/templates/print/:id", middleware.InternalSecretMiddleware(templateHandler.internalSecret), templateHandler.GetPrintTemplateData)

		// PDF 下载中转（不依赖 Authorization Header，依赖短时效一次性 Token）
		v1.GET("/resume/:id/download-file", resumeHandler.DownloadResumeFile)

		resumeGroup := v1.Group("/resume")
		resumeGroup.Use(authMiddleware, middleware.RequirePasswordChangeCompletedMiddleware())
		{
			resumeGroup.GET("", resumeHandler.ListResumes)
			resumeGroup.GET("/latest", resumeHandler.GetLatestResume)
			resumeGroup.POST("", resumeHandler.CreateResume)
			resumeGroup.GET("/:id", resumeHandler.GetResume)
			resumeGroup.PUT("/:id", resumeHandler.UpdateResume)
			resumeGroup.DELETE("/:id", resumeHandler.DeleteResume)
			resumeGroup.GET("/:id/download", resumeHandler.DownloadResume)
			resumeGroup.GET("/:id/download-link", resumeHandler.GetDownloadLink)
		}

		assetGroup := v1.Group("/assets")
		assetGroup.Use(authMiddleware, middleware.RequirePasswordChangeCompletedMiddleware())
		{
			assetGroup.GET("", assetHandler.ListAssets)
			assetGroup.POST("/upload", assetHandler.UploadAsset)
			assetGroup.GET("/view", assetHandler.GetAssetURL)
			assetGroup.DELETE("", assetHandler.DeleteAsset)
		}

		templatesGroup := v1.Group("/templates")
		templatesGroup.Use(authMiddleware, middleware.RequirePasswordChangeCompletedMiddleware())
		{
			templatesGroup.GET("", templateHandler.ListTemplates)
			templatesGroup.GET("/:id", templateHandler.GetTemplate)
			templatesGroup.POST("", templateHandler.CreateTemplate)
			templatesGroup.POST("/:id/generate-preview", templateHandler.GeneratePreview)
			templatesGroup.DELETE("/:id", templateHandler.DeleteTemplate)
		}
	}
}

package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/api"
	"phResume/internal/api/middleware"
	"phResume/internal/auth"
	"phResume/internal/config"
	"phResume/internal/database"
	"phResume/internal/metrics"
	"phResume/internal/storage"
)

func main() {
	cfg := config.MustLoad()
	log.Printf("api bootstrapped with db host=%s port=%d db=%s sslmode=%s",
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.Name,
		cfg.Database.SSLMode,
	)

	slogLogger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(slogLogger)

	authService, err := auth.NewAuthService(
		cfg.JWT.PrivateKeyPEM,
		cfg.JWT.PublicKeyPEM,
		cfg.JWT.AccessTokenTTL,
		cfg.JWT.RefreshTokenTTL,
	)
	if err != nil {
		log.Fatalf("init auth service: %v", err)
	}

	db, err := database.InitDatabase(cfg.Database)
	if err != nil {
		log.Fatalf("init database: %v", err)
	}
	log.Printf("database connection ready")

	if err := db.AutoMigrate(&database.User{}, &database.Resume{}, &database.Template{}); err != nil {
		log.Fatalf("auto migrate: %v", err)
	}
	log.Printf("database migrated")

	storageClient, err := storage.NewClient(cfg.MinIO)
	if err != nil {
		log.Fatalf("init storage client: %v", err)
	}

	var seedUser database.User
	switch err := db.First(&seedUser, 1).Error; {
	case err == nil:
		// seeded user already present
	case errors.Is(err, gorm.ErrRecordNotFound):
		hashed, hashErr := authService.HashPassword("seeded-password")
		if hashErr != nil {
			log.Fatalf("hash seed user password: %v", hashErr)
		}
		seeded := database.User{Model: gorm.Model{ID: 1}, Username: "test_user", PasswordHash: hashed}
		if err := db.Create(&seeded).Error; err != nil {
			log.Fatalf("seed default user: %v", err)
		}
		log.Printf("seeded default user with ID 1")
	default:
		log.Fatalf("query default user: %v", err)
	}

	address := fmt.Sprintf(":%d", cfg.API.Port)
	log.Printf("api listening on %s", address)

	redisAddr := fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port)
	redisClient := redis.NewClient(&redis.Options{Addr: redisAddr})
	defer func() {
		if err := redisClient.Close(); err != nil {
			log.Printf("close redis client: %v", err)
		}
	}()
	if err := redisClient.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("ping redis: %v", err)
	}

	asynqClient := asynq.NewClient(asynq.RedisClientOpt{Addr: redisAddr})
	defer func() {
		if err := asynqClient.Close(); err != nil {
			log.Printf("close asynq client: %v", err)
		}
	}()

	clamdAddr := fmt.Sprintf("tcp://%s:%s", cfg.ClamAV.Host, cfg.ClamAV.Port)

	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(metrics.GinMiddleware())
	router.Use(middleware.CorrelationIDMiddleware())
	router.Use(middleware.SlogLoggerMiddleware(slogLogger))
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))

	api.RegisterRoutes(router, db, asynqClient, authService, redisClient, slogLogger, storageClient, clamdAddr)

	if err := router.Run(address); err != nil {
		log.Fatalf("failed to start api server: %v", err)
	}
}

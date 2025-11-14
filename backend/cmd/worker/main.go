package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/hibiken/asynq"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"

	"phResume/internal/config"
	"phResume/internal/database"
	"phResume/internal/metrics"
	"phResume/internal/storage"
	"phResume/internal/tasks"
	"phResume/internal/worker"
)

func main() {
	cfg := config.MustLoad()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	db, err := database.InitDatabase(cfg.Database)
	if err != nil {
		log.Fatalf("init database: %v", err)
	}
	log.Println("database connection ready for worker")

	if err := db.AutoMigrate(&database.User{}, &database.Resume{}, &database.Template{}); err != nil {
		log.Fatalf("auto migrate: %v", err)
	}
	log.Println("worker database migrated")

	storageClient, err := storage.NewClient(cfg.MinIO)
	if err != nil {
		log.Fatalf("init storage client: %v", err)
	}
	log.Printf("storage client ready, bucket=%s", cfg.MinIO.Bucket)

	redisAddr := fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port)
	redisClient := redis.NewClient(&redis.Options{Addr: redisAddr})
	defer func() {
		if err := redisClient.Close(); err != nil {
			logger.Error("close redis client failed", slog.Any("error", err))
		}
	}()

	if err := redisClient.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("ping redis: %v", err)
	}

	redisOpt := asynq.RedisClientOpt{Addr: redisAddr}
	server := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: 10,
	})

	go func() {
		metricsMux := http.NewServeMux()
		metricsMux.Handle("/metrics", promhttp.Handler())

		logger.Info("worker metrics server started", slog.String("addr", ":9100"))
		if err := http.ListenAndServe(":9100", metricsMux); err != nil {
			log.Fatalf("could not start worker metrics server: %v", err)
		}
	}()

	internalSecret := os.Getenv("INTERNAL_API_SECRET")
	if internalSecret == "" {
		logger.Warn("INTERNAL_API_SECRET is empty, worker cannot call print API securely")
	}

	pdfHandler := worker.NewPDFTaskHandler(db, storageClient, redisClient, logger, internalSecret)

	mux := asynq.NewServeMux()
	mux.Use(metrics.AsynqMetricsMiddleware())
	mux.Handle(tasks.TypePDFGenerate, pdfHandler)

	logger.Info("worker service started", slog.String("redis_addr", redisAddr))
	if err := server.Run(mux); err != nil {
		logger.Error("worker server stopped", slog.Any("error", err))
	}
}

package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"os"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"

	"phResume/internal/config"
	"phResume/internal/database"
	"phResume/internal/storage"
	"phResume/internal/tasks"
	"phResume/internal/worker"
)

func main() {
	cfg := config.MustLoad()

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	db, err := database.InitDatabase(cfg.Database)
	if err != nil {
		log.Fatalf("init database: %v", err)
	}
	log.Println("database connection ready for worker")

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

	pdfHandler := worker.NewPDFTaskHandler(db, storageClient, redisClient, logger)

	mux := asynq.NewServeMux()
	mux.Handle(tasks.TypePDFGenerate, pdfHandler)

	logger.Info("worker service started", slog.String("redis_addr", redisAddr))
	if err := server.Run(mux); err != nil {
		logger.Error("worker server stopped", slog.Any("error", err))
	}
}

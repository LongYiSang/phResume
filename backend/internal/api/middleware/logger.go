package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

const slogLoggerKey = "slogLogger"

// SlogLoggerMiddleware 将 slog 集成到 Gin，并注入 Correlation ID。
func SlogLoggerMiddleware(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		correlationID := GetCorrelationID(c)
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		requestLogger := logger.With(
			slog.String("correlation_id", correlationID),
			slog.String("method", c.Request.Method),
			slog.String("path", path),
		)
		c.Set(slogLoggerKey, requestLogger)

		start := time.Now()
		c.Next()

		requestLogger.Info("request completed",
			slog.Int("status", c.Writer.Status()),
			slog.Duration("latency", time.Since(start)),
		)
	}
}

// LoggerFromContext 返回上下文中的 slog.Logger。
func LoggerFromContext(c *gin.Context) *slog.Logger {
	if value, ok := c.Get(slogLoggerKey); ok {
		if logger, ok := value.(*slog.Logger); ok {
			return logger
		}
	}
	return slog.Default()
}

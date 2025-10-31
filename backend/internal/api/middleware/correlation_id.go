package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const correlationIDKey = "correlationID"

// CorrelationIDMiddleware 确保每个请求都带有 Correlation ID。
func CorrelationIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Correlation-ID")
		if id == "" {
			id = uuid.NewString()
		}

		c.Set(correlationIDKey, id)
		c.Header("X-Correlation-ID", id)

		c.Next()
	}
}

// GetCorrelationID 从上下文中取出 Correlation ID。
func GetCorrelationID(c *gin.Context) string {
	if value, ok := c.Get(correlationIDKey); ok {
		if id, ok := value.(string); ok {
			return id
		}
	}
	return ""
}

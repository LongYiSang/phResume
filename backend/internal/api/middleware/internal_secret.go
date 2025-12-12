package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func InternalSecretMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(secret) == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal api secret is not configured"})
			c.Abort()
			return
		}
		// 内部调用必须通过 Header 传递密钥，避免 query 泄露到浏览器/日志。
		token := strings.TrimSpace(c.GetHeader("X-Internal-Secret"))
		if token == "" || token != secret {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

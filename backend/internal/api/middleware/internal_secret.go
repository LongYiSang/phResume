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
		token := strings.TrimSpace(c.Query("internal_token"))
		if token == "" || token != secret {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

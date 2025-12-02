package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"phResume/internal/auth"
)

// AuthMiddleware 校验访问令牌并将 userID 注入上下文。
func abortUnauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
}

func AuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			abortUnauthorized(c)
			return
		}

		parts := strings.Fields(header)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			abortUnauthorized(c)
			return
		}

		rawToken := parts[1]
		if strings.TrimSpace(rawToken) == "" {
			abortUnauthorized(c)
			return
		}

		claims, err := authService.ValidateToken(rawToken)
		if err != nil || claims.TokenType != "access" {
			abortUnauthorized(c)
			return
		}

		c.Set("userID", claims.UserID)
		c.Next()
	}
}

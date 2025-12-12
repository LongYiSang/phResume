package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const passwordChangeRequiredMessage = "password change required"

// RequirePasswordChangeCompletedMiddleware 阻止未完成改密的账号访问业务接口。
// 仅依赖 access token 内的 must_change_password 声明，避免每次请求都查库。
func RequirePasswordChangeCompletedMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		value, ok := c.Get("mustChangePassword")
		if ok {
			if mustChange, ok := value.(bool); ok && mustChange {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": passwordChangeRequiredMessage})
				return
			}
		}
		c.Next()
	}
}

package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func Error(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"error": msg})
}

func AbortUnauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
}

func Unauthorized(c *gin.Context)           { Error(c, http.StatusUnauthorized, "unauthorized") }
func BadRequest(c *gin.Context, msg string) { Error(c, http.StatusBadRequest, msg) }
func Forbidden(c *gin.Context, msg string)  { Error(c, http.StatusForbidden, msg) }
func NotFound(c *gin.Context, msg string)   { Error(c, http.StatusNotFound, msg) }
func Conflict(c *gin.Context, msg string)   { Error(c, http.StatusConflict, msg) }
func Internal(c *gin.Context, msg string)   { Error(c, http.StatusInternalServerError, msg) }

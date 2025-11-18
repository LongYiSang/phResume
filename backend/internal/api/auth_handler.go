package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/api/middleware"
	"phResume/internal/auth"
	"phResume/internal/database"
)

const refreshTokenCookieName = "refresh_token"
const refreshTokenBlacklistKeyPrefix = "auth:refresh:blacklist:"

// AuthHandler 处理注册、登录、刷新与退出。
type AuthHandler struct {
	db          *gorm.DB
	authService *auth.AuthService
	redis       redis.UniversalClient
	logger      *slog.Logger
}

// NewAuthHandler 构造认证处理器。
func NewAuthHandler(db *gorm.DB, authService *auth.AuthService, redisClient redis.UniversalClient, logger *slog.Logger) *AuthHandler {
	return &AuthHandler{
		db:          db,
		authService: authService,
		redis:       redisClient,
		logger:      logger,
	}
}

type registerRequest struct {
	Username string `json:"username" binding:"required,min=3,max=64"`
	Password string `json:"password" binding:"required,min=8,max=72"`
}

// Register 创建新用户账号。
func (h *AuthHandler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c).With(
		slog.String("username", req.Username),
	)

	var existing database.User
	if err := h.db.WithContext(ctx).Where("username = ?", req.Username).First(&existing).Error; err == nil {
		logger.Info("register conflict: user already exists")
		c.JSON(http.StatusConflict, gin.H{"error": "username already taken"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		logger.Error("register lookup failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	hashed, err := h.authService.HashPassword(req.Password)
	if err != nil {
		logger.Error("hash password failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	user := database.User{
		Username:     req.Username,
		PasswordHash: hashed,
	}

	if err := h.db.WithContext(ctx).Create(&user).Error; err != nil {
		logger.Error("create user failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	logger.Info("user registered", slog.Uint64("user_id", uint64(user.ID)))
	c.Status(http.StatusCreated)
}

type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// Login 校验口令并返回 Token。
func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c).With(
		slog.String("username", req.Username),
	)

	var user database.User
	if err := h.db.WithContext(ctx).Where("username = ?", req.Username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Info("login failed: user not found")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
		logger.Error("login query failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	if !h.authService.CheckPasswordHash(req.Password, user.PasswordHash) {
		logger.Info("login failed: password mismatch", slog.Uint64("user_id", uint64(user.ID)))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	tokenPair, err := h.authService.GenerateTokenPair(user.ID)
	if err != nil {
		logger.Error("generate token pair failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	h.setRefreshCookie(c, tokenPair.RefreshToken)

	c.JSON(http.StatusOK, gin.H{
		"access_token": tokenPair.AccessToken,
		"token_type":   "Bearer",
		"expires_in":   int(h.authService.AccessTokenTTL().Seconds()),
	})
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// Refresh 校验刷新令牌并颁发新的 TokenPair。
func (h *AuthHandler) Refresh(c *gin.Context) {
	refreshToken := h.extractRefreshToken(c)
	if refreshToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token missing"})
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c)

	claims, err := h.authService.ValidateToken(refreshToken)
	if err != nil {
		logger.Info("refresh token invalid", slog.Any("error", err))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}
	if claims.TokenType != "refresh" {
		logger.Info("refresh token wrong type", slog.String("token_type", claims.TokenType))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	if claims.ID == "" {
		logger.Info("refresh token missing jti")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	key := refreshTokenBlacklistKeyPrefix + claims.ID
	if err := h.redis.Get(ctx, key).Err(); err == nil {
		logger.Info("refresh token revoked", slog.String("jti", claims.ID))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token revoked"})
		return
	} else if !errors.Is(err, redis.Nil) {
		logger.Error("refresh token blacklist lookup failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	tokenPair, err := h.authService.GenerateTokenPair(claims.UserID)
	if err != nil {
		logger.Error("refresh generate token pair failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// 旋转旧刷新令牌，防止重复使用。
	if err := h.revokeRefreshToken(ctx, key, claims.ExpiresAt); err != nil {
		logger.Error("refresh revoke old token failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	h.setRefreshCookie(c, tokenPair.RefreshToken)

	c.JSON(http.StatusOK, gin.H{
		"access_token": tokenPair.AccessToken,
		"token_type":   "Bearer",
		"expires_in":   int(h.authService.AccessTokenTTL().Seconds()),
	})
}

// Logout 将刷新令牌加入黑名单，防止继续使用。
func (h *AuthHandler) Logout(c *gin.Context) {
	refreshToken := h.extractRefreshToken(c)
	if refreshToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refresh token missing"})
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c)

	claims, err := h.authService.ValidateToken(refreshToken)
	if err != nil {
		logger.Info("logout token invalid", slog.Any("error", err))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}
	if claims.TokenType != "refresh" {
		logger.Info("logout wrong token type", slog.String("token_type", claims.TokenType))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}
	if claims.ID == "" {
		logger.Info("logout token missing jti")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}

	key := refreshTokenBlacklistKeyPrefix + claims.ID
	if err := h.revokeRefreshToken(ctx, key, claims.ExpiresAt); err != nil {
		logger.Error("logout revoke token failed", slog.Any("error", err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		return
	}

	// 清除 Cookie。
	c.SetCookie(refreshTokenCookieName, "", -1, "/", "", h.isHTTPSRequest(c), true)
	c.Status(http.StatusOK)
}

func (h *AuthHandler) extractRefreshToken(c *gin.Context) string {
	if token, err := c.Cookie(refreshTokenCookieName); err == nil && token != "" {
		return token
	}

	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err == nil && req.RefreshToken != "" {
		return req.RefreshToken
	}
	return ""
}

func (h *AuthHandler) setRefreshCookie(c *gin.Context, refreshToken string) {
	maxAge := int(h.authService.RefreshTokenTTL().Seconds())
	if maxAge <= 0 {
		maxAge = int(time.Hour.Seconds())
	}
	c.SetCookie(
		refreshTokenCookieName,
		refreshToken,
		maxAge,
		"/",
		"",
		h.isHTTPSRequest(c),
		true,
	)
}

func (h *AuthHandler) revokeRefreshToken(ctx context.Context, key string, expiresAt *jwt.NumericDate) error {
	var ttl time.Duration
	if expiresAt == nil {
		ttl = h.authService.RefreshTokenTTL()
	} else {
		ttl = time.Until(expiresAt.Time)
	}
	if ttl <= 0 {
		ttl = time.Second
	}
	return h.redis.Set(ctx, key, "revoked", ttl).Err()
}

func (h *AuthHandler) loggerFromContext(c *gin.Context) *slog.Logger {
	if logger := middleware.LoggerFromContext(c); logger != nil {
		return logger
	}
	if h.logger != nil {
		return h.logger
	}
	return slog.Default()
}

func (h *AuthHandler) isHTTPSRequest(c *gin.Context) bool {
	if c.Request == nil {
		return false
	}
	if c.Request.TLS != nil {
		return true
	}
	return strings.EqualFold(c.Request.Header.Get("X-Forwarded-Proto"), "https")
}

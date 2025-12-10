package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	stdhttp "net/http"
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
	db                    *gorm.DB
	authService           *auth.AuthService
	redis                 redis.UniversalClient
	logger                *slog.Logger
	loginRateLimitPerHour int
	loginLockThreshold    int
	loginLockTTL          time.Duration
}

// NewAuthHandler 构造认证处理器。
func NewAuthHandler(db *gorm.DB, authService *auth.AuthService, redisClient redis.UniversalClient, logger *slog.Logger, loginRateLimitPerHour int, loginLockThreshold int, loginLockTTL time.Duration) *AuthHandler {
	return &AuthHandler{
		db:                    db,
		authService:           authService,
		redis:                 redisClient,
		logger:                logger,
		loginRateLimitPerHour: loginRateLimitPerHour,
		loginLockThreshold:    loginLockThreshold,
		loginLockTTL:          loginLockTTL,
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
		BadRequest(c, err.Error())
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c).With(
		slog.String("username", req.Username),
	)

	var existing database.User
	if err := h.db.WithContext(ctx).Where("username = ?", req.Username).First(&existing).Error; err == nil {
		logger.Info("register conflict: user already exists")
		Conflict(c, "username already taken")
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		logger.Error("register lookup failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	hashed, err := h.authService.HashPassword(req.Password)
	if err != nil {
		logger.Error("hash password failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	user := database.User{
		Username:     req.Username,
		PasswordHash: hashed,
	}

	if err := h.db.WithContext(ctx).Create(&user).Error; err != nil {
		logger.Error("create user failed", slog.Any("error", err))
		Internal(c, "internal error")
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
	ip := c.ClientIP()
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c).With(
		slog.String("username", req.Username),
	)

	// 速率限制：每 IP+用户名 每小时 10 次
	rateKey := "rate:login:" + ip + ":" + strings.ToLower(req.Username) + ":" + time.Now().UTC().Format("2006010215")
	count, _ := h.redis.Incr(ctx, rateKey).Result()
	if count == 1 {
		_ = h.redis.Expire(ctx, rateKey, time.Hour).Err()
	}
	if count > int64(h.loginRateLimitPerHour) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
		return
	}

	// 锁定检查
	lockKey := "lock:login:" + strings.ToLower(req.Username)
	if ttl, _ := h.redis.TTL(ctx, lockKey).Result(); ttl > 0 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "account temporarily locked"})
		return
	}

	var user database.User
	if err := h.db.WithContext(ctx).Where("username = ?", req.Username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Info("login failed: user not found")
			_ = h.incrementLoginFail(ctx, strings.ToLower(req.Username))
			Unauthorized(c)
			return
		}
		logger.Error("login query failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	if !h.authService.CheckPasswordHash(req.Password, user.PasswordHash) {
		logger.Info("login failed: password mismatch", slog.Uint64("user_id", uint64(user.ID)))
		_ = h.incrementLoginFail(ctx, strings.ToLower(req.Username))
		Unauthorized(c)
		return
	}

	// 登录成功：清理失败计数
	_ = h.redis.Del(ctx, "lock:login:fail:"+strings.ToLower(req.Username)).Err()

	tokenPair, err := h.authService.GenerateTokenPair(user.ID)
	if err != nil {
		logger.Error("generate token pair failed", slog.Any("error", err))
		Internal(c, "internal error")
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
		Unauthorized(c)
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c)

	claims, err := h.authService.ValidateToken(refreshToken)
	if err != nil {
		logger.Info("refresh token invalid", slog.Any("error", err))
		Unauthorized(c)
		return
	}
	if claims.TokenType != "refresh" {
		logger.Info("refresh token wrong type", slog.String("token_type", claims.TokenType))
		Unauthorized(c)
		return
	}

	if claims.ID == "" {
		logger.Info("refresh token missing jti")
		Unauthorized(c)
		return
	}

	key := refreshTokenBlacklistKeyPrefix + claims.ID
	if err := h.redis.Get(ctx, key).Err(); err == nil {
		logger.Info("refresh token revoked", slog.String("jti", claims.ID))
		Unauthorized(c)
		return
	} else if !errors.Is(err, redis.Nil) {
		logger.Error("refresh token blacklist lookup failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	tokenPair, err := h.authService.GenerateTokenPair(claims.UserID)
	if err != nil {
		logger.Error("refresh generate token pair failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	// 旋转旧刷新令牌，防止重复使用。
	if err := h.revokeRefreshToken(ctx, key, claims.ExpiresAt); err != nil {
		logger.Error("refresh revoke old token failed", slog.Any("error", err))
		Internal(c, "internal error")
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
		BadRequest(c, "refresh token missing")
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c)

	claims, err := h.authService.ValidateToken(refreshToken)
	if err != nil {
		logger.Info("logout token invalid", slog.Any("error", err))
		Unauthorized(c)
		return
	}
	if claims.TokenType != "refresh" {
		logger.Info("logout wrong token type", slog.String("token_type", claims.TokenType))
		Unauthorized(c)
		return
	}
	if claims.ID == "" {
		logger.Info("logout token missing jti")
		Unauthorized(c)
		return
	}

	key := refreshTokenBlacklistKeyPrefix + claims.ID
	if err := h.revokeRefreshToken(ctx, key, claims.ExpiresAt); err != nil {
		logger.Error("logout revoke token failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	// 清除 Cookie。
	stdhttp.SetCookie(c.Writer, &stdhttp.Cookie{
		Name:     refreshTokenCookieName,
		Value:    "",
		MaxAge:   -1,
		Path:     "/",
		Secure:   h.isHTTPSRequest(c),
		HttpOnly: true,
		SameSite: stdhttp.SameSiteLaxMode,
	})
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
	cookie := &stdhttp.Cookie{
		Name:     refreshTokenCookieName,
		Value:    refreshToken,
		MaxAge:   maxAge,
		Path:     "/",
		Secure:   h.isHTTPSRequest(c),
		HttpOnly: true,
		SameSite: stdhttp.SameSiteLaxMode,
	}
	stdhttp.SetCookie(c.Writer, cookie)
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
func (h *AuthHandler) incrementLoginFail(ctx context.Context, username string) error {
	failKey := "lock:login:fail:" + username
	count, err := h.redis.Incr(ctx, failKey).Result()
	if err != nil {
		return err
	}
	if count == 1 {
		_ = h.redis.Expire(ctx, failKey, h.loginLockTTL).Err()
	}
	if count >= int64(h.loginLockThreshold) {
		_ = h.redis.Set(ctx, "lock:login:"+username, "1", h.loginLockTTL).Err()
	}
	return nil
}

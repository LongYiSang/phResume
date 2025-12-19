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
	cookieDomain          string
}

// NewAuthHandler 构造认证处理器。
func NewAuthHandler(db *gorm.DB, authService *auth.AuthService, redisClient redis.UniversalClient, logger *slog.Logger, loginRateLimitPerHour int, loginLockThreshold int, loginLockTTL time.Duration, cookieDomain string) *AuthHandler {
	return &AuthHandler{
		db:                    db,
		authService:           authService,
		redis:                 redisClient,
		logger:                logger,
		loginRateLimitPerHour: loginRateLimitPerHour,
		loginLockThreshold:    loginLockThreshold,
		loginLockTTL:          loginLockTTL,
		cookieDomain:          cookieDomain,
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

type tokenResponse struct {
	AccessToken        string `json:"access_token"`
	TokenType          string `json:"token_type"`
	ExpiresIn          int    `json:"expires_in"`
	MustChangePassword bool   `json:"must_change_password"`
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
	count, err := incrWithTTL(ctx, h.redis, rateKey, time.Hour)
	if err != nil {
		count = 0
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

	mustChangePassword := user.MustChangePassword
	tokenPair, err := h.authService.GenerateTokenPair(user.ID, mustChangePassword)
	if err != nil {
		logger.Error("generate token pair failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	h.replyWithTokenPair(c, tokenPair, mustChangePassword)
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

	var user database.User
	if err := h.db.WithContext(ctx).First(&user, claims.UserID).Error; err != nil {
		logger.Info("refresh user not found", slog.Any("error", err))
		Unauthorized(c)
		return
	}

	mustChangePassword := user.MustChangePassword
	tokenPair, err := h.authService.GenerateTokenPair(claims.UserID, mustChangePassword)
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

	h.replyWithTokenPair(c, tokenPair, mustChangePassword)
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required,min=8,max=72"`
	NewPassword     string `json:"new_password" binding:"required,min=8,max=72"`
	ConfirmPassword string `json:"confirm_password" binding:"required,min=8,max=72"`
}

// ChangePassword 校验当前密码并更新为新密码。
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		BadRequest(c, err.Error())
		return
	}
	if req.NewPassword != req.ConfirmPassword {
		BadRequest(c, "password confirmation does not match")
		return
	}

	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()
	logger := h.loggerFromContext(c).With(slog.Uint64("user_id", uint64(userID)))

	var user database.User
	if err := h.db.WithContext(ctx).First(&user, userID).Error; err != nil {
		logger.Info("change password: user not found", slog.Any("error", err))
		Unauthorized(c)
		return
	}

	if !h.authService.CheckPasswordHash(req.CurrentPassword, user.PasswordHash) {
		logger.Info("change password: current password mismatch")
		Unauthorized(c)
		return
	}

	if strings.TrimSpace(req.NewPassword) == strings.TrimSpace(req.CurrentPassword) {
		BadRequest(c, "new password must be different from current password")
		return
	}

	hashed, err := h.authService.HashPassword(req.NewPassword)
	if err != nil {
		logger.Error("change password: hash failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	if err := h.db.WithContext(ctx).Model(&user).Updates(map[string]any{
		"password_hash":        hashed,
		"must_change_password": false,
	}).Error; err != nil {
		logger.Error("change password: update failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	if refreshToken, err := c.Cookie(refreshTokenCookieName); err == nil && refreshToken != "" {
		if claims, err := h.authService.ValidateToken(refreshToken); err == nil && claims.TokenType == "refresh" && claims.ID != "" {
			key := refreshTokenBlacklistKeyPrefix + claims.ID
			if err := h.revokeRefreshToken(ctx, key, claims.ExpiresAt); err != nil {
				logger.Error("change password: revoke refresh failed", slog.Any("error", err))
				Internal(c, "internal error")
				return
			}
		}
	}

	tokenPair, err := h.authService.GenerateTokenPair(user.ID, false)
	if err != nil {
		logger.Error("change password: generate token pair failed", slog.Any("error", err))
		Internal(c, "internal error")
		return
	}

	h.replyWithTokenPair(c, tokenPair, false)
}

func (h *AuthHandler) replyWithTokenPair(c *gin.Context, tokenPair auth.TokenPair, mustChangePassword bool) {
	h.setRefreshCookie(c, tokenPair.RefreshToken)
	c.JSON(http.StatusOK, tokenResponse{
		AccessToken:        tokenPair.AccessToken,
		TokenType:          "Bearer",
		ExpiresIn:          int(h.authService.AccessTokenTTL().Seconds()),
		MustChangePassword: mustChangePassword,
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
		Domain:   h.getCookieDomain(),
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
		Domain:   h.getCookieDomain(),
		Expires:  time.Now().Add(h.authService.RefreshTokenTTL()),
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
func (h *AuthHandler) getCookieDomain() string { return strings.TrimSpace(h.cookieDomain) }
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

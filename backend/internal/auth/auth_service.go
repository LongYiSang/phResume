package auth

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// AuthService 负责处理密码哈希、JWT 生成与校验。
type AuthService struct {
	privateKey      *rsa.PrivateKey
	publicKey       *rsa.PublicKey
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

// TokenPair 封装访问令牌与刷新令牌。
type TokenPair struct {
	AccessToken  string
	RefreshToken string
}

// TokenClaims 表示 JWT 中的业务字段，便于中间件读取用户信息。
type TokenClaims struct {
	UserID    uint   `json:"user_id"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

// NewAuthService 解析 PEM 密钥并构造服务实例。
func NewAuthService(privateKeyPEM, publicKeyPEM []byte, accessTTL, refreshTTL time.Duration) (*AuthService, error) {
	if len(privateKeyPEM) == 0 {
		return nil, errors.New("private key pem is required")
	}
	if len(publicKeyPEM) == 0 {
		return nil, errors.New("public key pem is required")
	}

	privateKey, err := jwt.ParseRSAPrivateKeyFromPEM(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("parse rsa private key: %w", err)
	}
	publicKey, err := jwt.ParseRSAPublicKeyFromPEM(publicKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("parse rsa public key: %w", err)
	}

	return &AuthService{
		privateKey:      privateKey,
		publicKey:       publicKey,
		accessTokenTTL:  accessTTL,
		refreshTokenTTL: refreshTTL,
	}, nil
}

// HashPassword 使用 bcrypt 生成密码哈希。
func (s *AuthService) HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(bytes), nil
}

// CheckPasswordHash 校验密码是否匹配哈希。
func (s *AuthService) CheckPasswordHash(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// GenerateTokenPair 创建访问令牌与刷新令牌。
func (s *AuthService) GenerateTokenPair(userID uint) (TokenPair, error) {
	now := time.Now()

	accessClaims := TokenClaims{
		UserID:    userID,
		TokenType: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatUint(uint64(userID), 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.accessTokenTTL)),
		},
	}
	refreshClaims := TokenClaims{
		UserID:    userID,
		TokenType: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatUint(uint64(userID), 10),
			ID:        uuid.NewString(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.refreshTokenTTL)),
		},
	}

	accessToken, err := s.signClaims(accessClaims)
	if err != nil {
		return TokenPair{}, err
	}
	refreshToken, err := s.signClaims(refreshClaims)
	if err != nil {
		return TokenPair{}, err
	}

	return TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	}, nil
}

// ValidateToken 解析并验证 JWT。
func (s *AuthService) ValidateToken(tokenString string) (*TokenClaims, error) {
	if tokenString == "" {
		return nil, errors.New("token string is empty")
	}

	token, err := jwt.ParseWithClaims(tokenString, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method.Alg() != jwt.SigningMethodRS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %s", token.Method.Alg())
		}
		return s.publicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	claims, ok := token.Claims.(*TokenClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token claims")
	}

	return claims, nil
}

func (s *AuthService) signClaims(claims TokenClaims) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(s.privateKey)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}

// AccessTokenTTL 暴露访问令牌有效期。
func (s *AuthService) AccessTokenTTL() time.Duration {
	return s.accessTokenTTL
}

// RefreshTokenTTL 暴露刷新令牌有效期。
func (s *AuthService) RefreshTokenTTL() time.Duration {
	return s.refreshTokenTTL
}

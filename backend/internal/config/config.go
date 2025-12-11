package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config aggregates application settings that may be sourced from files or environment variables.
type Config struct {
	API      APIConfig      `mapstructure:"api"`
	Database DatabaseConfig `mapstructure:"database"`
	Redis    RedisConfig    `mapstructure:"redis"`
	MinIO    MinIOConfig    `mapstructure:"minio"`
	JWT      JWTConfig      `mapstructure:"jwt"`
	ClamAV   ClamAVConfig   `mapstructure:"clamav"`
}

// APIConfig contains HTTP server settings.
type APIConfig struct {
	Port                   int           `mapstructure:"port"`
	MaxResumes             int           `mapstructure:"max_resumes"`
	MaxTemplates           int           `mapstructure:"max_templates"`
	LoginRateLimitPerHour  int           `mapstructure:"login_rate_limit_per_hour"`
	LoginLockThreshold     int           `mapstructure:"login_lock_threshold"`
	LoginLockTTLRaw        string        `mapstructure:"login_lock_ttl"`
	LoginLockTTL           time.Duration `mapstructure:"-"`
	AllowedOriginsRaw      string        `mapstructure:"allowed_origins"`
	AllowedOrigins         []string      `mapstructure:"-"`
	UploadMaxBytes         int           `mapstructure:"upload_max_bytes"`
	UploadMIMEWhitelistRaw string        `mapstructure:"upload_mime_whitelist"`
	UploadMIMEWhitelist    []string      `mapstructure:"-"`
	PdfRateLimitPerHour    int           `mapstructure:"pdf_rate_limit_per_hour"`
	UploadRateLimitPerHour int           `mapstructure:"upload_rate_limit_per_hour"`
	CookieDomain           string        `mapstructure:"cookie_domain"`
}

// DatabaseConfig contains connection options for PostgreSQL.
type DatabaseConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Name     string `mapstructure:"name"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	SSLMode  string `mapstructure:"sslmode"`
}

// RedisConfig 包含 Redis 连接配置。
type RedisConfig struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}

// MinIOConfig contains connection options for MinIO/S3-compatible storage.
type MinIOConfig struct {
	Endpoint        string `mapstructure:"endpoint"`
	AccessKeyID     string `mapstructure:"access_key_id"`
	SecretAccessKey string `mapstructure:"secret_access_key"`
	UseSSL          bool   `mapstructure:"use_ssl"`
	Bucket          string `mapstructure:"bucket"`
	PublicEndpoint  string `mapstructure:"public_endpoint"`
}

// ClamAVConfig contains connection options for ClamAV scanning service.
type ClamAVConfig struct {
	Host string `mapstructure:"host"`
	Port string `mapstructure:"port"`
}

// JWTConfig 包含 JWT 密钥与时效配置。
type JWTConfig struct {
	PrivateKeyBase64   string `mapstructure:"private_key"`
	PublicKeyBase64    string `mapstructure:"public_key"`
	AccessTokenTTLRaw  string `mapstructure:"access_token_ttl"`
	RefreshTokenTTLRaw string `mapstructure:"refresh_token_ttl"`

	PrivateKeyPEM   []byte        `mapstructure:"-"`
	PublicKeyPEM    []byte        `mapstructure:"-"`
	AccessTokenTTL  time.Duration `mapstructure:"-"`
	RefreshTokenTTL time.Duration `mapstructure:"-"`
}

// DSN builds a lib/pq compatible connection string.
func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host,
		d.Port,
		d.User,
		d.Password,
		d.Name,
		d.SSLMode,
	)
}

// Load reads configuration solely from environment variables (with optional defaults).
func Load() (*Config, error) {
	v := viper.New()
	setDefaults(v)
	v.AutomaticEnv()

	if err := bindEnv(v); err != nil {
		return nil, fmt.Errorf("bind env: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	if err := cfg.API.prepare(); err != nil {
		return nil, fmt.Errorf("prepare api config: %w", err)
	}

	if err := cfg.JWT.prepare(); err != nil {
		return nil, fmt.Errorf("prepare jwt config: %w", err)
	}

	if err := validate(cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// MustLoad wraps Load and panics on failure.
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		panic(err)
	}
	return cfg
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("api.port", 8080)
	v.SetDefault("api.max_resumes", 3)
	v.SetDefault("api.max_templates", 2)
	v.SetDefault("api.login_rate_limit_per_hour", 10)
	v.SetDefault("api.login_lock_threshold", 5)
	v.SetDefault("api.login_lock_ttl", "30m")
	v.SetDefault("api.allowed_origins", "")
	v.SetDefault("api.upload_max_bytes", 5*1024*1024)
	v.SetDefault("api.upload_mime_whitelist", "image/png,image/jpeg,image/webp")
	v.SetDefault("api.pdf_rate_limit_per_hour", 3)
	v.SetDefault("api.upload_rate_limit_per_hour", 2)
	v.SetDefault("api.cookie_domain", "")
	v.SetDefault("database.host", "localhost")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.name", "phresume")
	v.SetDefault("database.user", "phresume")
	v.SetDefault("database.password", "phresume")
	v.SetDefault("database.sslmode", "disable")
	v.SetDefault("redis.host", "localhost")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("minio.endpoint", "localhost:9000")
	v.SetDefault("minio.use_ssl", false)
	v.SetDefault("minio.bucket", "resumes")
	v.SetDefault("minio.public_endpoint", "http://localhost:9000")
	v.SetDefault("jwt.access_token_ttl", "15m")
	v.SetDefault("jwt.refresh_token_ttl", "168h")
	v.SetDefault("clamav.host", "clamav")
	v.SetDefault("clamav.port", "3310")
}

func bindEnv(v *viper.Viper) error {
	mappings := map[string]string{
		"api.port":                       "API_PORT",
		"api.max_resumes":                "API_MAX_RESUMES",
		"api.max_templates":              "API_MAX_TEMPLATES",
		"api.login_rate_limit_per_hour":  "API_LOGIN_RATE_LIMIT_PER_HOUR",
		"api.login_lock_threshold":       "API_LOGIN_LOCK_THRESHOLD",
		"api.login_lock_ttl":             "API_LOGIN_LOCK_TTL",
		"api.allowed_origins":            "API_ALLOWED_ORIGINS",
		"api.upload_max_bytes":           "API_UPLOAD_MAX_BYTES",
		"api.upload_mime_whitelist":      "API_UPLOAD_MIME_WHITELIST",
		"api.pdf_rate_limit_per_hour":    "API_PDF_RATE_LIMIT_PER_HOUR",
		"api.upload_rate_limit_per_hour": "API_UPLOAD_RATE_LIMIT_PER_HOUR",
		"api.cookie_domain":              "API_COOKIE_DOMAIN",
		"database.host":                  "DATABASE_HOST",
		"database.port":                  "DATABASE_PORT",
		"database.name":                  "POSTGRES_DB",
		"database.user":                  "POSTGRES_USER",
		"database.password":              "POSTGRES_PASSWORD",
		"database.sslmode":               "DATABASE_SSLMODE",
		"redis.host":                     "REDIS_HOST",
		"redis.port":                     "REDIS_PORT",
		"minio.endpoint":                 "MINIO_ENDPOINT",
		"minio.access_key_id":            "MINIO_ACCESS_KEY_ID",
		"minio.secret_access_key":        "MINIO_SECRET_ACCESS_KEY",
		"minio.use_ssl":                  "MINIO_USE_SSL",
		"minio.bucket":                   "MINIO_BUCKET",
		"minio.public_endpoint":          "MINIO_PUBLIC_ENDPOINT",
		"jwt.private_key":                "JWT_PRIVATE_KEY",
		"jwt.public_key":                 "JWT_PUBLIC_KEY",
		"jwt.access_token_ttl":           "JWT_ACCESS_TOKEN_TTL",
		"jwt.refresh_token_ttl":          "JWT_REFRESH_TOKEN_TTL",
		"clamav.host":                    "CLAMAV_HOST",
		"clamav.port":                    "CLAMAV_PORT",
	}

	for key, env := range mappings {
		if err := v.BindEnv(key, env); err != nil {
			return fmt.Errorf("bind %s to %s: %w", key, env, err)
		}
	}

	return nil
}

func validate(cfg Config) error {
	if cfg.API.Port <= 0 {
		return errors.New("api port must be positive")
	}
	if cfg.API.MaxResumes <= 0 {
		return errors.New("api max resumes must be positive")
	}
	if cfg.API.MaxTemplates <= 0 {
		return errors.New("api max templates must be positive")
	}
	if cfg.API.LoginRateLimitPerHour <= 0 {
		return errors.New("api login rate limit per hour must be positive")
	}
	if cfg.API.LoginLockThreshold <= 0 {
		return errors.New("api login lock threshold must be positive")
	}
	if cfg.API.LoginLockTTL <= 0 {
		return errors.New("api login lock ttl must be positive")
	}
	if cfg.API.UploadMaxBytes <= 0 {
		return errors.New("api upload max bytes must be positive")
	}
	if len(cfg.API.UploadMIMEWhitelist) == 0 {
		return errors.New("api upload mime whitelist must not be empty")
	}
	if cfg.API.PdfRateLimitPerHour <= 0 {
		return errors.New("api pdf rate limit per hour must be positive")
	}
	if cfg.API.UploadRateLimitPerHour <= 0 {
		return errors.New("api upload rate limit per hour must be positive")
	}
	if cfg.Database.Host == "" {
		return errors.New("database host is required")
	}
	if cfg.Database.Port <= 0 {
		return errors.New("database port must be positive")
	}
	if cfg.Database.Name == "" {
		return errors.New("database name is required")
	}
	if cfg.Database.User == "" {
		return errors.New("database user is required")
	}
	if cfg.Database.Password == "" {
		return errors.New("database password is required")
	}
	if cfg.Database.SSLMode == "" {
		return errors.New("database sslmode is required")
	}
	if cfg.Redis.Host == "" {
		return errors.New("redis host is required")
	}
	if cfg.Redis.Port <= 0 {
		return errors.New("redis port must be positive")
	}
	if cfg.MinIO.Endpoint == "" {
		return errors.New("minio endpoint is required")
	}
	if cfg.MinIO.AccessKeyID == "" {
		return errors.New("minio access key id is required")
	}
	if cfg.MinIO.SecretAccessKey == "" {
		return errors.New("minio secret access key is required")
	}
	if cfg.MinIO.Bucket == "" {
		return errors.New("minio bucket is required")
	}
	if cfg.MinIO.PublicEndpoint == "" {
		return errors.New("minio public endpoint is required")
	}
	if cfg.ClamAV.Host == "" {
		return errors.New("clamav host is required")
	}
	if cfg.ClamAV.Port == "" {
		return errors.New("clamav port is required")
	}
	if len(cfg.JWT.PrivateKeyPEM) == 0 {
		return errors.New("jwt private key is required")
	}
	if len(cfg.JWT.PublicKeyPEM) == 0 {
		return errors.New("jwt public key is required")
	}
	if cfg.JWT.AccessTokenTTL <= 0 {
		return errors.New("jwt access token ttl must be positive")
	}
	if cfg.JWT.RefreshTokenTTL <= 0 {
		return errors.New("jwt refresh token ttl must be positive")
	}
	return nil
}

func (a *APIConfig) prepare() error {
	if a.LoginLockTTLRaw == "" {
		return errors.New("api login lock ttl is required")
	}
	d, err := time.ParseDuration(a.LoginLockTTLRaw)
	if err != nil {
		return fmt.Errorf("parse api login lock ttl: %w", err)
	}
	a.LoginLockTTL = d

	if a.AllowedOriginsRaw != "" {
		parts := []string{}
		for _, p := range splitAndTrim(a.AllowedOriginsRaw) {
			if p != "" {
				parts = append(parts, p)
			}
		}
		a.AllowedOrigins = parts
	} else {
		a.AllowedOrigins = nil
	}

	if a.UploadMIMEWhitelistRaw != "" {
		a.UploadMIMEWhitelist = splitAndTrim(a.UploadMIMEWhitelistRaw)
	} else {
		a.UploadMIMEWhitelist = []string{"image/png", "image/jpeg", "image/webp"}
	}
	return nil
}

func splitAndTrim(s string) []string {
	out := []string{}
	cur := ""
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == ',' {
			if t := strings.TrimSpace(cur); t != "" {
				out = append(out, t)
			}
			cur = ""
			continue
		}
		cur += string(ch)
	}
	if t := strings.TrimSpace(cur); t != "" {
		out = append(out, t)
	}
	return out
}

func (j *JWTConfig) prepare() error {
	if j.PrivateKeyBase64 == "" {
		return errors.New("jwt private key base64 is required")
	}
	priv, err := base64.StdEncoding.DecodeString(j.PrivateKeyBase64)
	if err != nil {
		return fmt.Errorf("decode jwt private key: %w", err)
	}
	j.PrivateKeyPEM = priv

	if j.PublicKeyBase64 == "" {
		return errors.New("jwt public key base64 is required")
	}
	pub, err := base64.StdEncoding.DecodeString(j.PublicKeyBase64)
	if err != nil {
		return fmt.Errorf("decode jwt public key: %w", err)
	}
	j.PublicKeyPEM = pub

	if j.AccessTokenTTLRaw == "" {
		return errors.New("jwt access token ttl is required")
	}
	accessTTL, err := time.ParseDuration(j.AccessTokenTTLRaw)
	if err != nil {
		return fmt.Errorf("parse jwt access token ttl: %w", err)
	}
	j.AccessTokenTTL = accessTTL

	if j.RefreshTokenTTLRaw == "" {
		return errors.New("jwt refresh token ttl is required")
	}
	refreshTTL, err := time.ParseDuration(j.RefreshTokenTTLRaw)
	if err != nil {
		return fmt.Errorf("parse jwt refresh token ttl: %w", err)
	}
	j.RefreshTokenTTL = refreshTTL

	return nil
}

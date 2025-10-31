package config

import (
	"errors"
	"fmt"

	"github.com/spf13/viper"
)

// Config aggregates application settings that may be sourced from files or environment variables.
type Config struct {
	API      APIConfig      `mapstructure:"api"`
	Database DatabaseConfig `mapstructure:"database"`
	Redis    RedisConfig    `mapstructure:"redis"`
	MinIO    MinIOConfig    `mapstructure:"minio"`
}

// APIConfig contains HTTP server settings.
type APIConfig struct {
	Port int `mapstructure:"port"`
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
}

func bindEnv(v *viper.Viper) error {
	mappings := map[string]string{
		"api.port":                "API_PORT",
		"database.host":           "DATABASE_HOST",
		"database.port":           "DATABASE_PORT",
		"database.name":           "POSTGRES_DB",
		"database.user":           "POSTGRES_USER",
		"database.password":       "POSTGRES_PASSWORD",
		"database.sslmode":        "DATABASE_SSLMODE",
		"redis.host":              "REDIS_HOST",
		"redis.port":              "REDIS_PORT",
		"minio.endpoint":          "MINIO_ENDPOINT",
		"minio.access_key_id":     "MINIO_ACCESS_KEY_ID",
		"minio.secret_access_key": "MINIO_SECRET_ACCESS_KEY",
		"minio.use_ssl":           "MINIO_USE_SSL",
		"minio.bucket":            "MINIO_BUCKET",
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
	return nil
}

package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"gorm.io/gorm"

	"phResume/internal/auth"
	"phResume/internal/config"
	"phResume/internal/database"
)

func main() {
	var (
		username = flag.String("username", "", "初始管理员用户名（必填）")
		dbHost   = flag.String("db-host", "", "数据库 Host（可选，默认读 DATABASE_HOST）")
		dbPort   = flag.Int("db-port", 0, "数据库 Port（可选，默认读 DATABASE_PORT）")
		dbName   = flag.String("db-name", "", "数据库名（可选，默认读 POSTGRES_DB）")
		dbUser   = flag.String("db-user", "", "数据库用户（可选，默认读 POSTGRES_USER）")
		dbPass   = flag.String("db-password", "", "数据库密码（可选，默认读 POSTGRES_PASSWORD）")
		sslMode  = flag.String("db-sslmode", "", "数据库 SSLMODE（可选，默认读 DATABASE_SSLMODE）")
	)
	flag.Parse()

	u := strings.TrimSpace(*username)
	if u == "" {
		log.Fatal("missing required flag: --username")
	}

	dbCfg, err := loadDatabaseConfig(*dbHost, *dbPort, *dbName, *dbUser, *dbPass, *sslMode)
	if err != nil {
		log.Fatalf("load database config: %v", err)
	}

	db, err := database.InitDatabase(dbCfg)
	if err != nil {
		log.Fatalf("init database: %v", err)
	}

	if err := db.AutoMigrate(&database.User{}); err != nil {
		log.Fatalf("auto migrate: %v", err)
	}

	var existing database.User
	switch err := db.Where("username = ?", u).First(&existing).Error; {
	case err == nil:
		log.Fatalf("user %q already exists", u)
	case errors.Is(err, gorm.ErrRecordNotFound):
	default:
		log.Fatalf("query user: %v", err)
	}

	password, err := generateRandomPassword(24)
	if err != nil {
		log.Fatalf("generate password: %v", err)
	}

	hashed, err := auth.HashPassword(password)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	user := database.User{
		Username:           u,
		PasswordHash:       hashed,
		MustChangePassword: true,
	}
	if err := db.Create(&user).Error; err != nil {
		log.Fatalf("create user: %v", err)
	}

	fmt.Printf("已创建初始管理员账号（首次登录需强制改密）：\n")
	fmt.Printf("用户名: %s\n", u)
	fmt.Printf("初始密码: %s\n", password)
	fmt.Printf("提示：请立即登录并修改密码（该密码仅显示一次）。\n")
}

func loadDatabaseConfig(host string, port int, name, user, password, sslmode string) (config.DatabaseConfig, error) {
	if strings.TrimSpace(host) == "" {
		host = os.Getenv("DATABASE_HOST")
	}
	if port <= 0 {
		if env := strings.TrimSpace(os.Getenv("DATABASE_PORT")); env != "" {
			p, err := strconv.Atoi(env)
			if err != nil {
				return config.DatabaseConfig{}, fmt.Errorf("parse DATABASE_PORT: %w", err)
			}
			port = p
		}
	}
	if strings.TrimSpace(name) == "" {
		name = os.Getenv("POSTGRES_DB")
	}
	if strings.TrimSpace(name) == "" {
		name = os.Getenv("DB_NAME")
	}
	if strings.TrimSpace(user) == "" {
		user = os.Getenv("POSTGRES_USER")
	}
	if strings.TrimSpace(user) == "" {
		user = os.Getenv("DB_USER")
	}
	if strings.TrimSpace(password) == "" {
		password = os.Getenv("POSTGRES_PASSWORD")
	}
	if strings.TrimSpace(password) == "" {
		password = os.Getenv("DB_PASSWORD")
	}
	if strings.TrimSpace(sslmode) == "" {
		sslmode = os.Getenv("DATABASE_SSLMODE")
	}

	if strings.TrimSpace(host) == "" {
		host = "localhost"
	}
	if port <= 0 {
		port = 5432
	}
	if strings.TrimSpace(sslmode) == "" {
		sslmode = "disable"
	}
	if strings.TrimSpace(name) == "" {
		return config.DatabaseConfig{}, errors.New("database name is required (POSTGRES_DB)")
	}
	if strings.TrimSpace(user) == "" {
		return config.DatabaseConfig{}, errors.New("database user is required (POSTGRES_USER)")
	}
	if strings.TrimSpace(password) == "" {
		return config.DatabaseConfig{}, errors.New("database password is required (POSTGRES_PASSWORD)")
	}

	return config.DatabaseConfig{
		Host:     host,
		Port:     port,
		Name:     name,
		User:     user,
		Password: password,
		SSLMode:  sslmode,
	}, nil
}

func generateRandomPassword(bytesLen int) (string, error) {
	if bytesLen <= 0 {
		bytesLen = 24
	}
	buf := make([]byte, bytesLen)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

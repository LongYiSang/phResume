package main

import (
	"errors"
	"fmt"
	"log"

	"gorm.io/gorm"

	"phResume/internal/api"
	"phResume/internal/config"
	"phResume/internal/database"
)

func main() {
	cfg := config.MustLoad()
	log.Printf("api bootstrapped with db host=%s port=%d db=%s sslmode=%s",
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.Name,
		cfg.Database.SSLMode,
	)

	db, err := database.InitDatabase(cfg.Database)
	if err != nil {
		log.Fatalf("init database: %v", err)
	}
	log.Printf("database connection ready")

	if err := db.AutoMigrate(&database.User{}, &database.Resume{}); err != nil {
		log.Fatalf("auto migrate: %v", err)
	}
	log.Printf("database migrated")

	var seedUser database.User
	switch err := db.First(&seedUser, 1).Error; {
	case err == nil:
		// seeded user already present
	case errors.Is(err, gorm.ErrRecordNotFound):
		seeded := database.User{Model: gorm.Model{ID: 1}, Username: "test_user", PasswordHash: "seeded-password"}
		if err := db.Create(&seeded).Error; err != nil {
			log.Fatalf("seed default user: %v", err)
		}
		log.Printf("seeded default user with ID 1")
	default:
		log.Fatalf("query default user: %v", err)
	}

	address := fmt.Sprintf(":%d", cfg.API.Port)
	log.Printf("api listening on %s", address)

	router := api.NewRouter(cfg)
	api.RegisterRoutes(router, db)

	if err := router.Run(address); err != nil {
		log.Fatalf("failed to start api server: %v", err)
	}
}

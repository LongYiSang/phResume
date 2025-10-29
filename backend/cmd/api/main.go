package main

import (
	"fmt"
	"log"

	"phResume/internal/api"
	"phResume/internal/config"
)

func main() {
	cfg := config.MustLoad()
	log.Printf("api bootstrapped with db host=%s port=%d db=%s sslmode=%s",
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.Name,
		cfg.Database.SSLMode,
	)

	address := fmt.Sprintf(":%d", cfg.API.Port)
	log.Printf("api listening on %s", address)

	router := api.NewRouter(cfg)
	if err := router.Run(address); err != nil {
		log.Fatalf("failed to start api server: %v", err)
	}
}

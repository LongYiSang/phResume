package api

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

type redisRateCounter interface {
	Incr(ctx context.Context, key string) *redis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
}

func incrWithTTL(ctx context.Context, client redisRateCounter, key string, ttl time.Duration) (int64, error) {
	count, err := client.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	if count == 1 {
		_ = client.Expire(ctx, key, ttl).Err()
	}
	return count, nil
}

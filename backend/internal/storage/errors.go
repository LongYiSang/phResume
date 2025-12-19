package storage

import (
	"errors"
	"strings"

	"github.com/minio/minio-go/v7"
)

// IsNoSuchKey 判断错误是否明确表示对象不存在（S3/MinIO: NoSuchKey/NotFound）。
func IsNoSuchKey(err error) bool {
	if err == nil {
		return false
	}

	var minioErr minio.ErrorResponse
	if errors.As(err, &minioErr) {
		switch strings.ToLower(strings.TrimSpace(minioErr.Code)) {
		case "nosuchkey", "notfound":
			return true
		}
	}

	// 兜底：不同网关/代理可能会把错误包装成字符串。
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "nosuchkey") ||
		strings.Contains(lower, "specified key does not exist") ||
		strings.Contains(lower, "not found")
}

// IsNoSuchBucket 判断错误是否明确表示 Bucket 不存在（S3/MinIO: NoSuchBucket）。
func IsNoSuchBucket(err error) bool {
	if err == nil {
		return false
	}

	var minioErr minio.ErrorResponse
	if errors.As(err, &minioErr) {
		switch strings.ToLower(strings.TrimSpace(minioErr.Code)) {
		case "nosuchbucket":
			return true
		}
	}

	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "nosuchbucket") ||
		strings.Contains(lower, "specified bucket does not exist")
}

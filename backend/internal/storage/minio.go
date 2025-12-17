package storage

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"phResume/internal/config"
)

// Client 封装 MinIO 客户端，提供简化的上传接口。
type Client struct {
	internalClient *minio.Client
	publicClient   *minio.Client
	bucketName     string
}

// ObjectMeta 描述 Bucket 中对象的关键信息。
type ObjectMeta struct {
	Key          string
	Size         int64
	LastModified time.Time
}

// NewClient 根据配置初始化 MinIO 客户端，并确保目标 Bucket 存在。
func NewClient(cfg config.MinIOConfig) (*Client, error) {
	bucketLookup := minio.BucketLookupAuto
	switch strings.ToLower(strings.TrimSpace(cfg.BucketLookup)) {
	case "", "auto":
		bucketLookup = minio.BucketLookupAuto
	case "dns":
		bucketLookup = minio.BucketLookupDNS
	case "path":
		bucketLookup = minio.BucketLookupPath
	default:
		return nil, fmt.Errorf("invalid minio bucket lookup %q", cfg.BucketLookup)
	}

	internalClient, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure:       cfg.UseSSL,
		Region:       cfg.Region,
		BucketLookup: bucketLookup,
	})
	if err != nil {
		return nil, fmt.Errorf("init internal minio client: %w", err)
	}

	parsedPublicEndpoint, err := url.Parse(cfg.PublicEndpoint)
	if err != nil {
		return nil, fmt.Errorf("parse minio public endpoint: %w", err)
	}

	publicHost := parsedPublicEndpoint.Host
	if publicHost == "" {
		return nil, fmt.Errorf("invalid minio public endpoint, host missing")
	}

	publicClient, err := minio.New(publicHost, &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure:       parsedPublicEndpoint.Scheme == "https",
		Region:       cfg.Region,
		BucketLookup: bucketLookup,
	})
	if err != nil {
		return nil, fmt.Errorf("init public minio client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	exists, err := internalClient.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("check bucket %q: %w", cfg.Bucket, err)
	}
	if !exists {
		if !cfg.AutoCreateBucket {
			return nil, fmt.Errorf("bucket %q does not exist (auto create disabled)", cfg.Bucket)
		}
		if err := internalClient.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{Region: cfg.Region}); err != nil {
			return nil, fmt.Errorf("make bucket %q: %w", cfg.Bucket, err)
		}
	}

	return &Client{
		internalClient: internalClient,
		publicClient:   publicClient,
		bucketName:     cfg.Bucket,
	}, nil
}

// UploadFile 将对象上传到私有 Bucket，并返回上传结果。
func (c *Client) UploadFile(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) (*minio.UploadInfo, error) {
	opts := minio.PutObjectOptions{ContentType: contentType}
	info, err := c.internalClient.PutObject(ctx, c.bucketName, objectName, reader, size, opts)
	if err != nil {
		return nil, fmt.Errorf("put object %q: %w", objectName, err)
	}
	return &info, nil
}

// GetObject 直接读取私有 Bucket 中的对象。
func (c *Client) GetObject(ctx context.Context, objectKey string) (*minio.Object, error) {
	obj, err := c.internalClient.GetObject(ctx, c.bucketName, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get object %q: %w", objectKey, err)
	}
	return obj, nil
}

// GeneratePresignedURL 生成对象的限时下载链接。
func (c *Client) GeneratePresignedURL(ctx context.Context, objectKey string, duration time.Duration) (string, error) {
	presignedURL, err := c.publicClient.PresignedGetObject(ctx, c.bucketName, objectKey, duration, nil)
	if err != nil {
		return "", fmt.Errorf("generate presigned url for %q: %w", objectKey, err)
	}
	return presignedURL.String(), nil
}

// GeneratePresignedURLWithParams 生成带自定义响应参数的限时下载链接。
func (c *Client) GeneratePresignedURLWithParams(ctx context.Context, objectKey string, duration time.Duration, params map[string]string) (string, error) {
	var v url.Values
	if params != nil {
		v = url.Values{}
		for k, val := range params {
			v.Set(k, val)
		}
	}
	presignedURL, err := c.publicClient.PresignedGetObject(ctx, c.bucketName, objectKey, duration, v)
	if err != nil {
		return "", fmt.Errorf("generate presigned url with params for %q: %w", objectKey, err)
	}
	return presignedURL.String(), nil
}

// ListObjects 列出指定前缀下的对象元数据。
func (c *Client) ListObjects(ctx context.Context, prefix string, limit int) ([]ObjectMeta, error) {
	if limit <= 0 {
		limit = 50
	}
	objCh := c.internalClient.ListObjects(ctx, c.bucketName, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})
	result := make([]ObjectMeta, 0, limit)
	for object := range objCh {
		if object.Err != nil {
			return nil, fmt.Errorf("list objects under %q: %w", prefix, object.Err)
		}
		meta := ObjectMeta{
			Key:          object.Key,
			Size:         object.Size,
			LastModified: object.LastModified,
		}
		result = append(result, meta)
		if len(result) >= limit {
			break
		}
	}
	return result, nil
}

// DeleteObject 删除指定对象。
// 若对象不存在会被视为成功（幂等）。
func (c *Client) DeleteObject(ctx context.Context, objectKey string) error {
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return nil
	}
	if err := c.internalClient.RemoveObject(ctx, c.bucketName, objectKey, minio.RemoveObjectOptions{}); err != nil {
		reason := strings.ToLower(err.Error())
		if strings.Contains(reason, "nosuchkey") || strings.Contains(reason, "not found") {
			return nil
		}
		return fmt.Errorf("remove object %q: %w", objectKey, err)
	}
	return nil
}

// DeletePrefix 删除指定前缀下的所有对象。
// 若某些对象已不存在会被忽略；其余错误会聚合返回。
func (c *Client) DeletePrefix(ctx context.Context, prefix string) error {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil
	}

	objCh := c.internalClient.ListObjects(ctx, c.bucketName, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	keys := make([]string, 0, 32)
	for object := range objCh {
		if object.Err != nil {
			return fmt.Errorf("list objects under %q: %w", prefix, object.Err)
		}
		if strings.TrimSpace(object.Key) != "" {
			keys = append(keys, object.Key)
		}
	}
	if len(keys) == 0 {
		return nil
	}

	errs := make([]error, 0)
	for _, key := range keys {
		if err := c.DeleteObject(ctx, key); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) == 0 {
		return nil
	}
	if len(errs) == 1 {
		return errs[0]
	}

	slog.Default().Error("delete minio objects under prefix failed",
		slog.String("prefix", prefix),
		slog.Int("failed_count", len(errs)),
	)
	return fmt.Errorf("delete objects under %q: %d errors", prefix, len(errs))
}

package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"phResume/internal/config"
)

// Client 封装 MinIO 客户端，提供简化的上传接口。
type Client struct {
	minio    *minio.Client
	bucket   string
	endpoint string
	useSSL   bool
}

// NewClient 根据配置初始化 MinIO 客户端，并确保目标 Bucket 存在。
func NewClient(cfg config.MinIOConfig) (*Client, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("init minio client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	exists, err := client.BucketExists(ctx, cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("check bucket %q: %w", cfg.Bucket, err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("make bucket %q: %w", cfg.Bucket, err)
		}
	}

	return &Client{
		minio:    client,
		bucket:   cfg.Bucket,
		endpoint: cfg.Endpoint,
		useSSL:   cfg.UseSSL,
	}, nil
}

// UploadFile 上传对象并返回其可访问的 URL。
func (c *Client) UploadFile(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) (string, error) {
	opts := minio.PutObjectOptions{ContentType: contentType}
	if _, err := c.minio.PutObject(ctx, c.bucket, objectName, reader, size, opts); err != nil {
		return "", fmt.Errorf("put object %q: %w", objectName, err)
	}
	return c.objectURL(objectName), nil
}

func (c *Client) objectURL(objectName string) string {
	scheme := "http"
	if c.useSSL {
		scheme = "https"
	}

	endpoint := c.endpoint
	if !strings.Contains(endpoint, "://") {
		endpoint = fmt.Sprintf("%s://%s", scheme, endpoint)
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		host := strings.TrimPrefix(c.endpoint, "http://")
		host = strings.TrimPrefix(host, "https://")
		return fmt.Sprintf("%s://%s/%s/%s", scheme, host, c.bucket, objectName)
	}

	u.Path = path.Join(strings.TrimSuffix(u.Path, "/"), c.bucket, objectName)
	return u.String()
}

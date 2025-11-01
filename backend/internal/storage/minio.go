package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
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

// NewClient 根据配置初始化 MinIO 客户端，并确保目标 Bucket 存在。
func NewClient(cfg config.MinIOConfig) (*Client, error) {
	internalClient, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: cfg.UseSSL,
		Region: "us-east-1",
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
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: parsedPublicEndpoint.Scheme == "https",
		Region: "us-east-1",
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
		if err := internalClient.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{}); err != nil {
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

// GeneratePresignedURL 生成对象的限时下载链接。
func (c *Client) GeneratePresignedURL(ctx context.Context, objectKey string, duration time.Duration) (string, error) {
	presignedURL, err := c.publicClient.PresignedGetObject(ctx, c.bucketName, objectKey, duration, nil)
	if err != nil {
		return "", fmt.Errorf("generate presigned url for %q: %w", objectKey, err)
	}
	return presignedURL.String(), nil
}

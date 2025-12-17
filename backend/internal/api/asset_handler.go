package api

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	stdhttp "net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dutchcoders/go-clamd"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/api/middleware"
	"phResume/internal/database"
	"phResume/internal/storage"
)

type assetStore interface {
	CountByUser(ctx context.Context, userID uint) (int64, error)
	ListByUser(ctx context.Context, userID uint, limit int) ([]database.Asset, error)
	Create(ctx context.Context, asset database.Asset) error
	FindByUserAndKey(ctx context.Context, userID uint, objectKey string) (database.Asset, error)
	DeleteByID(ctx context.Context, id uint) error
}

type assetStorage interface {
	UploadFile(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) (*minio.UploadInfo, error)
	GeneratePresignedURL(ctx context.Context, objectKey string, expiry time.Duration) (string, error)
	DeleteObject(ctx context.Context, objectKey string) error
}

type assetCounter interface {
	Incr(ctx context.Context, key string) *redis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
	Get(ctx context.Context, key string) *redis.StringCmd
}

type gormAssetStore struct {
	db *gorm.DB
}

func newGormAssetStore(db *gorm.DB) assetStore {
	return &gormAssetStore{db: db}
}

func (s *gormAssetStore) CountByUser(ctx context.Context, userID uint) (int64, error) {
	var count int64
	if err := s.db.WithContext(ctx).
		Model(&database.Asset{}).
		Where("user_id = ?", userID).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func (s *gormAssetStore) ListByUser(ctx context.Context, userID uint, limit int) ([]database.Asset, error) {
	var assets []database.Asset
	if err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at desc").
		Limit(limit).
		Find(&assets).Error; err != nil {
		return nil, err
	}
	return assets, nil
}

func (s *gormAssetStore) Create(ctx context.Context, asset database.Asset) error {
	return s.db.WithContext(ctx).Create(&asset).Error
}

func (s *gormAssetStore) FindByUserAndKey(ctx context.Context, userID uint, objectKey string) (database.Asset, error) {
	var asset database.Asset
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND object_key = ?", userID, objectKey).
		First(&asset).Error
	return asset, err
}

func (s *gormAssetStore) DeleteByID(ctx context.Context, id uint) error {
	return s.db.WithContext(ctx).Delete(&database.Asset{}, id).Error
}

// AssetHandler 负责处理资产上传与访问。
type AssetHandler struct {
	store            assetStore
	Storage          assetStorage
	Logger           *slog.Logger
	ClamdAddr        string
	MaxBytes         int
	MIMEWhitelist    []string
	RedisClient      assetCounter
	maxAssetsPerUser int
	maxUploadsPerDay int
}

// NewAssetHandler 返回 AssetHandler 实例。
func NewAssetHandler(db *gorm.DB, storageClient *storage.Client, logger *slog.Logger, clamdAddr string, redisClient *redis.Client, maxAssetsPerUser int, maxUploadsPerDay int, maxBytes int, mimeWhitelist []string) *AssetHandler {
	return &AssetHandler{
		store:            newGormAssetStore(db),
		Storage:          storageClient,
		Logger:           logger,
		ClamdAddr:        clamdAddr,
		MaxBytes:         maxBytes,
		MIMEWhitelist:    mimeWhitelist,
		RedisClient:      redisClient,
		maxAssetsPerUser: maxAssetsPerUser,
		maxUploadsPerDay: maxUploadsPerDay,
	}
}

// UploadAsset 处理受保护的图片上传，并在上传前扫描病毒。
func (h *AssetHandler) UploadAsset(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()
	logger := middleware.LoggerFromContext(c).With(
		slog.Uint64("user_id", uint64(userID)),
	)

	existingCount, err := h.store.CountByUser(ctx, userID)
	if err != nil {
		logger.Error("count assets failed", slog.Any("error", err))
		Internal(c, "failed to count assets")
		return
	}
	if h.maxAssetsPerUser > 0 && existingCount >= int64(h.maxAssetsPerUser) {
		Forbidden(c, "asset limit reached")
		return
	}

	dayWindow := time.Now().UTC().Format("20060102")
	rateKey := fmt.Sprintf("rate:upload:day:%d:%s", userID, dayWindow)
	count, _ := h.RedisClient.Incr(ctx, rateKey).Result()
	if count == 1 {
		_ = h.RedisClient.Expire(ctx, rateKey, 24*time.Hour).Err()
	}
	if h.maxUploadsPerDay > 0 && count > int64(h.maxUploadsPerDay) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		BadRequest(c, "missing file")
		return
	}

	if file.Size > int64(h.MaxBytes) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "payload too large"})
		return
	}

	clamdClient := clamd.NewClamd(h.ClamdAddr)

	fileReader, err := file.Open()
	if err != nil {
		Internal(c, "failed to open file")
		return
	}

	abortChan := make(chan bool)
	scanChan, err := clamdClient.ScanStream(fileReader, abortChan)
	fileReader.Close()
	if err != nil {
		h.Logger.Error("scan file", slog.String("error", err.Error()))
		Internal(c, "failed to scan file")
		return
	}
	defer close(abortChan)

	for result := range scanChan {
		if result.Status != clamd.RES_OK {
			BadRequest(c, "malicious file detected")
			return
		}
	}

	fileReader, err = file.Open()
	if err != nil {
		Internal(c, "failed to reopen file")
		return
	}
	defer fileReader.Close()

	head := make([]byte, 512)
	n, _ := fileReader.Read(head)
	sniffed := stdhttp.DetectContentType(head[:n])
	_ = fileReader.Close()

	allowed := false
	for _, m := range h.MIMEWhitelist {
		if sniffed == m {
			allowed = true
			break
		}
	}
	if !allowed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported media type"})
		return
	}

	fileReader, err = file.Open()
	if err != nil {
		Internal(c, "failed to reopen file")
		return
	}
	defer fileReader.Close()

	ext := ".png"
	switch sniffed {
	case "image/jpeg":
		ext = ".jpg"
	case "image/webp":
		ext = ".webp"
	}
	objectKey := fmt.Sprintf("user-assets/%d/%s%s", userID, uuid.NewString(), ext)
	contentType := sniffed

	if _, err := h.Storage.UploadFile(ctx, objectKey, fileReader, file.Size, contentType); err != nil {
		logger.Error("upload file failed", slog.String("object_key", objectKey), slog.Any("error", err))
		Internal(c, "failed to upload file")
		return
	}

	asset := database.Asset{
		UserID:      userID,
		ObjectKey:   objectKey,
		ContentType: contentType,
		Size:        file.Size,
	}
	if err := h.store.Create(ctx, asset); err != nil {
		if delErr := h.Storage.DeleteObject(ctx, objectKey); delErr != nil {
			logger.Error("rollback delete object failed", slog.String("object_key", objectKey), slog.Any("error", delErr))
		}
		logger.Error("create asset record failed", slog.String("object_key", objectKey), slog.Any("error", err))
		Internal(c, "failed to upload file")
		return
	}

	c.JSON(http.StatusCreated, gin.H{"objectKey": objectKey})
}

// ListAssets 列出用户上传的资产。
func (h *AssetHandler) ListAssets(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()

	limitStr := c.DefaultQuery("limit", "60")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 60
	}
	if limit > 200 {
		limit = 200
	}

	logger := middleware.LoggerFromContext(c).With(slog.Uint64("user_id", uint64(userID)))
	assets, err := h.store.ListByUser(ctx, userID, limit)
	if err != nil {
		logger.Error("list assets failed", slog.Any("error", err))
		Internal(c, "failed to list assets")
		return
	}

	assetCount := int64(len(assets))
	items := make([]gin.H, 0, len(assets))
	for _, a := range assets {
		url, err := h.Storage.GeneratePresignedURL(ctx, a.ObjectKey, 10*time.Minute)
		if err != nil {
			logger.Error("generate asset url failed", slog.String("object_key", a.ObjectKey), slog.Any("error", err))
			continue
		}
		items = append(items, gin.H{
			"objectKey":    a.ObjectKey,
			"previewUrl":   url,
			"size":         a.Size,
			"lastModified": a.CreatedAt,
		})
	}

	todayKey := fmt.Sprintf("rate:upload:day:%d:%s", userID, time.Now().UTC().Format("20060102"))
	todayUploads := int64(0)
	if value, err := h.RedisClient.Get(ctx, todayKey).Result(); err == nil {
		if parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil {
			todayUploads = parsed
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"stats": gin.H{
			"assetCount":       assetCount,
			"maxAssets":        h.maxAssetsPerUser,
			"todayUploads":     todayUploads,
			"maxUploadsPerDay": h.maxUploadsPerDay,
		},
	})
}

// GetAssetURL 返回资产的临时预签名 URL。
func (h *AssetHandler) GetAssetURL(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()

	objectKey := c.Query("key")
	if objectKey == "" {
		BadRequest(c, "missing key")
		return
	}
	objectKey = strings.TrimSpace(objectKey)
	if !isValidUserAssetObjectKey(userID, objectKey) {
		Forbidden(c, "access denied")
		return
	}
	if _, err := h.store.FindByUserAndKey(ctx, userID, objectKey); err != nil {
		Forbidden(c, "access denied")
		return
	}
	signedURL, err := h.Storage.GeneratePresignedURL(ctx, objectKey, 15*time.Minute)
	if err != nil {
		h.Logger.Error("generate presigned url", slog.String("error", err.Error()))
		Internal(c, "failed to generate url")
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": signedURL})
}

func (h *AssetHandler) DeleteAsset(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	ctx := c.Request.Context()
	logger := middleware.LoggerFromContext(c).With(slog.Uint64("user_id", uint64(userID)))
	objectKey := strings.TrimSpace(c.Query("key"))
	if objectKey == "" {
		BadRequest(c, "missing key")
		return
	}
	if !isValidUserAssetObjectKey(userID, objectKey) {
		Forbidden(c, "access denied")
		return
	}

	asset, err := h.store.FindByUserAndKey(ctx, userID, objectKey)
	if err != nil {
		Forbidden(c, "access denied")
		return
	}

	if err := h.Storage.DeleteObject(ctx, objectKey); err != nil {
		logger.Error("delete object failed", slog.String("object_key", objectKey), slog.Any("error", err))
		Internal(c, "failed to delete asset")
		return
	}

	if err := h.store.DeleteByID(ctx, asset.ID); err != nil {
		logger.Error("delete asset record failed", slog.String("object_key", objectKey), slog.Any("error", err))
		Internal(c, "failed to delete asset")
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "asset deleted"})
}

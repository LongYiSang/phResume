package api

import (
	"fmt"
	"log/slog"
	"net/http"
	stdhttp "net/http"
	"sort"
	"strconv"
	"time"

	"github.com/dutchcoders/go-clamd"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"phResume/internal/storage"
)

// AssetHandler 负责处理资产上传与访问。
type AssetHandler struct {
	Storage                *storage.Client
	Logger                 *slog.Logger
	ClamdAddr              string
	MaxBytes               int
	MIMEWhitelist          []string
	RedisClient            *redis.Client
	uploadRateLimitPerHour int
}

// NewAssetHandler 返回 AssetHandler 实例。
func NewAssetHandler(storageClient *storage.Client, logger *slog.Logger, clamdAddr string, redisClient *redis.Client, uploadRateLimitPerHour int, maxBytes int, mimeWhitelist []string) *AssetHandler {
	return &AssetHandler{
		Storage:                storageClient,
		Logger:                 logger,
		ClamdAddr:              clamdAddr,
		MaxBytes:               maxBytes,
		MIMEWhitelist:          mimeWhitelist,
		RedisClient:            redisClient,
		uploadRateLimitPerHour: uploadRateLimitPerHour,
	}
}

// UploadAsset 处理受保护的图片上传，并在上传前扫描病毒。
func (h *AssetHandler) UploadAsset(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	// 每用户每小时上传 2 次
	window := time.Now().UTC().Format("2006010215")
	rateKey := fmt.Sprintf("rate:upload:%d:%s", userID, window)
	count, _ := h.RedisClient.Incr(c.Request.Context(), rateKey).Result()
	if count == 1 {
		_ = h.RedisClient.Expire(c.Request.Context(), rateKey, time.Hour).Err()
	}
	if count > int64(h.uploadRateLimitPerHour) {
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to open file"})
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

	if _, err := h.Storage.UploadFile(c.Request.Context(), objectKey, fileReader, file.Size, contentType); err != nil {
		h.Logger.Error("upload file", slog.String("error", err.Error()))
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

	limitStr := c.DefaultQuery("limit", "60")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 60
	}
	if limit > 200 {
		limit = 200
	}

	prefix := fmt.Sprintf("user-assets/%d/", userID)
	objects, err := h.Storage.ListObjects(c.Request.Context(), prefix, limit)
	if err != nil {
		h.Logger.Error("list assets", slog.String("error", err.Error()))
		Internal(c, "failed to list assets")
		return
	}

	sort.Slice(objects, func(i, j int) bool {
		return objects[i].LastModified.After(objects[j].LastModified)
	})

	items := make([]gin.H, 0, len(objects))
	for _, obj := range objects {
		url, err := h.Storage.GeneratePresignedURL(c.Request.Context(), obj.Key, 10*time.Minute)
		if err != nil {
			h.Logger.Error("generate asset url", slog.String("objectKey", obj.Key), slog.String("error", err.Error()))
			continue
		}
		items = append(items, gin.H{
			"objectKey":    obj.Key,
			"previewUrl":   url,
			"size":         obj.Size,
			"lastModified": obj.LastModified,
		})
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

// GetAssetURL 返回资产的临时预签名 URL。
func (h *AssetHandler) GetAssetURL(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		AbortUnauthorized(c)
		return
	}

	objectKey := c.Query("key")
	if objectKey == "" {
		BadRequest(c, "missing key")
		return
	}

	if !isValidUserAssetObjectKey(userID, objectKey) {
		Forbidden(c, "access denied")
		return
	}

	signedURL, err := h.Storage.GeneratePresignedURL(c.Request.Context(), objectKey, 15*time.Minute)
	if err != nil {
		h.Logger.Error("generate presigned url", slog.String("error", err.Error()))
		Internal(c, "failed to generate url")
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": signedURL})
}

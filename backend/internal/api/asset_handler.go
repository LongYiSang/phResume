package api

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/dutchcoders/go-clamd"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"phResume/internal/storage"
)

// AssetHandler 负责处理资产上传与访问。
type AssetHandler struct {
	Storage   *storage.Client
	Logger    *slog.Logger
	ClamdAddr string
}

// NewAssetHandler 返回 AssetHandler 实例。
func NewAssetHandler(storageClient *storage.Client, logger *slog.Logger, clamdAddr string) *AssetHandler {
	return &AssetHandler{
		Storage:   storageClient,
		Logger:    logger,
		ClamdAddr: clamdAddr,
	}
}

// UploadAsset 处理受保护的图片上传，并在上传前扫描病毒。
func (h *AssetHandler) UploadAsset(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing file"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan file"})
		return
	}
	defer close(abortChan)

	for result := range scanChan {
		if result.Status != clamd.RES_OK {
			c.JSON(http.StatusBadRequest, gin.H{"error": "malicious file detected"})
			return
		}
	}

	fileReader, err = file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reopen file"})
		return
	}
	defer fileReader.Close()

	objectKey := fmt.Sprintf("user-assets/%d/%s.png", userID, uuid.NewString())
	contentType := file.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	if _, err := h.Storage.UploadFile(c.Request.Context(), objectKey, fileReader, file.Size, contentType); err != nil {
		h.Logger.Error("upload file", slog.String("error", err.Error()))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upload file"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"objectKey": objectKey})
}

// GetAssetURL 返回资产的临时预签名 URL。
func (h *AssetHandler) GetAssetURL(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	objectKey := c.Query("key")
	if objectKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing key"})
		return
	}

	expectedPrefix := fmt.Sprintf("user-assets/%d/", userID)
	if !strings.HasPrefix(objectKey, expectedPrefix) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	signedURL, err := h.Storage.GeneratePresignedURL(c.Request.Context(), objectKey, 15*time.Minute)
	if err != nil {
		h.Logger.Error("generate presigned url", slog.String("error", err.Error()))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate url"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": signedURL})
}

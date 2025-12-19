package api

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/minio/minio-go/v7"
	"github.com/redis/go-redis/v9"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"phResume/internal/database"
)

type fakeStorage struct {
	uploaded map[string][]byte

	deleted []string

	presign map[string]string
}

func newFakeStorage() *fakeStorage {
	return &fakeStorage{
		uploaded: map[string][]byte{},
		presign:  map[string]string{},
	}
}

func (s *fakeStorage) UploadFile(_ context.Context, objectName string, reader io.Reader, _ int64, _ string) (*minio.UploadInfo, error) {
	b, _ := io.ReadAll(reader)
	s.uploaded[objectName] = b
	return &minio.UploadInfo{}, nil
}

func (s *fakeStorage) GeneratePresignedURL(_ context.Context, objectKey string, _ time.Duration) (string, error) {
	if v, ok := s.presign[objectKey]; ok {
		return v, nil
	}
	return "https://example.invalid/" + objectKey, nil
}

func (s *fakeStorage) DeleteObject(_ context.Context, objectKey string) error {
	s.deleted = append(s.deleted, objectKey)
	delete(s.uploaded, objectKey)
	return nil
}

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&database.Asset{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func newRedisCounter(t *testing.T) *redis.Client {
	t.Helper()
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	return client
}

func newMultipartUpload(t *testing.T, filename string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return body, writer.FormDataContentType()
}

func TestUploadAsset_LimitsByCount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := context.Background()
	db := newTestDB(t)
	storage := newFakeStorage()
	redisClient := newRedisCounter(t)

	h := &AssetHandler{
		store:            newGormAssetStore(db),
		Storage:          storage,
		Logger:           nil,
		ClamdAddr:        "",
		MaxBytes:         5 * 1024 * 1024,
		MIMEWhitelist:    []string{"image/png"},
		RedisClient:      redisClient,
		maxAssetsPerUser: 4,
		maxUploadsPerDay: 4,
	}

	for i := 0; i < 4; i++ {
		objectKey := "user-assets/1/existing-" + strconv.Itoa(i) + ".png"
		if err := h.store.Create(ctx, database.Asset{UserID: 1, ObjectKey: objectKey}); err != nil {
			t.Fatalf("seed asset: %v", err)
		}
	}

	body, contentType := newMultipartUpload(t, "a.png", []byte("\x89PNG\r\n\x1a\n"))
	req := httptest.NewRequest(http.MethodPost, "/v1/assets/upload", body)
	req.Header.Set("Content-Type", contentType)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Set("userID", uint(1))

	h.UploadAsset(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 got %d body=%s", w.Code, w.Body.String())
	}
}

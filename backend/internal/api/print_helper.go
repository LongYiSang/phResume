package api

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"phResume/internal/resume"
	"phResume/internal/storage"
)

type inlineImageError struct {
	status int
	msg    string
}

func (e *inlineImageError) Error() string {
	return e.msg
}

func inlineContentImages(ctx context.Context, storageClient *storage.Client, ownerID uint, content *resume.Content) error {
	imagePrefix := fmt.Sprintf("user-assets/%d/", ownerID)
	for idx := range content.Items {
		if content.Items[idx].Type != "image" {
			continue
		}
		objectKey := strings.TrimSpace(content.Items[idx].Content)
		if objectKey == "" {
			return &inlineImageError{
				status: http.StatusInternalServerError,
				msg:    "image object key missing",
			}
		}
		if !strings.HasPrefix(objectKey, imagePrefix) {
			return &inlineImageError{
				status: http.StatusForbidden,
				msg:    "invalid image object key",
			}
		}
		if !isValidUserAssetObjectKey(ownerID, objectKey) {
			return &inlineImageError{
				status: http.StatusForbidden,
				msg:    "invalid image object key",
			}
		}
		obj, err := storageClient.GetObject(ctx, objectKey)
		if err != nil {
			return fmt.Errorf("failed to fetch image: %w", err)
		}
		stat, statErr := obj.Stat()
		contentType := "image/png"
		if statErr == nil && stat.ContentType != "" {
			contentType = stat.ContentType
		}
		imageBytes, err := io.ReadAll(obj)
		_ = obj.Close()
		if err != nil {
			return fmt.Errorf("failed to read image: %w", err)
		}
		base64Image := base64.StdEncoding.EncodeToString(imageBytes)
		dataURI := fmt.Sprintf("data:%s;base64,%s", contentType, base64Image)
		content.Items[idx].Content = dataURI
	}
	return nil
}

func statusFromInlineError(err error) (int, bool) {
	var inlineErr *inlineImageError
	if errors.As(err, &inlineErr) {
		return inlineErr.status, true
	}
	return 0, false
}

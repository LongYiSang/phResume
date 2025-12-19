package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"phResume/internal/errcode"
	"phResume/internal/storage"
)

type PrintWarning struct {
	Code        int      `json:"code"`
	Message     string   `json:"message"`
	MissingKeys []string `json:"missing_keys,omitempty"`
}

// PrintData 是 worker 注入到前端打印页的 JSON 数据结构。
// 保持 layout_settings/items 在顶层，避免破坏现有 PrintView 读取逻辑；warnings 为可选附加字段。
type PrintData struct {
	LayoutSettings map[string]any   `json:"layout_settings"`
	Items          []map[string]any `json:"items"`
	Warnings       []PrintWarning   `json:"warnings,omitempty"`
}

type RemovedImageItem struct {
	ItemID string
	Key    string
	Reason string
}

func LogRemovedImageItems(log *slog.Logger, removed []RemovedImageItem) {
	for _, r := range removed {
		log.Warn("print image item removed",
			slog.String("item_id", r.ItemID),
			slog.String("object_key", r.Key),
			slog.String("reason", r.Reason),
		)
	}
}

func normalizeContentField(item map[string]any) {
	raw, ok := item["content"]
	if !ok || raw == nil {
		item["content"] = ""
		return
	}
	if _, ok := raw.(string); ok {
		return
	}
	item["content"] = fmt.Sprint(raw)
}

func itemString(item map[string]any, field string) string {
	if v, ok := item[field]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// BuildPrintData 将内容 JSON 构造成打印数据：内联图片、过滤无效/缺失图片，并返回被移除的图片项列表。
// 约定：
// - 对象不存在(NoSuchKey) => 移除该 image item，并记录 warning(4004)
// - Bucket 不存在(NoSuchBucket) => 视为系统错误，直接返回 error
func BuildPrintData(ctx context.Context, storageClient *storage.Client, ownerID uint, rawJSON []byte) (PrintData, []RemovedImageItem, error) {
	var data PrintData
	if err := json.Unmarshal(rawJSON, &data); err != nil {
		return PrintData{}, nil, &inlineImageError{
			status: http.StatusInternalServerError,
			msg:    fmt.Sprintf("failed to decode print data: %v", err),
		}
	}

	filtered := make([]map[string]any, 0, len(data.Items))
	removed := make([]RemovedImageItem, 0)

	for _, item := range data.Items {
		itemType := strings.TrimSpace(itemString(item, "type"))
		itemID := strings.TrimSpace(itemString(item, "id"))

		if itemType != "image" {
			normalizeContentField(item)
			filtered = append(filtered, item)
			continue
		}

		rawContent, ok := item["content"]
		if rawContent == nil || !ok {
			removed = append(removed, RemovedImageItem{
				ItemID: itemID,
				Reason: "image content 为空",
			})
			continue
		}

		contentStr, ok := rawContent.(string)
		if !ok {
			removed = append(removed, RemovedImageItem{
				ItemID: itemID,
				Reason: "image content 类型非法",
			})
			continue
		}

		objectKey := strings.TrimSpace(contentStr)
		if objectKey == "" {
			removed = append(removed, RemovedImageItem{
				ItemID: itemID,
				Reason: "image content 为空字符串",
			})
			continue
		}

		// key 格式不合法：直接移除该 item，计入 4004。
		if !isValidUserAssetObjectKey(ownerID, objectKey) {
			removed = append(removed, RemovedImageItem{
				ItemID: itemID,
				Key:    objectKey,
				Reason: "image object key 格式不合法",
			})
			continue
		}

		obj, err := storageClient.GetObject(ctx, objectKey)
		if err != nil {
			if storage.IsNoSuchBucket(err) {
				return PrintData{}, removed, fmt.Errorf("minio bucket does not exist: %w", err)
			}
			if storage.IsNoSuchKey(err) {
				removed = append(removed, RemovedImageItem{
					ItemID: itemID,
					Key:    objectKey,
					Reason: "image object 不存在",
				})
				continue
			}
			return PrintData{}, removed, fmt.Errorf("failed to fetch image: %w", err)
		}

		stat, statErr := obj.Stat()
		if statErr != nil {
			_ = obj.Close()
			if storage.IsNoSuchBucket(statErr) {
				return PrintData{}, removed, fmt.Errorf("minio bucket does not exist: %w", statErr)
			}
			if storage.IsNoSuchKey(statErr) {
				removed = append(removed, RemovedImageItem{
					ItemID: itemID,
					Key:    objectKey,
					Reason: "image object 不存在",
				})
				continue
			}
			return PrintData{}, removed, fmt.Errorf("failed to stat image: %w", statErr)
		}

		contentType := "image/png"
		if strings.TrimSpace(stat.ContentType) != "" {
			contentType = stat.ContentType
		}

		imageBytes, readErr := io.ReadAll(obj)
		_ = obj.Close()
		if readErr != nil {
			if storage.IsNoSuchBucket(readErr) {
				return PrintData{}, removed, fmt.Errorf("minio bucket does not exist: %w", readErr)
			}
			if storage.IsNoSuchKey(readErr) {
				removed = append(removed, RemovedImageItem{
					ItemID: itemID,
					Key:    objectKey,
					Reason: "image object 不存在",
				})
				continue
			}
			return PrintData{}, removed, fmt.Errorf("failed to read image: %w", readErr)
		}

		base64Image := base64.StdEncoding.EncodeToString(imageBytes)
		dataURI := fmt.Sprintf("data:%s;base64,%s", contentType, base64Image)
		item["content"] = dataURI
		filtered = append(filtered, item)
	}

	data.Items = filtered

	if len(removed) > 0 {
		uniq := make(map[string]struct{}, len(removed))
		keys := make([]string, 0, len(removed))
		for _, r := range removed {
			k := strings.TrimSpace(r.Key)
			if k == "" {
				continue
			}
			if _, ok := uniq[k]; ok {
				continue
			}
			uniq[k] = struct{}{}
			keys = append(keys, k)
		}

		data.Warnings = append(data.Warnings, PrintWarning{
			Code:        errcode.ResourceMissing,
			Message:     "部分图片资源缺失/无效，已自动跳过并继续生成",
			MissingKeys: keys,
		})
	}

	return data, removed, nil
}

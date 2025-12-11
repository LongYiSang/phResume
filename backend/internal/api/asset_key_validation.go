package api

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

func isValidUserAssetObjectKey(userID uint, key string) bool {
	if key == "" || !utf8.ValidString(key) {
		return false
	}
	expected := fmt.Sprintf("user-assets/%d/", userID)
	if !strings.HasPrefix(key, expected) {
		return false
	}
	if strings.Contains(key, "..") || strings.Contains(key, "\\") || strings.Contains(key, "//") {
		return false
	}
	if len(key) > 200 {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(key))
	if !(strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") || strings.HasSuffix(lower, ".webp")) {
		return false
	}
	return true
}

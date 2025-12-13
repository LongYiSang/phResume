package worker

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	resumePrintPath   = "resume/print"
	templatePrintPath = "templates/print"
)

// fetchInternalPrintData 从后端内部打印接口拉取 JSON 数据。
// 只允许 Worker 通过 Header 携带 INTERNAL_API_SECRET 访问。
func fetchInternalPrintData(ctx context.Context, internalAPIBaseURL string, resourcePath string, id uint, secret string) ([]byte, error) {
func fetchInternalPrintData(ctx context.Context, internalAPIBaseURL string, resourcePath string, id uint, secret string) ([]byte, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, fmt.Errorf("internal api secret missing")
	}

	internalAPIBaseURL = strings.TrimRight(strings.TrimSpace(internalAPIBaseURL), "/")
	if internalAPIBaseURL == "" {
		return nil, fmt.Errorf("internal api base url missing")
	}

	targetURL := fmt.Sprintf("%s/v1/%s/%d", internalAPIBaseURL, strings.TrimPrefix(resourcePath, "/"), id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build internal request: %w", err)
	}
	req.Header.Set("X-Internal-Secret", secret)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request internal print data: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
		return nil, fmt.Errorf("internal print data status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read internal print data: %w", err)
	}

	return data, nil
}

// buildPrintDataInjectionScript 构造在浏览器里注入 window.__PRINT_DATA__ 的脚本。
// 通过 JSON.parse + Go 的 Quote 来保证脚本安全。
func buildPrintDataInjectionScript(data []byte) string {
	quoted := strconv.Quote(string(data))
	return fmt.Sprintf(`() => { window.__PRINT_DATA__ = JSON.parse(%s); }`, quoted)
}

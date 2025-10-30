package pdf

import (
	"fmt"
	"io"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

// GeneratePDFFromHTML 使用 go-rod 在无头浏览器中渲染 HTML 并返回 PDF 字节。
func GeneratePDFFromHTML(htmlContent string) ([]byte, error) {
	launch := launcher.New().
		Headless(true).
		NoSandbox(true)

	if path, ok := launcher.LookPath(); ok {
		launch = launch.Bin(path)
	}

	browserURL, err := launch.Launch()
	if err != nil {
		return nil, fmt.Errorf("launch chromium: %w", err)
	}
	defer launch.Cleanup()

	browser := rod.New().ControlURL(browserURL)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("connect browser: %w", err)
	}
	defer func() {
		_ = browser.Close()
	}()

	page, err := browser.Timeout(30 * time.Second).Page(proto.TargetCreateTarget{})
	if err != nil {
		return nil, fmt.Errorf("create page: %w", err)
	}
	defer func() {
		_ = page.Close()
	}()

	page = page.Timeout(30 * time.Second)
	if err := page.SetDocumentContent(htmlContent); err != nil {
		return nil, fmt.Errorf("set document content: %w", err)
	}

	if err := page.WaitLoad(); err != nil {
		return nil, fmt.Errorf("wait load: %w", err)
	}

	reader, err := page.PDF(&proto.PagePrintToPDF{
		PrintBackground:   true,
		PreferCSSPageSize: true,
	})
	if err != nil {
		return nil, fmt.Errorf("export pdf: %w", err)
	}
	defer func() {
		_ = reader.Close()
	}()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read pdf bytes: %w", err)
	}

	return data, nil
}

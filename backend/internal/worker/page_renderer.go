package worker

import (
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

func renderFrontendPage(logger *slog.Logger, targetURL string, preReadyScript string) (_ *rod.Page, cleanup func(), err error) {
	cleanup = func() {}

	logger.Info("Worker: Navigating to frontend print page...", slog.String("url", targetURL))

	launch := launcher.New().
		Headless(true).
		NoSandbox(true)
	defer func() {
		if err != nil {
			launch.Cleanup()
		}
	}()

	if path, ok := launcher.LookPath(); ok {
		launch = launch.Bin(path)
	}

	browserURL, err := launch.Launch()
	if err != nil {
		return nil, cleanup, fmt.Errorf("launch chromium: %w", err)
	}

	browser := rod.New().ControlURL(browserURL).Timeout(90 * time.Second)
	if err := browser.Connect(); err != nil {
		return nil, cleanup, fmt.Errorf("connect browser: %w", err)
	}

	page := browser.MustPage(targetURL)
	cleanup = func() {
		if page != nil {
			_ = page.Close()
		}
		_ = browser.Close()
		launch.Cleanup()
	}

	page.MustWaitLoad()

	if strings.TrimSpace(preReadyScript) != "" {
		logger.Info("Worker: Injecting print data before render...")
		if _, evalErr := page.Timeout(10 * time.Second).Eval(preReadyScript); evalErr != nil {
			return nil, cleanup, fmt.Errorf("inject print data: %w", evalErr)
		}
	}

	logger.Info("Worker: Waiting for frontend render signal (#pdf-render-ready)...")
	page.Timeout(30 * time.Second).MustElement("#pdf-render-ready")

	// 额外等待 WebFont/系统字体就绪，避免回退字体度量导致排版差异
	logger.Info("Worker: Waiting for document.fonts.ready...")
	if _, evalErr := page.Timeout(5 * time.Second).Eval(`() => {
	  if (document && document.fonts && document.fonts.ready) {
	    return Promise.race([
	      document.fonts.ready.then(() => true),
	      new Promise((resolve) => setTimeout(() => resolve(true), 3000))
	    ]);
	  }
	  return true;
	}`); evalErr != nil {
		logger.Warn("Worker: document.fonts.ready wait failed, continue", slog.Any("error", evalErr))
	}
	logger.Info("Worker: Render signal received.")

	if err := (proto.EmulationSetEmulatedMedia{Media: "print"}).Call(page); err != nil {
		return nil, cleanup, fmt.Errorf("set emulated media to print: %w", err)
	}

	logger.Info("Worker: Marking A4 canvas as #pdf-root...")
	page.MustEval(`() => {
  const normalize = s => (s || '').replace(/\s+/g, '').toLowerCase();
  let target = null;
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (normalize(cs.aspectRatio) === '210/297') { target = el; break; }
  }
  if (!target) {
    for (const el of all) {
      const cs = getComputedStyle(el);
      const w = parseFloat(cs.width) || 0;
      if (Math.abs(w - 794) < 1 || Math.abs(w - 900) < 1) { target = el; break; }
    }
  }
  if (target) target.id = 'pdf-root';
  return !!target;
}`)

	logger.Info("Worker: Injecting print-cleanup CSS...")
	cleanupCSS := `
  body > div[id^="__next_dev_"] {
    display: none !important;
  }
  #nextjs-devtools,
  [data-nextjs-devtools],
  [data-next-devtools],
  #__next-build-watcher,
  #__next-build-indicator,
  #__next-dev-client,
  #__next-prerender-indicator,
  #__next-route-announcer,
  #__next-dev-overlay,
  nextjs-portal,
  #nextjs-portal {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
  }
  body > div:first-of-type {
    padding: 0 !important;
    margin: 0 !important;
  }
  #__next {
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
  }
  #__next .min-h-screen {
    min-height: auto !important;
    padding: 0 !important;
    margin: 0 !important;
    background: white !important;
  }
  [style*="aspect-ratio: 210 / 297"],
  [style*="aspect-ratio:210 / 297"] {
    box-shadow: none !important;
    margin: 0 auto !important;
    background: white !important;
  }
  #pdf-root {
    box-shadow: none !important;
    margin: 0 auto !important;
    background: white !important;
  }
  @media print {
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    svg, svg * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    @page {
      size: A4;
      margin: 0;
    }
    body {
      background: white !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
    }
    body > div:first-of-type {
      padding: 0 !important;
      margin: 0 !important;
    }
    #__next, #__next * {
      background: transparent !important;
    }
    #__next .min-h-screen {
      min-height: auto !important;
      padding: 0 !important;
      margin: 0 !important;
      background: white !important;
    }
    body * {
      visibility: hidden !important;
    }
    [style*="aspect-ratio: 210 / 297"],
    [style*="aspect-ratio:210 / 297"] {
      visibility: visible !important;
      box-shadow: none !important;
      margin: 0 auto !important;
      background: white !important;
      position: fixed !important;
      top: 0 !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
    }
    [style*="aspect-ratio: 210 / 297"] *,
    [style*="aspect-ratio:210 / 297"] * {
      visibility: visible !important;
    }
    #pdf-root {
      visibility: visible !important;
      position: fixed !important;
      top: 0 !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      box-shadow: none !important;
      margin: 0 auto !important;
      background: white !important;
      z-index: 999999 !important;
    }
    #pdf-root * {
      visibility: visible !important;
    }
    .print-mask {
      visibility: visible !important;
      position: absolute !important;
      inset: 0 !important;
      border: 1.0cm solid white !important;
      box-sizing: border-box !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      background: transparent !important;
    }
  }
`
	if err := page.AddStyleTag("", cleanupCSS); err != nil {
		return nil, cleanup, fmt.Errorf("inject cleanup css: %w", err)
	}

	page.MustEval(`() => {
  const sels = [
    '#nextjs-devtools',
    '[data-nextjs-devtools]',
    '[data-next-devtools]',
    '#__next-build-watcher',
    '#__next-build-indicator',
    '#__next-dev-client',
    '#__next-prerender-indicator',
    '#__next-route-announcer',
    '#__next-dev-overlay',
    'nextjs-portal',
    '#nextjs-portal',
    'div[id^="__next_dev_"]'
  ];
  for (const s of sels) document.querySelectorAll(s).forEach(n => n.remove());
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed') {
      const r = el.getBoundingClientRect();
      const w = r.width, h = r.height;
      if (w <= 56 && h <= 56 && r.left <= 30 && (window.innerHeight - r.bottom) <= 30) {
        el.remove();
      }
    }
  }
}`)

	page.MustWaitIdle()
	return page, cleanup, nil
}

func exportPDF(page *rod.Page) ([]byte, error) {
	params := &proto.PagePrintToPDF{
		PrintBackground:   true,
		PaperWidth:        float64Ptr(8.27),
		PaperHeight:       float64Ptr(11.69),
		MarginTop:         float64Ptr(0),
		MarginBottom:      float64Ptr(0),
		MarginLeft:        float64Ptr(0),
		MarginRight:       float64Ptr(0),
		PreferCSSPageSize: true,
	}
	reader, err := page.PDF(params)
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

func capturePreparedScreenshot(page *rod.Page, quality int) ([]byte, error) {
	element, err := page.Timeout(5 * time.Second).Element("#a4-container")
	if err == nil {
		if data, shotErr := element.Screenshot(proto.PageCaptureScreenshotFormatJpeg, quality); shotErr == nil {
			return data, nil
		}
	}

	req := &proto.PageCaptureScreenshot{
		Format:  proto.PageCaptureScreenshotFormatJpeg,
		Quality: intPtr(quality),
	}
	data, err := page.Screenshot(true, req)
	if err != nil {
		return nil, fmt.Errorf("page screenshot: %w", err)
	}
	return data, nil
}

func float64Ptr(value float64) *float64 {
	return &value
}

func intPtr(value int) *int {
	return &value
}

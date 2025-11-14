package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"phResume/internal/database"
	"phResume/internal/storage"
	"phResume/internal/tasks"
)

// PDFTaskHandler 负责消费 PDF 生成任务。
type PDFTaskHandler struct {
	db             *gorm.DB
	storage        *storage.Client
	redisClient    *redis.Client
	logger         *slog.Logger
	internalSecret string
}

// NewPDFTaskHandler 创建任务处理器。
func NewPDFTaskHandler(
	db *gorm.DB,
	storage *storage.Client,
	redisClient *redis.Client,
	logger *slog.Logger,
	internalSecret string,
) *PDFTaskHandler {
	return &PDFTaskHandler{
		db:             db,
		storage:        storage,
		redisClient:    redisClient,
		logger:         logger,
		internalSecret: internalSecret,
	}
}

// ProcessTask 实现 asynq.Handler。
func (h *PDFTaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error {
	log := h.logger

	var payload tasks.PDFGeneratePayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		log.Error("unmarshal task payload failed", slog.Any("error", err))
		return err
	}

	if h.internalSecret == "" {
		err := fmt.Errorf("internal api secret missing")
		log.Error("internal api secret missing", slog.Any("error", err))
		return err
	}

	log = log.With(
		slog.String("correlation_id", payload.CorrelationID),
		slog.Int("resume_id", int(payload.ResumeID)),
	)
	log.Info("Starting WYSIWYG PDF generation task...")

	var resume database.Resume
	if err := h.db.WithContext(ctx).First(&resume, payload.ResumeID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Warn("resume not found, skipping task")
			return nil
		}
		log.Error("query resume failed", slog.Any("error", err))
		return err
	}

	pdfBytes, err := h.generatePDFFromFrontend(resume.ID)
	if err != nil {
		log.Error("generate pdf via frontend failed", slog.Any("error", err))
		return err
	}

	objectName := fmt.Sprintf("generated-resumes/%d/%s.pdf", resume.UserID, uuid.NewString())
	pdfReader := bytes.NewReader(pdfBytes)
	if _, err := h.storage.UploadFile(ctx, objectName, pdfReader, int64(len(pdfBytes)), "application/pdf"); err != nil {
		log.Error("upload pdf to minio failed", slog.Any("error", err))
		return err
	}

	update := map[string]any{
		"pdf_url": objectName,
		"status":  "completed",
	}
	if err := h.db.WithContext(ctx).Model(&resume).Updates(update).Error; err != nil {
		log.Error("update resume failed", slog.Any("error", err))
		return err
	}

	message := map[string]any{
		"status":    "completed",
		"resume_id": resume.ID,
	}
	data, err := json.Marshal(message)
	if err != nil {
		log.Error("marshal notification payload failed", slog.Any("error", err))
		return err
	}

	channel := fmt.Sprintf("user_notify:%d", resume.UserID)
	if err := h.redisClient.Publish(ctx, channel, data).Err(); err != nil {
		log.Error("publish redis notification failed", slog.Any("error", err))
		return err
	}

	log.Info("Published notification to channel", slog.String("channel", channel))
	log.Info("PDF generation task completed successfully.")
	return nil
}

func (h *PDFTaskHandler) generatePDFFromFrontend(resumeID uint) ([]byte, error) {
	targetURL := fmt.Sprintf(
		"http://frontend:3000/print/%d?internal_token=%s",
		resumeID,
		url.QueryEscape(h.internalSecret),
	)
	h.logger.Info("Worker: Navigating to frontend print page...", slog.String("url", targetURL))

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

	browser := rod.New().ControlURL(browserURL).Timeout(90 * time.Second)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("connect browser: %w", err)
	}
	defer func() {
		_ = browser.Close()
	}()

	page := browser.MustPage(targetURL)
	defer func() {
		_ = page.Close()
	}()

	page.MustWaitLoad()
	h.logger.Info("Worker: Waiting for frontend render signal (#pdf-render-ready)...")
	page.Timeout(30 * time.Second).MustElement("#pdf-render-ready")
	h.logger.Info("Worker: Render signal received.")

	// 在样式注入前，统一切换为 print 媒体，确保 @media print 生效
	if err := (proto.EmulationSetEmulatedMedia{Media: "print"}).Call(page); err != nil {
		return nil, fmt.Errorf("set emulated media to print: %w", err)
	}

	// 查找打印的 A4 画布并标记为 #pdf-root（后续样式将围绕它聚焦打印）
	h.logger.Info("Worker: Marking A4 canvas as #pdf-root...")
	page.MustEval(`() => {
  const normalize = s => (s || '').replace(/\s+/g, '').toLowerCase();
  let target = null;
  const all = Array.from(document.querySelectorAll('body *'));
  // 1) 优先按 aspect-ratio 匹配
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (normalize(cs.aspectRatio) === '210/297') { target = el; break; }
  }
  // 2) 退化：按宽度近似匹配（794 或 900）
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

	// --- 注入打印清理样式，去除 Next.js 开发工具与页面额外留白 ---
	h.logger.Info("Worker: Injecting print-cleanup CSS...")
	cleanupCSS := `
  /* 1) 移除 Next.js 开发工具的浮标（黑点等） */
  body > div[id^="__next_dev_"] {
    display: none !important;
  }
  /* 常见 Next Dev/Overlay/Portal 选择器兜底隐藏（开发模式） */
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

  /* 2) 重置全局边距与背景，避免 PDF 顶部/四周出现空白 */
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
  }
  /* 清除顶层容器的 padding/margin（例如 .py-8 造成的顶边空白） */
  body > div:first-of-type {
    padding: 0 !important;
    margin: 0 !important;
  }
  /* 针对 Next 根节点及常见容器做强化重置 */
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

  /* 3) 去除页面画布的阴影与外边距（不依赖 print 媒体，以适配 screen 模式渲染） */
  [style*="aspect-ratio: 210 / 297"],
  [style*="aspect-ratio:210 / 297"] {
    box-shadow: none !important;
    margin: 0 auto !important;
    background: white !important;
  }
  /* 若已成功标记 #pdf-root，常态下也去除阴影和外边距 */
  #pdf-root {
    box-shadow: none !important;
    margin: 0 auto !important;
    background: white !important;
  }

  /*
    4) 仅打印我们真正的 A4 画布区域
       PageContainer 使用了内联样式 aspect-ratio: 210 / 297
       这里借助该标识进行“聚焦打印”并移除阴影与外边距。
  */
  @media print {
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
    /* 同步清除顶层容器的 padding/margin */
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
    /* 先将页面元素隐藏（visibility 技巧允许后续对目标区域“反显”） */
    body * {
      visibility: hidden !important;
    }
    /* 反显 A4 画布及其子元素；同时去掉阴影与额外 margin */
    [style*="aspect-ratio: 210 / 297"],
    [style*="aspect-ratio:210 / 297"] {
      visibility: visible !important;
      box-shadow: none !important;
      margin: 0 auto !important;
      background: white !important;
      /* 固定定位到页面顶部，彻底规避父层 padding/margin 布局干扰 */
      position: fixed !important;
      top: 0 !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
    }
    [style*="aspect-ratio: 210 / 297"] *,
    [style*="aspect-ratio:210 / 297"] * {
      visibility: visible !important;
    }
    /* 优先命中 #pdf-root 的反显与定位（如果存在） */
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
  }
`
	if err := page.AddStyleTag("", cleanupCSS); err != nil {
		return nil, fmt.Errorf("inject cleanup css: %w", err)
	}

	// 兜底：直接移除一批可能的 dev/overlay 节点，以及启发式清理左下角黑点
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
  // 启发式：移除位于左下角的小型 fixed 圆点（可能是 DevTools 图标）
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
	// 给浏览器一个空闲片刻以应用样式
	page.MustWaitIdle()
	// --- 清理样式注入结束 ---

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

func float64Ptr(value float64) *float64 {
	return &value
}

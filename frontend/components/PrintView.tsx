"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useParams } from "next/navigation";
import { PageContainer } from "@/components/PageContainer";
import { TextItem } from "@/components/TextItem";
import { SectionTitleItem } from "@/components/SectionTitleItem";
import { ImageItem } from "@/components/ImageItem";
import { DividerItem } from "@/components/DividerItem";
import type { ResumeData, ResumeItem } from "@/types/resume";

import { applyOpacityToColor, extractBackgroundStyle } from "@/utils/color";
import { DEFAULT_LAYOUT_SETTINGS } from "@/utils/resume";
import {
  DEFAULT_CELL_PADDING_PX,
  DEFAULT_CELL_RADIUS_PX,
  IMAGE_CELL_PADDING_PX,
} from "@/utils/editorStyles";

const CANVAS_WIDTH = 794;
const CANVAS_HEIGHT = Math.round((CANVAS_WIDTH * 297) / 210);

import { Watermark } from "@/components/Watermark";

type ItemLayout = ResumeItem["layout"];

const PRINT_DATA_READY_EVENT = "print-data-ready";

function resolveLayout(layout?: ItemLayout) {
  return {
    x: layout?.x ?? 0,
    y: layout?.y ?? 0,
    w: layout?.w ?? 4,
    h: layout?.h ?? 4,
  };
}

type PrintViewProps = {
  resourcePath: string;
};

declare global {
  interface Window {
    __PRINT_DATA__?: ResumeData;
  }
}

export function PrintView({ resourcePath: _resourcePath }: PrintViewProps) {
  const params = useParams<{ id: string }>();
  const resourceId = params?.id;
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    if (!resourceId) {
      setError("缺少必要参数");
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsRendered(false);

    let cancelled = false;
    let resolved = false;
    let resolving = false;
    let hasHinted = false;
    const start = Date.now();
    let pollInterval: number | null = null;

    const finalizeRender = async (data: ResumeData) => {
      if (cancelled || resolved || resolving) return;
      resolving = true;
      setResumeData(data);

      const fontsReady = (document as unknown as { fonts?: { ready?: Promise<void> } }).fonts?.ready;
      if (fontsReady) {
        const timeout = new Promise<void>((resolve) =>
          setTimeout(resolve, 3000),
        );
        try {
          await Promise.race([fontsReady, timeout]);
        } catch {}
      }

      if (!cancelled) {
        resolved = true;
        setIsRendered(true);
        setIsLoading(false);
        if (pollInterval !== null) {
          window.clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    };

    const tryResolveFromWindow = async () => {
      const data =
        typeof window !== "undefined" ? window.__PRINT_DATA__ : undefined;
      if (!data) return false;
      await finalizeRender(data);
      return true;
    };

    const onPrintDataReady = () => {
      void tryResolveFromWindow();
    };

    void tryResolveFromWindow();
    window.addEventListener(PRINT_DATA_READY_EVENT, onPrintDataReady);

    pollInterval = window.setInterval(() => {
      if (cancelled || resolved) return;
      void tryResolveFromWindow();

      // 仅提示，不中断等待：彻底消除 worker 注入时机与前端轮询窗口的竞态。
      if (!hasHinted && Date.now() - start > 15_000) {
        hasHinted = true;
        setError("打印数据仍未注入，继续等待...");
      }
    }, 50);

    return () => {
      cancelled = true;
      window.removeEventListener(PRINT_DATA_READY_EVENT, onPrintDataReady);
      if (pollInterval !== null) {
        window.clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  }, [resourceId]);

  const layoutSettings = useMemo(
    () => ({
      ...DEFAULT_LAYOUT_SETTINGS,
      ...(resumeData?.layout_settings ?? {}),
    }),
    [resumeData?.layout_settings],
  );

  const gridContainerStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${layoutSettings.columns}, 1fr)`,
      gridAutoRows: `${layoutSettings.row_height_px}px`,
      gap: "0px",
      width: "100%",
      height: "100%",
    }),
    [layoutSettings],
  );

  return (
    <div className="min-h-screen bg-zinc-100 py-8">
      <PageContainer
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        style={{
          fontFamily: layoutSettings.font_family,
          fontSize: `${layoutSettings.font_size_pt}pt`,
          color: layoutSettings.accent_color,
          padding: `${layoutSettings.margin_px}px`,
        }}
      >
        <div style={gridContainerStyle}>
          {resumeData?.items?.map((item) => {
            const resolvedLayout = resolveLayout(item.layout);
            const backgroundMeta = extractBackgroundStyle(item.style);
            const containerBackground = applyOpacityToColor(
              backgroundMeta.color,
              backgroundMeta.opacity,
            );
            const hasBackground = Boolean(
              containerBackground && containerBackground.trim().length > 0,
            );

            const rawBorder = (item.style as Record<string, unknown> | undefined)?.["border"];
            const rawBorderWidth = (item.style as Record<string, unknown> | undefined)?.["borderWidth"];
            const rawBorderColor = (item.style as Record<string, unknown> | undefined)?.["borderColor"];
            const borderWidth =
              typeof rawBorderWidth === "number"
                ? rawBorderWidth
                : typeof rawBorderWidth === "string"
                  ? Number.parseFloat(rawBorderWidth)
                  : undefined;
            const hasExplicitBorder =
              (typeof rawBorder === "string" && rawBorder.trim().length > 0) ||
              (typeof borderWidth === "number" && !Number.isNaN(borderWidth) && borderWidth > 0);
            const borderColor =
              typeof rawBorderColor === "string" && rawBorderColor.trim().length > 0
                ? rawBorderColor
                : undefined;
            const borderValue =
              typeof rawBorder === "string" && rawBorder.trim().length > 0
                ? (rawBorder as string)
                : hasExplicitBorder
                  ? `${Math.max(1, Math.round(borderWidth!))}px solid ${borderColor ?? "currentColor"}`
                  : "none";

            const baseCellStyle: CSSProperties = {
              gridColumn: `${resolvedLayout.x + 1} / span ${resolvedLayout.w}`,
              gridRow: `${resolvedLayout.y + 1} / span ${resolvedLayout.h}`,
              backgroundColor: hasBackground ? containerBackground : "transparent",
              minWidth: 0,
              boxSizing: "border-box",
              border: borderValue,
            };
            const isImageItem = item.type === "image";
            const cellStyle: CSSProperties = {
              ...baseCellStyle,
              padding: isImageItem
                ? `${IMAGE_CELL_PADDING_PX}px`
                : `${DEFAULT_CELL_PADDING_PX}px`,
              borderRadius: `${DEFAULT_CELL_RADIUS_PX}px`,
              overflow: isImageItem ? "hidden" : "visible",
            };

            const baseTextStyle: CSSProperties = {
              fontSize: `${layoutSettings.font_size_pt}pt`,
              color: layoutSettings.accent_color,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              overflow: "visible",
              paddingRight: "2px",
              ...(item.style ?? {}),
            };

            if (item.type === "text") {
              return (
                <div key={item.id} style={cellStyle}>
                  <TextItem
                    html={item.content}
                    style={baseTextStyle}
                    readOnly
                  />
                </div>
              );
            }

            if (item.type === "section_title") {
              return (
                <div key={item.id} style={cellStyle}>
                  <SectionTitleItem
                    html={item.content}
                    style={baseTextStyle}
                    readOnly
                    accentColor={layoutSettings.accent_color}
                  />
                </div>
              );
            }

            if (item.type === "divider") {
              const { borderColor: _dc, color: _dcolor, ...restDivider } =
                (item.style ?? {}) as Record<string, unknown>;
              return (
                <div key={item.id} style={cellStyle}>
                  <DividerItem style={restDivider as CSSProperties | undefined} />
                </div>
              );
            }

            if (item.type === "image") {
              return (
                <div key={item.id} style={cellStyle}>
                  <ImageItem
                    style={item.style as CSSProperties | undefined}
                    preSignedURL={item.content}
                  />
                </div>
              );
            }

            return (
              <div key={item.id} style={cellStyle}>
                <div className="text-xs text-red-500">
                  Unsupported type: {item.type}
                </div>
              </div>
            );
          })}
        </div>
        {isRendered && <div id="pdf-render-ready" />}
        {layoutSettings.enable_watermark && <Watermark />}
      </PageContainer>

      <div className="mt-6 text-center text-sm text-zinc-500">
        {isLoading && "正在加载打印视图..."}
        {!isLoading && error && error}
      </div>
    </div>
  );
}

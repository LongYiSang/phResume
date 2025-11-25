"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/PageContainer";
import { TextItem } from "@/components/TextItem";
import { ImageItem } from "@/components/ImageItem";
import { DividerItem } from "@/components/DividerItem";
import type { ResumeData, ResumeItem } from "@/types/resume";

import { applyOpacityToColor, extractBackgroundStyle } from "@/utils/color";

const CANVAS_WIDTH = 794;
const CANVAS_HEIGHT = Math.round((CANVAS_WIDTH * 297) / 210);
const DEFAULT_LAYOUT_SETTINGS = {
  columns: 24,
  row_height_px: 10,
  accent_color: "#3388ff",
  font_family: "Arial",
  font_size_pt: 10,
  margin_px: 30,
};
const INTERNAL_API_BASE =
  process.env.NEXT_PUBLIC_INTERNAL_API_URL ?? "/api";

type ItemLayout = ResumeItem["layout"];

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

export function PrintView({ resourcePath }: PrintViewProps) {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const resourceId = params?.id;
  const internalToken = searchParams?.get("internal_token") ?? "";
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    if (!resourceId || !internalToken) {
      setError("缺少必要参数");
      return;
    }

    const controller = new AbortController();

    const fetchPrintData = async () => {
      setIsLoading(true);
      setError(null);
      setIsRendered(false);

      try {
        const response = await fetch(
          `${INTERNAL_API_BASE}/v1/${resourcePath}/${resourceId}?internal_token=${encodeURIComponent(
            internalToken,
          )}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`failed to fetch print data: ${response.status}`);
        }

        const data = (await response.json()) as ResumeData;
        setResumeData(data);
        const fontsReady = (document as unknown as { fonts?: { ready?: Promise<void> } }).fonts?.ready;
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
        if (fontsReady) {
          try {
            await Promise.race([fontsReady, timeout]);
          } catch {}
        }
        setIsRendered(true);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        console.error("加载打印数据失败", err);
        setError("加载打印数据失败，请重试");
        setIsRendered(false);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchPrintData();

    return () => controller.abort();
  }, [resourceId, internalToken, resourcePath]);

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
            const containerBackground =
              applyOpacityToColor(backgroundMeta.color, backgroundMeta.opacity) ??
              "rgba(255,255,255,0.96)";
            const hasCustomBackground = Boolean(
              backgroundMeta.color && backgroundMeta.color.trim().length > 0 &&
              ((typeof backgroundMeta.opacity === "number" ? backgroundMeta.opacity : 1) > 0)
            );
            const commonCellStyle: CSSProperties = {
              gridColumn: `${resolvedLayout.x + 1} / span ${resolvedLayout.w}`,
              gridRow: `${resolvedLayout.y + 1} / span ${resolvedLayout.h}`,
              padding: "12px",
              borderRadius: "20px",
              backgroundColor: containerBackground,
              minWidth: 0,
              boxSizing: "border-box",
              border:
                item.type === "text" && !hasCustomBackground
                  ? "none"
                  : "1px solid rgba(226, 232, 240, 0.7)",
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
                <div key={item.id} style={commonCellStyle}>
                  <TextItem
                    html={item.content}
                    style={baseTextStyle}
                    readOnly
                  />
                </div>
              );
            }

            if (item.type === "divider") {
              return (
                <div key={item.id} style={commonCellStyle}>
                  <DividerItem style={item.style as CSSProperties | undefined} />
                </div>
              );
            }

            if (item.type === "image") {
              return (
                <div key={item.id} style={commonCellStyle}>
                  <ImageItem
                    style={item.style as CSSProperties | undefined}
                    preSignedURL={item.content}
                  />
                </div>
              );
            }

            return (
              <div key={item.id} style={commonCellStyle}>
                <div className="text-xs text-red-500">
                  Unsupported type: {item.type}
                </div>
              </div>
            );
          })}
        </div>
        {isRendered && <div id="pdf-render-ready" />}
      </PageContainer>

      <div className="mt-6 text-center text-sm text-zinc-500">
        {isLoading && "正在加载打印视图..."}
        {!isLoading && error && error}
      </div>
    </div>
  );
}

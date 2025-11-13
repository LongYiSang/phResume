"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import RGL, { type Layout } from "react-grid-layout";
import { v4 as uuidv4 } from "uuid";
import { PageContainer } from "@/components/PageContainer";
import { StylePanel } from "@/components/StylePanel";
import { TextItem } from "@/components/TextItem";
import { DividerItem } from "@/components/DividerItem";
import { ImageItem } from "@/components/ImageItem";
import { useAuth } from "@/context/AuthContext";
import type {
  LayoutSettings,
  ResumeData,
  ResumeItem,
  ResumeItemStyle,
  ResumeLayout,
} from "@/types/resume";

type TaskStatus = "idle" | "pending" | "completed";

const GRID_COLS = 24;
const GRID_ROW_HEIGHT = 10;
const CANVAS_WIDTH = 900;

const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  columns: GRID_COLS,
  row_height_px: GRID_ROW_HEIGHT,
  accent_color: "#3388ff",
  font_family: "Arial",
  font_size_pt: 10,
  margin_px: 30,
};

function parseFontSizeValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeLayoutSettings(
  raw?: Record<string, unknown>,
): LayoutSettings {
  const source = (raw ?? {}) as Record<string, unknown>;
  const normalized: LayoutSettings = {
    ...DEFAULT_LAYOUT_SETTINGS,
    ...(source as Record<string, unknown>),
  } as LayoutSettings;

  normalized.columns =
    typeof source["columns"] === "number"
      ? (source["columns"] as number)
      : DEFAULT_LAYOUT_SETTINGS.columns;
  normalized.row_height_px =
    typeof source["row_height_px"] === "number"
      ? (source["row_height_px"] as number)
      : DEFAULT_LAYOUT_SETTINGS.row_height_px;
  normalized.accent_color =
    typeof source["accent_color"] === "string"
      ? (source["accent_color"] as string)
      : DEFAULT_LAYOUT_SETTINGS.accent_color;
  normalized.font_family =
    typeof source["font_family"] === "string"
      ? (source["font_family"] as string)
      : DEFAULT_LAYOUT_SETTINGS.font_family;
  normalized.font_size_pt =
    typeof source["font_size_pt"] === "number"
      ? (source["font_size_pt"] as number)
      : DEFAULT_LAYOUT_SETTINGS.font_size_pt;
  normalized.margin_px =
    typeof source["margin_px"] === "number"
      ? (source["margin_px"] as number)
      : DEFAULT_LAYOUT_SETTINGS.margin_px;

  return normalized;
}

function normalizeItemStyle(raw: unknown): ResumeItemStyle {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const style: ResumeItemStyle = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === "string" || typeof value === "number") {
      style[key] = value;
    }
  });
  return style;
}

function normalizeResumeContent(content: unknown): ResumeData | null {
  if (!content) {
    return null;
  }

  let parsed: unknown = content;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      console.error("简历内容 JSON 解析失败", err);
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const draft = parsed as Record<string, unknown> & {
    items?: unknown;
    layout_settings?: Record<string, unknown>;
  };

  const itemsSource = Array.isArray(draft.items) ? draft.items : [];
  const layoutSettings = normalizeLayoutSettings(draft.layout_settings);

  const items: ResumeItem[] = itemsSource.map((raw, index) => {
    const item = (raw as Record<string, unknown>) ?? {};
    const layoutRaw = (item.layout as Record<string, unknown>) ?? {};

    const layout: ResumeLayout = {
      x: typeof layoutRaw.x === "number" ? layoutRaw.x : 0,
      y: typeof layoutRaw.y === "number" ? layoutRaw.y : 0,
      w: typeof layoutRaw.w === "number" ? layoutRaw.w : 4,
      h: typeof layoutRaw.h === "number" ? layoutRaw.h : 4,
    };

    const style = normalizeItemStyle(item.style);

    return {
      ...(item as Omit<ResumeItem, "id" | "layout" | "style" | "content">),
      id: typeof item.id === "string" ? item.id : `item-${index}`,
      type: typeof item.type === "string" ? item.type : "text",
      content: typeof item.content === "string" ? item.content : "",
      layout,
      style,
    };
  });

  return {
    layout_settings: layoutSettings,
    items,
  };
}

export default function Home() {
  const router = useRouter();
  const { accessToken, isAuthenticated } = useAuth();
  const [title, setTitle] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [savedResumeId, setSavedResumeId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingResume, setIsFetchingResume] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchDownloadLink = useCallback(
    async (resumeId: number) => {
      if (!accessToken) {
        setError("请先登录");
        setTaskStatus("idle");
        return;
      }

      setError(null);

      try {
        const response = await fetch(
          `/api/v1/resume/${resumeId}/download-link`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error("failed to fetch download link");
        }

        const data = await response.json();
        if (data?.url) {
          window.open(data.url, "_blank", "noopener");
        } else {
          throw new Error("missing url in response");
        }
      } catch (err) {
        console.error("获取预签名链接失败", err);
        setError("获取下载链接失败，请稍后重试");
      } finally {
        setTaskStatus("idle");
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (isAuthenticated === false) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  const resolveWebSocketURL = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const envURL = process.env.NEXT_PUBLIC_WS_URL;
    if (envURL && envURL.length > 0) {
      return envURL;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/api/v1/ws`;
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }

    const wsURL = resolveWebSocketURL();
    if (!wsURL) {
      console.warn("WebSocket URL unavailable, skipping connection.");
      return;
    }

    const ws = new WebSocket(wsURL);
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: accessToken }));
      console.log("WebSocket connected and authenticated.");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.status === "completed" && typeof data.resume_id === "number") {
          setTaskStatus("completed");
          fetchDownloadLink(data.resume_id);
        }
      } catch (parseError) {
        console.error("Invalid WebSocket payload:", parseError);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected.");
      socketRef.current = null;
    };

    ws.onerror = () => {
      console.warn("WebSocket error, closing connection.");
      ws.close();
      socketRef.current = null;
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, [isAuthenticated, accessToken, fetchDownloadLink, resolveWebSocketURL]);

  const fetchLatestResume = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsFetchingResume(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/resume/latest", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("failed to fetch latest resume");
      }

      const data = await response.json();
      setTitle(data?.title ?? "");

      const parsedContent = normalizeResumeContent(data?.content);
      setResumeData(parsedContent);
      setSavedResumeId(
        typeof data?.id === "number" && data.id > 0 ? data.id : null,
      );
    } catch (err) {
      console.error("加载最新简历失败", err);
      setError("加载最新简历失败，请稍后重试");
    } finally {
      setIsFetchingResume(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (isAuthenticated && accessToken) {
      fetchLatestResume();
    }
  }, [isAuthenticated, accessToken, fetchLatestResume]);

  const handleSave = async () => {
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("简历标题不能为空");
      return;
    }

    if (!accessToken) {
      setError("请先登录");
      return;
    }

    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/v1/resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ title: trimmedTitle, content: resumeData }),
      });

      if (!response.ok) {
        throw new Error("保存失败");
      }

      const data = await response.json();
      setSavedResumeId(
        typeof data?.id === "number" && data.id > 0 ? data.id : null,
      );
      setTaskStatus("idle");
    } catch (err) {
      console.error("保存失败", err);
      setError("保存失败，请重试");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!savedResumeId) {
      return;
    }

    if (!accessToken) {
      setError("请先登录");
      return;
    }

    setError(null);
    setTaskStatus("pending");

    try {
      const response = await fetch(`/api/v1/resume/${savedResumeId}/download`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("下载失败");
      }
    } catch (err) {
      console.error("生成任务提交失败", err);
      setError("生成任务提交失败，请稍后重试");
      setTaskStatus("idle");
    }
  };

  const renderDownloadLabel = () => {
    if (taskStatus === "pending") {
      return "生成中...";
    }
    if (taskStatus === "completed") {
      return "已生成，重新生成";
    }
    return "生成 PDF";
  };

  const layout = useMemo<Layout[]>(() => {
    if (!resumeData) {
      return [];
    }

    return resumeData.items.map((item) => {
      const { layout: itemLayout } = item;
      return {
        i: item.id,
        x: itemLayout?.x ?? 0,
        y: itemLayout?.y ?? 0,
        w: itemLayout?.w ?? 4,
        h: itemLayout?.h ?? 4,
      };
    });
  }, [resumeData]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      setResumeData((prev) => {
        if (!prev) {
          return prev;
        }

        const updatedItems = prev.items.map((item) => {
          const nextLayout = newLayout.find((layoutItem) => layoutItem.i === item.id);
          if (!nextLayout) {
            return item;
          }

          const { x, y, w, h } = nextLayout;
          return {
            ...item,
            layout: {
              ...item.layout,
              x,
              y,
              w,
              h,
            },
          };
        });

        return { ...prev, items: updatedItems };
      });
    },
    [],
  );

  const handleSettingsChange = useCallback(
    (newSettings: LayoutSettings) => {
      setResumeData((prev) => {
        if (!prev) {
          return prev;
        }
        return { ...prev, layout_settings: newSettings };
      });
    },
    [],
  );

  const handleContentChange = useCallback((itemId: string, newHtml: string) => {
    setResumeData((prev) => {
      if (!prev) {
        return prev;
      }

      const updatedItems = prev.items.map((item) =>
        item.id === itemId ? { ...item, content: newHtml } : item,
      );

      return { ...prev, items: updatedItems };
    });
  }, []);

  const currentColumns =
    resumeData?.layout_settings?.columns ?? GRID_COLS;
  const currentRowHeight =
    resumeData?.layout_settings?.row_height_px ?? GRID_ROW_HEIGHT;

  const selectedItem = useMemo(() => {
    if (!resumeData || !selectedItemId) {
      return null;
    }
    return resumeData.items.find((item) => item.id === selectedItemId) ?? null;
  }, [resumeData, selectedItemId]);

  const selectedItemFontSize = useMemo(() => {
    if (!selectedItem || !resumeData?.layout_settings) {
      return null;
    }
    return parseFontSizeValue(
      selectedItem.style?.fontSize,
      resumeData.layout_settings.font_size_pt,
    );
  }, [selectedItem, resumeData?.layout_settings]);

  const selectedItemColor = useMemo(() => {
    if (!selectedItem || !resumeData?.layout_settings) {
      return null;
    }
    const rawColor = selectedItem.style?.color;
    if (typeof rawColor === "string" && rawColor.trim().length > 0) {
      return rawColor;
    }
    return resumeData.layout_settings.accent_color;
  }, [selectedItem, resumeData?.layout_settings]);

  const handleItemFontSizeChange = useCallback(
    (newSizePt: number) => {
      setResumeData((prev) => {
        if (!prev || !selectedItemId) {
          return prev;
        }

        const updatedItems = prev.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item;
          }

          const currentStyle = item.style ?? {};
          return {
            ...item,
            style: {
              ...currentStyle,
              fontSize: `${newSizePt}pt`,
            },
          };
        });

        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId],
  );

  const handleItemColorChange = useCallback(
    (newColor: string) => {
      setResumeData((prev) => {
        if (!prev || !selectedItemId) {
          return prev;
        }

        const updatedItems = prev.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item;
          }

          const currentStyle = item.style ?? {};
          return {
            ...item,
            style: {
              ...currentStyle,
              color: newColor,
            },
          };
        });

        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId],
  );

  const handleAddDivider = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }

    const accentColor =
      resumeData.layout_settings?.accent_color ??
      DEFAULT_LAYOUT_SETTINGS.accent_color;

    const newDivider: ResumeItem = {
      id: uuidv4(),
      type: "divider",
      content: "",
      layout: { x: 0, y: 0, w: 24, h: 2 },
      style: {
        borderTop: `2px solid ${accentColor}`,
        margin: "8px 0",
      },
    };

    setResumeData((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, items: [...prev.items, newDivider] };
    });
  }, [resumeData]);

  const handleAddImageClick = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    fileInputRef.current?.click();
  }, [resumeData, accessToken]);

  const handleImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      if (!accessToken) {
        setError("请先登录");
        event.target.value = "";
        return;
      }

      setError(null);
      setIsUploadingAsset(true);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch("/api/v1/assets/upload", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error("upload failed");
        }

        const data = await response.json();
        const objectKey = data?.objectKey;

        if (typeof objectKey !== "string" || objectKey.length === 0) {
          throw new Error("missing object key");
        }

        setResumeData((prev) => {
          if (!prev) {
            return prev;
          }

          const newImage: ResumeItem = {
            id: uuidv4(),
            type: "image",
            content: objectKey,
            layout: { x: 0, y: 0, w: 6, h: 10 },
            style: {
              borderRadius: "0.375rem",
              objectFit: "cover",
            },
          };

          return { ...prev, items: [...prev.items, newImage] };
        });
      } catch (err) {
        console.error("图片上传失败", err);
        setError("图片上传失败，请重试");
      } finally {
        setIsUploadingAsset(false);
        event.target.value = "";
      }
    },
    [accessToken],
  );

  const handleSelectItem = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
  }, []);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
          简历编辑器
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          加载并编辑结构化 JSON 布局，保存后可生成 PDF。
        </p>
      </header>

      {isFetchingResume && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          正在加载最新简历...
        </div>
      )}

      <input
        className="w-full rounded-md border border-zinc-200 bg-white p-4 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="请输入简历标题"
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="lg:w-80 space-y-4">
          <div>
            {resumeData ? (
              <StylePanel
                settings={resumeData.layout_settings}
                onSettingsChange={handleSettingsChange}
                selectedItemFontSize={selectedItemFontSize}
                onSelectedItemFontSizeChange={handleItemFontSizeChange}
                selectedItemColor={selectedItemColor}
                onSelectedItemColorChange={handleItemColorChange}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white/70 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
                {isFetchingResume ? "正在加载样式配置..." : "暂无样式可编辑"}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              元素库
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              添加新的分割线或图片模块，随时调整布局。
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleAddDivider}
                disabled={!resumeData}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                添加分割线
              </button>
              <button
                type="button"
                onClick={handleAddImageClick}
                disabled={!resumeData || isUploadingAsset}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {isUploadingAsset ? "图片上传中..." : "添加图片"}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
        </div>

        <div className="flex-1">
          <div className="w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50/60 p-4">
            {resumeData ? (
              <div className="overflow-x-auto">
                <PageContainer
                  width={CANVAS_WIDTH}
                  style={{
                    fontFamily: resumeData.layout_settings.font_family,
                    fontSize: `${resumeData.layout_settings.font_size_pt}pt`,
                    color: resumeData.layout_settings.accent_color,
                    padding: `${resumeData.layout_settings.margin_px}px`,
                  }}
                >
                  <RGL
                    className="h-full w-full"
                    layout={layout}
                    cols={currentColumns}
                    rowHeight={currentRowHeight}
                    draggableHandle=".rgl-drag-handle"
                    draggableCancel=".text-item-editor"
                    width={CANVAS_WIDTH}
                    onLayoutChange={handleLayoutChange}
                  >
                    {resumeData.items.map((item) => {
                      const isSelected = selectedItemId === item.id;
                      const baseStyle = {
                        fontSize: `${resumeData.layout_settings.font_size_pt}pt`,
                        color: resumeData.layout_settings.accent_color,
                        ...(item.style ?? {}),
                      };

                      const dividerStyle = {
                        borderColor: resumeData.layout_settings.accent_color,
                        ...(item.style ?? {}),
                      };

                      const imageStyle = {
                        width: "100%",
                        height: "100%",
                        objectFit: "cover" as const,
                        borderRadius: "0.375rem",
                        ...(item.style ?? {}),
                      };

                      return (
                        <div
                          key={item.id}
                          className={`relative h-full w-full rounded-md border border-dashed bg-white/90 px-2 pb-4 pt-6 text-sm text-zinc-900 shadow-sm ${
                            isSelected ? "border-blue-500" : "border-zinc-200"
                          }`}
                          onMouseDownCapture={() => handleSelectItem(item.id)}
                          onFocus={() => handleSelectItem(item.id)}
                          tabIndex={0}
                        >
                          <div className="rgl-drag-handle absolute right-2 top-2 cursor-move rounded-full border border-zinc-300 bg-white/80 px-2 py-0.5 text-xs text-zinc-500 shadow-sm hover:bg-white">
                            拖动
                          </div>

                          {item.type === "text" && (
                            <TextItem
                              html={item.content}
                              style={baseStyle}
                              onChange={(newHtml) =>
                                handleContentChange(item.id, newHtml)
                              }
                            />
                          )}

                          {item.type === "divider" && (
                            <DividerItem style={dividerStyle} />
                          )}

                          {item.type === "image" && (
                            <ImageItem
                              objectKey={item.content}
                              style={imageStyle}
                            />
                          )}

                          {item.type !== "text" &&
                            item.type !== "divider" &&
                            item.type !== "image" && (
                              <div className="text-xs text-red-500">
                                暂不支持的类型：{item.type}
                              </div>
                            )}
                        </div>
                      );
                    })}
                  </RGL>
                </PageContainer>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-zinc-500">
                {isFetchingResume ? "正在加载布局..." : "暂无简历布局数据"}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading || isFetchingResume}
          className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isLoading ? "保存中..." : "保存简历"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={savedResumeId === null || taskStatus === "pending"}
          className="rounded-md border border-zinc-300 px-6 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {renderDownloadLabel()}
        </button>
      </div>

      {savedResumeId !== null && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          已保存的简历 ID：{savedResumeId}
        </div>
      )}

      {taskStatus === "pending" && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          正在生成 PDF，请稍候...
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-100 px-4 py-2 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

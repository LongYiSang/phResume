"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import RGL, { type Layout } from "react-grid-layout";
import { v4 as uuidv4 } from "uuid";
import { PageContainer } from "@/components/PageContainer";
import Inspector from "@/components/Inspector";
import Dock from "@/components/Dock";
import { TextItem } from "@/components/TextItem";
import { SectionTitleItem } from "@/components/SectionTitleItem";
import { DividerItem } from "@/components/DividerItem";
import { ImageItem } from "@/components/ImageItem";
import { TemplatesPanel } from "@/components/TemplatesPanel";
import { MyResumesPanel } from "@/components/MyResumesPanel";
import { AssetsPanel } from "@/components/AssetsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useAuth } from "@/context/AuthContext";
import { ActiveEditorProvider } from "@/context/ActiveEditorContext";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { Move } from "lucide-react";
import {
  DEFAULT_LAYOUT_SETTINGS,
  GRID_COLS,
  GRID_ROW_HEIGHT,
  normalizeResumeContent,
} from "@/utils/resume";
import { API_ROUTES } from "@/lib/api-routes";
import { applyOpacityToColor, extractBackgroundStyle } from "@/utils/color";
import type {
  LayoutSettings,
  ResumeData,
  ResumeItem,
  ResumeItemStyle,
} from "@/types/resume";

import { Watermark } from "@/components/Watermark";

type TaskStatus = "idle" | "pending" | "completed";

const CANVAS_WIDTH = 794; // 必须与 pdf_template.go (794px) 匹配
const CANVAS_HEIGHT = Math.round((CANVAS_WIDTH * 297) / 210);

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

const DEFAULT_DIVIDER_THICKNESS = 2;
const DEFAULT_BACKGROUND_OPACITY = 0.7;

function extractDividerThickness(style?: ResumeItemStyle): number | null {
  if (!style) {
    return null;
  }
  const borderTop = style.borderTop;
  if (typeof borderTop === "string") {
    const match = borderTop.match(/([\d.]+)px/);
    if (match) {
      const parsed = parseFloat(match[1]);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  const borderWidth = style.borderWidth;
  if (typeof borderWidth === "number" && !Number.isNaN(borderWidth)) {
    return borderWidth;
  }
  if (typeof borderWidth === "string") {
    const parsed = parseFloat(borderWidth);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractDividerColor(style?: ResumeItemStyle): string | null {
  if (!style) {
    return null;
  }
  const borderTop = style.borderTop;
  if (typeof borderTop === "string") {
    const colorMatches = borderTop.match(
      /(#[0-9a-fA-F]{3,8}|rgba?\([^\)]+\)|hsla?\([^\)]+\)|[a-zA-Z]+)/g,
    );
    if (colorMatches && colorMatches.length > 0) {
      const filtered = colorMatches.filter(
        (token) =>
          !["solid", "dashed", "double", "none"].includes(token.toLowerCase()),
      );
      if (filtered.length > 0) {
        return filtered[filtered.length - 1];
      }
    }
  }
  if (typeof style.borderColor === "string") {
    return style.borderColor;
  }
  if (typeof style.color === "string") {
    return style.color;
  }
  return null;
}

function parseScaleFromTransform(transformValue?: unknown): number | null {
  if (typeof transformValue !== "string") {
    return null;
  }
  const match = transformValue.match(/scale\(([^)]+)\)/i);
  if (!match) {
    return null;
  }
  const parsed = parseFloat(match[1]);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function parsePositionPercent(
  value?: unknown,
): { x: number; y: number } | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const parsePart = (part: string) => {
    if (part.endsWith("%")) {
      const num = parseFloat(part.slice(0, -1));
      if (!Number.isNaN(num)) {
        return Math.max(0, Math.min(100, num));
      }
    }
    return null;
  };
  const x = parsePart(parts[0]);
  const y = parsePart(parts[1]);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

function parseBackgroundOpacity(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }
  return null;
}

// 深拷贝工具：用于历史栈快照
function deepCloneResumeData(data: ResumeData): ResumeData {
  return JSON.parse(JSON.stringify(data)) as ResumeData;
}

export default function Home() {
  const router = useRouter();
  const { accessToken, setAccessToken, isAuthenticated, isCheckingAuth } = useAuth();
  const authFetch = useAuthFetch();
  const [title, setTitle] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [savedResumeId, setSavedResumeId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingResume, setIsFetchingResume] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isMyResumesOpen, setIsMyResumesOpen] = useState(false);
  const [isAssetsOpen, setIsAssetsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [assetPanelRefreshToken, setAssetPanelRefreshToken] = useState(0);
  const [zoom, setZoom] = useState(1);
  const socketRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 全局撤销/重做（不包含文本框内字符级编辑）
  const [historyStack, setHistoryStack] = useState<ResumeData[]>([]);
  const [redoStack, setRedoStack] = useState<ResumeData[]>([]);
  // 便于在回调中访问最新状态的 ref
  const resumeDataRef = useRef<ResumeData | null>(null);
  const historyRef = useRef<ResumeData[]>([]);
  const redoRef = useRef<ResumeData[]>([]);
  // 交互起始快照（拖拽/缩放）
  const interactionStartSnapshotRef = useRef<ResumeData | null>(null);
  // 拖拽/缩放标记
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);

  const applyServerResume = useCallback(
    (payload: { id: number | null; title: string; content: ResumeData | null }) => {
      setTitle(payload.title);
      setSavedResumeId(payload.id);
      setResumeData(payload.content ? deepCloneResumeData(payload.content) : null);
      setHistoryStack([]);
      setRedoStack([]);
      setSelectedItemId(null);
    },
    [],
  );

  const saveResume = useCallback(
    async (items: ResumeItem[], newSettings: LayoutSettings) => {
      if (!isAuthenticated) {
        return;
      }
      if (!savedResumeId) {
        return;
      }
      try {
        await authFetch(API_ROUTES.RESUME.update(savedResumeId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content: {
              layout_settings: newSettings,
              items,
            },
          }),
        });
      } catch (err) {
        console.error("自动保存失败", err);
      }
    },
    [isAuthenticated, savedResumeId, title, authFetch],
  );

  useEffect(() => {
    resumeDataRef.current = resumeData;
  }, [resumeData]);
  useEffect(() => {
    historyRef.current = historyStack;
  }, [historyStack]);
  useEffect(() => {
    redoRef.current = redoStack;
  }, [redoStack]);

  // 统一的历史入栈包裹器：对变更前状态拍快照 -> 清空 redo -> 应用变更
  const withHistory = useCallback(
    (updater: (prev: ResumeData) => ResumeData) => {
      setResumeData((prev) => {
        if (!prev) {
          return prev;
        }
        // 入历史快照
        setHistoryStack((hs) => [...hs, deepCloneResumeData(prev)]);
        // 变更发生时清空重做栈
        setRedoStack([]);
        // 返回新状态
        return updater(prev);
      });
    },
    [],
  );

  const appendImageItem = useCallback(
    (objectKey: string) => {
      withHistory((prev) => {
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
    },
    [withHistory],
  );

  const fetchDownloadLink = useCallback(
    async (resumeId: number) => {
      if (!isAuthenticated) {
        setError("请先登录");
        setTaskStatus("idle");
        return;
      }

      setError(null);

      try {
        const response = await authFetch(
          API_ROUTES.RESUME.downloadLink(resumeId),
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
    [isAuthenticated, authFetch],
  );

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated === false) {
      router.push("/login");
    }
  }, [isAuthenticated, isCheckingAuth, router]);

  const resolveWebSocketURL = useCallback(() => {
    return API_ROUTES.resolveWsUrl();
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
    if (!isAuthenticated) {
      return;
    }

    setIsFetchingResume(true);
    setError(null);

    try {
      const response = await authFetch(API_ROUTES.RESUME.latest());

      if (!response.ok) {
        throw new Error("failed to fetch latest resume");
      }

      const data = await response.json();
      const parsedContent = normalizeResumeContent(data?.content);
      applyServerResume({
        id: typeof data?.id === "number" && data.id > 0 ? data.id : null,
        title: data?.title ?? "",
        content: parsedContent,
      });
    } catch (err) {
      console.error("加载最新简历失败", err);
      setError("加载最新简历失败，请稍后重试");
    } finally {
      setIsFetchingResume(false);
    }
  }, [applyServerResume, authFetch, isAuthenticated]);

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      fetchLatestResume();
    }
  }, [isAuthenticated, isCheckingAuth, fetchLatestResume]);

  const handleSave = async () => {
    setError(null);

    if (!isAuthenticated) {
      setError("请先登录");
      return;
    }

    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }
    // 保存前校验重叠
    const currentOverlap = calcOverlapIds(resumeData.items);
    if (currentOverlap.size > 0) {
      setError("存在重叠模块，无法保存，请调整位置后重试。");
      return;
    }

    let targetTitle = title.trim();
    let endpoint = "";
    let method: "POST" | "PUT" = "POST";
    const resumeIdForUpdate: number | null = savedResumeId;

      if (resumeIdForUpdate === null) {
        const inputTitle = window.prompt("请输入新简历标题", title || "我的简历");
        if (inputTitle === null) {
          return;
        }
        targetTitle = inputTitle.trim();
        if (!targetTitle) {
          setError("简历标题不能为空");
          return;
        }
        endpoint = API_ROUTES.RESUME.create();
        method = "POST";
      } else {
        if (!targetTitle) {
          setError("简历标题不能为空");
          return;
        }
        endpoint = API_ROUTES.RESUME.update(resumeIdForUpdate);
        method = "PUT";
      }

    setIsLoading(true);

    try {
      const response = await authFetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: targetTitle, content: resumeData }),
      });

      if (!response.ok) {
        if (response.status === 403 && resumeIdForUpdate === null) {
          setError("已达简历保存上限，请升级会员。");
          return;
        }
        throw new Error("保存失败");
      }

      const data = await response.json();
      const normalized = normalizeResumeContent(data?.content);
      const nextId =
        typeof data?.id === "number" && data.id > 0
          ? data.id
          : resumeIdForUpdate;
      applyServerResume({
        id: typeof nextId === "number" ? nextId : null,
        title: data?.title ?? targetTitle,
        content: normalized ?? resumeDataRef.current ?? null,
      });
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

    if (!isAuthenticated) {
      setError("请先登录");
      return;
    }

    setError(null);
    setTaskStatus("pending");

    // 不再主动轮询，等待 WebSocket 完成消息后再打开最新 PDF

    try {
      const response = await authFetch(
        API_ROUTES.RESUME.download(savedResumeId),
      );

      if (!response.ok) {
        throw new Error("下载失败");
      }

      // 生成任务已提交，待 WebSocket 完成后再触发 fetchDownloadLink
    } catch (err) {
      console.error("生成任务提交失败", err);
      setError("生成任务提交失败，请稍后重试");
      setTaskStatus("idle");
    }
  };

  // const renderDownloadLabel = () => {
  //   if (taskStatus === "pending") {
  //     return "生成中...";
  //   }
  //   if (taskStatus === "completed") {
  //     return "已生成，重新生成";
  //   }
  //   return "生成 PDF";
  // };

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

        const dragging = isDraggingRef.current;

        const updatedItems = prev.items.map((item) => {
          const nextLayout = newLayout.find((layoutItem) => layoutItem.i === item.id);
          if (!nextLayout) {
            return item;
          }

          const { x, y, w, h } = nextLayout;
          if (dragging) {
            // 拖动过程中仅更新坐标，保持宽高不变，满足“维持原始高度/尺寸”的要求
            return {
              ...item,
              layout: {
                ...item.layout,
                x,
                y,
                w: item.layout?.w ?? w,
                h: item.layout?.h ?? h,
              },
            };
          }

        // 缩放时或其他情况下，完整同步（w/h 仅在缩放时会变化）
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
      withHistory((prev) => ({ ...prev, layout_settings: newSettings }));
    },
    [withHistory],
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

  const handleLogout = useCallback(async () => {
    try {
      const { API_ROUTES } = await import("@/lib/api-routes");
      await authFetch(API_ROUTES.AUTH.logout(), { method: "POST" });
    } catch (err) {
      console.warn("后端登出失败，继续清除前端状态", err);
    } finally {
      // 无论后端是否成功，前端都必须清除状态
      setAccessToken(null);
      router.push("/login");
    }
  }, [authFetch, setAccessToken, router]);


  const currentColumns =
    resumeData?.layout_settings?.columns ?? GRID_COLS;
  const currentRowHeight =
    resumeData?.layout_settings?.row_height_px ?? GRID_ROW_HEIGHT;
  const layoutMarginPx =
    resumeData?.layout_settings?.margin_px ?? DEFAULT_LAYOUT_SETTINGS.margin_px;
  const scaledCanvasWidth = Math.round(CANVAS_WIDTH * zoom);
  const scaledCanvasHeight = Math.round(CANVAS_HEIGHT * zoom);
  const innerCanvasWidth = Math.max(0, scaledCanvasWidth - layoutMarginPx * 2);
  const innerCanvasHeight = Math.max(0, scaledCanvasHeight - layoutMarginPx * 2);

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
    if (selectedItem.type === "divider") {
      return (
        extractDividerColor(selectedItem.style) ??
        resumeData.layout_settings.accent_color
      );
    }
    const rawColor = selectedItem.style?.color;
    if (typeof rawColor === "string" && rawColor.trim().length > 0) {
      return rawColor;
    }
    return resumeData.layout_settings.accent_color;
  }, [selectedItem, resumeData?.layout_settings]);

  const selectedItemLineHeight = useMemo(() => {
    if (!selectedItem || !resumeData?.layout_settings) {
      return null;
    }
    const raw = selectedItem.style?.lineHeight;
    if (typeof raw === "number" && !Number.isNaN(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      const parsed = parseFloat(raw);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return 1.2;
  }, [selectedItem, resumeData?.layout_settings]);

  const selectedItemFontFamily = useMemo(() => {
    if (
      !selectedItem ||
      (selectedItem.type !== "text" && selectedItem.type !== "section_title") ||
      !resumeData?.layout_settings
    ) {
      return null;
    }
    const rawFamily = selectedItem.style?.fontFamily;
    if (typeof rawFamily === "string" && rawFamily.trim().length > 0) {
      return rawFamily;
    }
    return resumeData.layout_settings.font_family;
  }, [selectedItem, resumeData?.layout_settings]);

  const selectedDividerThickness = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "divider") {
      return null;
    }
    return extractDividerThickness(selectedItem.style) ?? DEFAULT_DIVIDER_THICKNESS;
  }, [selectedItem]);

  const selectedImageScalePercent = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "image") {
      return null;
    }
    const scale = parseScaleFromTransform(selectedItem.style?.transform);
    if (!scale) {
      return 100;
    }
    return Math.round(scale * 100);
  }, [selectedItem]);

  const selectedImageFocus = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "image") {
      return null;
    }
    return (
      parsePositionPercent(selectedItem.style?.objectPosition) ??
      parsePositionPercent((selectedItem.style as Record<string, unknown>)?.transformOrigin) ?? {
        x: 50,
        y: 50,
      }
    );
  }, [selectedItem]);

  const selectedItemBackgroundColor = useMemo(() => {
    if (!selectedItem) {
      return null;
    }
    const { color } = extractBackgroundStyle(selectedItem.style);
    return color ?? null;
  }, [selectedItem]);

  const selectedBorderRadius = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "section_title") {
      return null;
    }
    const radius = selectedItem.style?.borderTopLeftRadius;
    if (typeof radius === "number") return radius;
    if (typeof radius === "string") return parseFloat(radius) || 0;
    return 0;
  }, [selectedItem]);

  const selectedItemBackgroundOpacity = useMemo(() => {
    if (!selectedItem) {
      return null;
    }
    const { opacity } = extractBackgroundStyle(selectedItem.style);
    return typeof opacity === "number" ? opacity : null;
  }, [selectedItem]);

  const handleItemFontSizeChange = useCallback(
    (newSizePt: number) => {
      if (!selectedItemId) return;
      withHistory((prev) => {
        const updatedItems = prev.items.map((item) =>
          item.id !== selectedItemId
            ? item
            : {
                ...item,
                style: {
                  ...(item.style ?? {}),
                  fontSize: `${newSizePt}pt`,
                },
              },
        );
        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleItemColorChange = useCallback(
    (newColor: string) => {
      if (!selectedItemId) return;
      withHistory((prev) => {
        const accent =
          prev.layout_settings?.accent_color ?? DEFAULT_LAYOUT_SETTINGS.accent_color;
        const safeColor = newColor || accent;
        const updatedItems = prev.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item;
          }
          if (item.type === "divider") {
            const nextThickness =
              extractDividerThickness(item.style) ?? DEFAULT_DIVIDER_THICKNESS;
            return {
              ...item,
              style: {
                ...(item.style ?? {}),
                borderTop: `${nextThickness}px solid ${safeColor}`,
                borderColor: safeColor,
                color: safeColor,
              },
            };
          }
          return {
            ...item,
            style: {
              ...(item.style ?? {}),
              color: safeColor,
            },
          };
        });
        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleItemBackgroundColorChange = useCallback(
    (newColor: string | null) => {
      if (!selectedItemId) return;
      withHistory((prev) => {
        const updatedItems = prev.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item;
          }
          const nextStyle: ResumeItemStyle = {
            ...(item.style ?? {}),
          };
          const trimmed = newColor?.trim();
          if (!trimmed) {
            delete nextStyle.backgroundColor;
            delete nextStyle.backgroundOpacity;
            return {
              ...item,
              style: nextStyle,
            };
          }
          const existingOpacity = parseBackgroundOpacity(nextStyle.backgroundOpacity);
          nextStyle.backgroundColor = trimmed;
          nextStyle.backgroundOpacity =
            existingOpacity ?? DEFAULT_BACKGROUND_OPACITY;
          
          if (item.type === "section_title") {
            nextStyle.borderColor = trimmed;
          }

          return {
            ...item,
            style: nextStyle,
          };
        });
        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleItemBackgroundOpacityChange = useCallback(
    (nextOpacity: number) => {
      if (!selectedItemId) return;
      const clamped = Math.max(0, Math.min(1, nextOpacity));
      withHistory((prev) => {
        const updatedItems = prev.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item;
          }
          const nextStyle: ResumeItemStyle = {
            ...(item.style ?? {}),
          };
          nextStyle.backgroundOpacity = clamped;
          return {
            ...item,
            style: nextStyle,
          };
        });
        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleDividerThicknessChange = useCallback(
    (nextThickness: number) => {
      if (!selectedItemId) return;
      const clamped = Math.max(1, Math.min(10, Math.round(nextThickness)));
      withHistory((prev) => {
        const accent =
          prev.layout_settings?.accent_color ?? DEFAULT_LAYOUT_SETTINGS.accent_color;
        const updatedItems = prev.items.map((item) => {
          if (item.id !== selectedItemId || item.type !== "divider") {
            return item;
          }
          const currentColor =
            extractDividerColor(item.style) ?? accent;
          return {
            ...item,
            style: {
              ...(item.style ?? {}),
              borderTop: `${clamped}px solid ${currentColor}`,
              borderColor: currentColor,
              color: currentColor,
            },
          };
        });
        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleItemFontFamilyChange = useCallback(
    (fontFamily: string) => {
      if (!selectedItemId) return;
      withHistory((prev) => {
        const updatedItems = prev.items.map((item) =>
          item.id !== selectedItemId
            ? item
            : {
                ...item,
                style: {
                  ...(item.style ?? {}),
                  fontFamily,
                },
              },
        );
        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleBorderRadiusChange = useCallback(
    (radius: number) => {
      if (!selectedItemId) return;
      withHistory((prev) => {
        const updatedItems = prev.items.map((item) =>
          item.id !== selectedItemId
            ? item
            : {
                ...item,
                style: {
                  ...(item.style ?? {}),
                  borderTopLeftRadius: radius,
                  borderTopRightRadius: radius,
                },
              },
        );
        return { ...prev, items: updatedItems };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleImageZoomChange = useCallback(
    (scale: number) => {
      if (!selectedItemId) return;
      const nextScale = Math.max(0.5, Math.min(2, scale));
      withHistory((prev) => {
        const updated = prev.items.map((item) => {
          if (item.id !== selectedItemId || item.type !== "image") {
            return item;
          }
          const existingOrigin =
            typeof item.style?.transformOrigin === "string"
              ? item.style.transformOrigin
              : typeof item.style?.objectPosition === "string"
                ? item.style.objectPosition
                : "50% 50%";
          return {
            ...item,
            style: {
              ...(item.style ?? {}),
              transform: `scale(${nextScale})`,
              transformOrigin: existingOrigin,
            },
          };
        });
        return { ...prev, items: updated };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleImageFocusChange = useCallback(
    (xPercent: number, yPercent: number) => {
      if (!selectedItemId) return;
      const nextX = Math.max(0, Math.min(100, Math.round(xPercent)));
      const nextY = Math.max(0, Math.min(100, Math.round(yPercent)));
      const nextValue = `${nextX}% ${nextY}%`;
      withHistory((prev) => {
        const updated = prev.items.map((item) =>
          item.id !== selectedItemId || item.type !== "image"
            ? item
            : {
                ...item,
                style: {
                  ...(item.style ?? {}),
                  objectPosition: nextValue,
                  transformOrigin: nextValue,
                },
              },
        );
        return { ...prev, items: updated };
      });
    },
    [selectedItemId, withHistory],
  );

  const handleImageZoomReset = useCallback(() => {
    if (!selectedItemId) return;
    withHistory((prev) => {
      const updated = prev.items.map((item) =>
        item.id !== selectedItemId || item.type !== "image"
          ? item
          : {
              ...item,
              style: {
                ...(item.style ?? {}),
                transform: "scale(1)",
                objectPosition: "50% 50%",
                transformOrigin: "50% 50%",
              },
            },
      );
      return { ...prev, items: updated };
    });
  }, [selectedItemId, withHistory]);

  // 计算居中插入位置（x 水平居中，y 取当前占用高度的中位数）
  function computeCenteredPosition(prev: ResumeData, w: number, h: number) {
    const cols = prev.layout_settings?.columns ?? GRID_COLS;
    const x = Math.max(0, Math.min(cols - w, Math.floor((cols - w) / 2)));
    const usedHeight = prev.items.reduce((max, it) => {
      const ly = it.layout;
      const bottom = (ly?.y ?? 0) + (ly?.h ?? 0);
      return Math.max(max, bottom);
    }, 0);
    const y = Math.max(0, Math.floor(usedHeight / 2) - Math.floor(h / 2));
    return { x, y };
  }

  const handleAddSectionTitle = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }
    const defaultW = 24;
    const defaultH = 3;
    const accentColor =
      resumeData.layout_settings?.accent_color ??
      DEFAULT_LAYOUT_SETTINGS.accent_color;

    withHistory((prev) => {
      const pos = computeCenteredPosition(prev, defaultW, defaultH);
      const newItem: ResumeItem = {
        id: uuidv4(),
        type: "section_title",
        content: "分节标题",
        layout: { x: pos.x, y: pos.y, w: defaultW, h: defaultH },
        style: {
          fontSize: `${(prev.layout_settings?.font_size_pt ?? DEFAULT_LAYOUT_SETTINGS.font_size_pt) + 2}pt`,
          backgroundColor: accentColor,
          color: "#ffffff",
          borderColor: accentColor,
        },
      };
      return { ...prev, items: [...prev.items, newItem] };
    });
  }, [resumeData, withHistory]);

  const handleAddText = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }
    const defaultW = 12;
    const defaultH = 6;
    withHistory((prev) => {
      const pos = computeCenteredPosition(prev, defaultW, defaultH);
      const newText: ResumeItem = {
        id: uuidv4(),
        type: "text",
        content: "",
        layout: { x: pos.x, y: pos.y, w: defaultW, h: defaultH },
        style: {
          fontSize: `${prev.layout_settings?.font_size_pt ?? DEFAULT_LAYOUT_SETTINGS.font_size_pt}pt`,
          color: prev.layout_settings?.accent_color ?? DEFAULT_LAYOUT_SETTINGS.accent_color,
        },
      };
      return { ...prev, items: [...prev.items, newText] };
    });
  }, [resumeData, withHistory]);

  // 计算重叠模块集合：任意两矩形相交则判定重叠
  function calcOverlapIds(items: ResumeItem[]): Set<string> {
    const ids = new Set<string>();
    const rects = items.map((it) => {
      const x = it.layout?.x ?? 0;
      const y = it.layout?.y ?? 0;
      const w = it.layout?.w ?? 0;
      const h = it.layout?.h ?? 0;
      return { id: it.id, left: x, right: x + w, top: y, bottom: y + h };
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const sepH = a.right <= b.left || b.right <= a.left;
        const sepV = a.bottom <= b.top || b.bottom <= a.top;
        if (!(sepH || sepV)) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }

  const overlapIds = useMemo(() => {
    if (!resumeData) return new Set<string>();
    return calcOverlapIds(resumeData.items);
  }, [resumeData]);

  const handleAddDivider = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }

    const accentColor =
      resumeData.layout_settings?.accent_color ??
      DEFAULT_LAYOUT_SETTINGS.accent_color;

    withHistory((prev) => {
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
      return { ...prev, items: [...prev.items, newDivider] };
    });
  }, [resumeData, withHistory]);

  const handleAddImageClick = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }
    if (!isAuthenticated) {
      setError("请先登录");
      return;
    }
    setIsAssetsOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsTemplatesOpen(false);
        setIsMyResumesOpen(false);
        setIsSettingsOpen(false);
      }
      return next;
    });
  }, [resumeData, isAuthenticated]);

  const handleRequestAssetUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      if (!isAuthenticated) {
        setError("请先登录");
        event.target.value = "";
        return;
      }

      if (!resumeDataRef.current) {
        setError("简历内容尚未加载完成");
        event.target.value = "";
        return;
      }

      setError(null);
      setIsUploadingAsset(true);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const { API_ROUTES } = await import("@/lib/api-routes");
        const response = await authFetch(API_ROUTES.ASSETS.upload(), {
          method: "POST",
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

        appendImageItem(objectKey);
        setAssetPanelRefreshToken((token) => token + 1);
      } catch (err) {
        console.error("图片上传失败", err);
        setError("图片上传失败，请重试");
      } finally {
        setIsUploadingAsset(false);
        event.target.value = "";
      }
    },
    [authFetch, isAuthenticated, appendImageItem],
  );

  const handleSelectAssetFromPanel = useCallback(
    (objectKey: string) => {
      if (!isAuthenticated) {
        setError("请先登录");
        return;
      }
      if (!resumeDataRef.current) {
        setError("简历内容尚未加载完成");
        return;
      }
      appendImageItem(objectKey);
      setIsAssetsOpen(false);
    },
    [appendImageItem, isAuthenticated],
  );

  const handleSelectItem = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
  }, []);

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      const ok = window.confirm("确认要删除该模块吗？此操作不可撤销。");
      if (!ok) return;
      withHistory((prev) => {
        const nextItems = prev.items.filter((i) => i.id !== itemId);
        return { ...prev, items: nextItems };
      });
      setSelectedItemId((curr) => (curr === itemId ? null : curr));
    },
    [withHistory],
  );

  // 撤销/重做
  const handleUndo = useCallback(() => {
    const curr = resumeDataRef.current;
    const hs = historyRef.current;
    if (!curr || hs.length === 0) return;
    const prevState = hs[hs.length - 1];
    setHistoryStack(hs.slice(0, -1));
    setRedoStack((rs) => [...rs, deepCloneResumeData(curr)]);
    setResumeData(deepCloneResumeData(prevState));
  }, []);

  const handleRedo = useCallback(() => {
    const curr = resumeDataRef.current;
    const rs = redoRef.current;
    if (!curr || rs.length === 0) return;
    const nextState = rs[rs.length - 1];
    setRedoStack(rs.slice(0, -1));
    setHistoryStack((hs) => [...hs, deepCloneResumeData(curr)]);
    setResumeData(deepCloneResumeData(nextState));
  }, []);

  // 应用模板：完全替换主状态，并将之前状态入历史
  const replaceResumeData = useCallback((nextData: ResumeData) => {
    setResumeData((prev) => {
      if (prev) {
        setHistoryStack((hs) => [...hs, deepCloneResumeData(prev)]);
        setRedoStack([]);
      }
      return deepCloneResumeData(nextData);
    });
  }, []);

  const handlePanelResumeSelected = useCallback(
    (payload: { id: number; title: string; content: ResumeData }) => {
      applyServerResume({
        id: payload.id,
        title: payload.title,
        content: payload.content,
      });
      setTaskStatus("idle");
    },
    [applyServerResume],
  );

  const handlePanelResumeDeleted = useCallback(
    (deletedId: number) => {
      if (savedResumeId === deletedId) {
        fetchLatestResume();
      }
    },
    [fetchLatestResume, savedResumeId],
  );

  // 拖拽/缩放交互：开始时拍快照，结束时如有变动则把起始快照推入历史
  const simplifiedLayouts = useCallback((data: ResumeData | null) => {
    if (!data) return [];
    return data.items
      .map((it) => ({
        id: it.id,
        x: it.layout?.x ?? 0,
        y: it.layout?.y ?? 0,
        w: it.layout?.w ?? 0,
        h: it.layout?.h ?? 0,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, []);
  const isLayoutChanged = useCallback(
    (a: ResumeData | null, b: ResumeData | null) => {
      const sa = simplifiedLayouts(a);
      const sb = simplifiedLayouts(b);
      return JSON.stringify(sa) !== JSON.stringify(sb);
    },
    [simplifiedLayouts],
  );

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    interactionStartSnapshotRef.current = resumeDataRef.current
      ? deepCloneResumeData(resumeDataRef.current)
      : null;
  }, []);
  const handleDragStop = useCallback(() => {
    isDraggingRef.current = false;
    const start = interactionStartSnapshotRef.current;
    const curr = resumeDataRef.current;
    interactionStartSnapshotRef.current = null;
    if (start && curr && isLayoutChanged(start, curr)) {
      setHistoryStack((hs) => [...hs, deepCloneResumeData(start)]);
      setRedoStack([]);
    }
  }, [isLayoutChanged]);
  const handleResizeStart = useCallback(() => {
    isResizingRef.current = true;
    interactionStartSnapshotRef.current = resumeDataRef.current
      ? deepCloneResumeData(resumeDataRef.current)
      : null;
  }, []);
  const handleResizeStop = useCallback(() => {
    isResizingRef.current = false;
    const start = interactionStartSnapshotRef.current;
    const curr = resumeDataRef.current;
    interactionStartSnapshotRef.current = null;
    if (start && curr && isLayoutChanged(start, curr)) {
      setHistoryStack((hs) => [...hs, deepCloneResumeData(start)]);
      setRedoStack([]);
    }
  }, [isLayoutChanged]);

  return (
    <ActiveEditorProvider>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
        
        

      {isFetchingResume && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          正在加载最新简历...
        </div>
      )}

      

      <div className="relative">
        <div className="fixed left-6 top-1/2 -translate-y-1/2 z-40">
          <Dock
            onAddText={handleAddText}
            onAddSectionTitle={handleAddSectionTitle}
            onAddImage={handleAddImageClick}
            onAddDivider={handleAddDivider}
            onOpenTemplates={() =>
              setIsTemplatesOpen((prev) => {
                const next = !prev;
                if (next) {
                  setIsMyResumesOpen(false);
                  setIsAssetsOpen(false);
                  setIsSettingsOpen(false);
                }
                return next;
              })
            }
            onOpenMyResumes={() =>
              setIsMyResumesOpen((prev) => {
                const next = !prev;
                if (next) {
                  setIsTemplatesOpen(false);
                  setIsAssetsOpen(false);
                  setIsSettingsOpen(false);
                }
                return next;
              })
            }
            onOpenSettings={() =>
              setIsSettingsOpen((prev) => {
                const next = !prev;
                if (next) {
                  setIsTemplatesOpen(false);
                  setIsMyResumesOpen(false);
                  setIsAssetsOpen(false);
                }
                return next;
              })
            }
            onLogout={handleLogout}
            assetsActive={isAssetsOpen}
            settingsActive={isSettingsOpen}
            disabled={!resumeData}
            onToggleWatermark={() => {
              if (!resumeData) return;
              const newSettings = {
                ...resumeData.layout_settings,
                enable_watermark: !resumeData.layout_settings.enable_watermark,
              };
              setResumeData({
                ...resumeData,
                layout_settings: newSettings,
              });
              // 自动保存
              saveResume(resumeData.items, newSettings);
            }}
            watermarkEnabled={resumeData?.layout_settings.enable_watermark}
          />
        </div>

        <div className="fixed right-6 top-1/2 -translate-y-1/2 z-40 w-80 " >
          {resumeData && (
          <Inspector
              title={title}
              onUpdateTitle={setTitle}
              onSave={handleSave}
              onDownload={handleDownload}
              historyCanUndo={historyStack.length > 0}
              historyCanRedo={redoStack.length > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
              styleSettings={resumeData.layout_settings}
              onStyleSettingsChange={handleSettingsChange}
              selectedItemType={selectedItem?.type ?? null}
              selectedItemFontSize={
                selectedItem?.type === "text" || selectedItem?.type === "section_title"
                  ? selectedItemFontSize
                  : null
              }
              onSelectedItemFontSizeChange={handleItemFontSizeChange}
            selectedItemColor={
              selectedItem?.type === "text" || selectedItem?.type === "divider"
                ? selectedItemColor
                : null
            }
            onSelectedItemColorChange={handleItemColorChange}
            selectedItemLineHeight={
              selectedItem?.type === "text" || selectedItem?.type === "section_title"
                ? selectedItemLineHeight
                : null
            }
            onSelectedItemLineHeightChange={(lh) => {
              if (!selectedItemId || typeof lh !== "number") return;
              withHistory((prev) => {
                const updatedItems = prev.items.map((item) =>
                  item.id !== selectedItemId
                    ? item
                    : {
                        ...item,
                        style: {
                          ...(item.style ?? {}),
                          lineHeight: lh,
                        },
                      },
                );
                return { ...prev, items: updatedItems };
              });
            }}
              selectedItemFontFamily={
                selectedItem?.type === "text" || selectedItem?.type === "section_title"
                  ? selectedItemFontFamily
                  : null
              }
              onSelectedItemFontFamilyChange={handleItemFontFamilyChange}
              selectedDividerThickness={
                selectedItem?.type === "divider" ? selectedDividerThickness : null
              }
              onDividerThicknessChange={handleDividerThicknessChange}
              selectedItemContent={selectedItem?.type === "image" ? selectedItem.content : null}
              selectedImageScalePercent={
                selectedItem?.type === "image" ? selectedImageScalePercent : null
              }
              selectedImageFocus={
                selectedItem?.type === "image" ? selectedImageFocus : null
              }
              selectedBorderRadius={selectedBorderRadius}
              selectedItemBackgroundColor={selectedItemBackgroundColor}
              selectedItemBackgroundOpacity={selectedItemBackgroundOpacity}
              onBackgroundColorChange={handleItemBackgroundColorChange}
              onBackgroundOpacityChange={handleItemBackgroundOpacityChange}
              onDividerThicknessChange={handleDividerThicknessChange}
              onBorderRadiusChange={handleBorderRadiusChange}
              onImageZoomChange={handleImageZoomChange}
              onImageFocusChange={handleImageFocusChange}
              onImageZoomReset={handleImageZoomReset}
              onDeleteSelected={() => {
                if (!selectedItemId) return;
                handleDeleteItem(selectedItemId);
              }}
              onFormatText={(type) => {
                if (!selectedItemId) return;
                if (!type) return;
              }}
              onAlignElement={(format) => {
                if (!selectedItemId) return;
                if (!format) return;
              }}
              onListToggle={(type) => {
                if (!selectedItemId) return;
                if (!type) return;
              }}
              zoom={zoom}
              setZoom={setZoom}
            />
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />

        <div className="min-h-screen flex items-start justify-center px-[120px]">
          <div className="w-full max-w-5xl rounded-[32px] border border-white/60 bg-white/60 p-6 shadow-card backdrop-blur-xl">
            {resumeData ? (
              <div className="overflow-x-auto">
                <PageContainer
                  width={scaledCanvasWidth}
                  height={scaledCanvasHeight}
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
                    compactType={null}
                    preventCollision
                    draggableHandle=".rgl-drag-handle"
                    draggableCancel=".text-item-editor"
                    width={innerCanvasWidth}
                    autoSize={false}
                    style={{ height: "100%" }}
                    margin={[0, 0]}
                    containerPadding={[0, 0]}
                    maxRows={Math.floor(innerCanvasHeight / currentRowHeight)}
                    onLayoutChange={handleLayoutChange}
                    onDragStart={handleDragStart}
                    onDragStop={handleDragStop}
                    onResizeStart={handleResizeStart}
                    onResizeStop={handleResizeStop}
                  >
                    {resumeData.items.map((item) => {
                      const isSelected = selectedItemId === item.id;
                      const isOverlapped = overlapIds.has(item.id);
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
                        borderRadius: "0.75rem",
                        ...(item.style ?? {}),
                      };

                      const backgroundMeta = extractBackgroundStyle(item.style);
                      const resolvedBackgroundColor = applyOpacityToColor(
                        backgroundMeta.color,
                        backgroundMeta.opacity,
                      );
                      const hasCustomBackground = Boolean(backgroundMeta.color);
                      const borderColor = isOverlapped
                        ? "#ef4444"
                        : isSelected
                          ? "#a855f7"
                          : hasCustomBackground
                            ? "rgba(255,255,255,0.7)"
                            : "rgba(226, 232, 240, 0.9)";
                      const isSectionTitle = item.type === "section_title";
                      const isInteractive = isSelected || isOverlapped;
                      
                      const cellStyle: CSSProperties = {
                        padding: item.type === "image" ? "8px" : "12px",
                        // 仅当有自定义背景时才应用背景色，否则由 CSS 类控制（默认透明，hover/active 变白）
                        backgroundColor: isSectionTitle
                          ? "transparent"
                          : hasCustomBackground 
                            ? (resolvedBackgroundColor ?? undefined)
                            : undefined,
                        ["--cell-bg" as unknown as string]: isSectionTitle
                          ? "transparent"
                          : resolvedBackgroundColor ?? "rgba(255,255,255,0.92)",
                        borderColor,
                        borderStyle: hasCustomBackground ? "solid" : "dashed",
                        borderWidth: isInteractive ? 2 : 1,
                        borderRadius: "22px",
                        transition:
                          "border 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
                      };

                      return (
                        <div
                          key={item.id}
                          className={`group relative h-full w-full rounded-[22px] border text-sm text-zinc-900 shadow-sm transition-all hover-glass ${
                            item.type === "image" ? "overflow-hidden" : ""
                          } ${
                            isOverlapped
                              ? "ring-2 ring-red-400 active-glass"
                              : isSelected
                                ? "ring-2 ring-kawaii-purple/40 active-glass"
                                : ""
                          }`}
                          onMouseDownCapture={() => handleSelectItem(item.id)}
                          onFocus={() => handleSelectItem(item.id)}
                          tabIndex={0}
                          style={cellStyle}
                        >
                          {isOverlapped && (
                            <div className="absolute left-2 top-2 rounded bg-red-500/90 px-1.5 py-0.5 text-[10px] text-white shadow">
                              重叠
                            </div>
                          )}
                          <div className="rgl-drag-handle absolute -top-1.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-[6px] border border-zinc-300 bg-white/90 text-zinc-500 shadow-sm cursor-move">
                            <Move size={9} />
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

                          {item.type === "section_title" && (
                            <SectionTitleItem
                              html={item.content}
                              style={baseStyle}
                              onChange={(newHtml) =>
                                handleContentChange(item.id, newHtml)
                              }
                              accentColor={resumeData.layout_settings.accent_color}
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
                            item.type !== "image" &&
                            item.type !== "section_title" && (
                              <div className="text-xs text-red-500">
                                暂不支持的类型：{item.type}
                              </div>
                            )}
                        </div>
                      );
                    })}
                  </RGL>
                  <div 
                    className="print-mask" 
                    style={{ padding: `${layoutMarginPx}px` }}
                  />
                  {resumeData.layout_settings.enable_watermark && <Watermark />}
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

      <TemplatesPanel
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
        accessToken={accessToken}
        currentResumeData={resumeData}
        onApply={replaceResumeData}
      />
      <MyResumesPanel
        isOpen={isMyResumesOpen}
        onClose={() => setIsMyResumesOpen(false)}
        accessToken={accessToken}
        currentResumeData={resumeData}
        onResumeSelected={handlePanelResumeSelected}
        onResumeDeleted={handlePanelResumeDeleted}
      />
      <AssetsPanel
        isOpen={isAssetsOpen}
        onClose={() => setIsAssetsOpen(false)}
        accessToken={accessToken}
        onSelectAsset={handleSelectAssetFromPanel}
        onRequestUpload={handleRequestAssetUpload}
        isUploading={isUploadingAsset}
        refreshToken={assetPanelRefreshToken}
      />
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        layoutSettings={resumeData?.layout_settings}
        onSettingsChange={handleSettingsChange}
      />
    </div>
    </ActiveEditorProvider>
  );
}

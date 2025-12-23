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
import { useAlertModal } from "@/context/AlertModalContext";
import { useAuthFetch, friendlyMessageForStatus } from "@/hooks/useAuthFetch";
import { Move } from "lucide-react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import {
  DEFAULT_LAYOUT_SETTINGS,
  GRID_COLS,
  GRID_ROW_HEIGHT,
  normalizeResumeContent,
} from "@/utils/resume";
import { API_ROUTES } from "@/lib/api-routes";
import { ERROR_CODES, messageForErrorCode, titleForErrorCode } from "@/lib/error-codes";
import { applyOpacityToColor, extractBackgroundStyle } from "@/utils/color";
import {
  parseFontSizeValue,
  extractDividerThickness,
  extractDividerColor,
  parseScaleFromTransform,
  parsePositionPercent,
  parseBackgroundOpacity,
  deepCloneResumeData,
  simplifiedLayouts,
  isLayoutChanged,
  computeCenteredPosition,
  calcOverlapIds,
  DEFAULT_DIVIDER_THICKNESS,
  DEFAULT_BACKGROUND_OPACITY,
} from "@/utils/resumeItemUtils";
import type {
  LayoutSettings,
  ResumeData,
  ResumeItem,
  ResumeItemStyle,
} from "@/types/resume";

import { Watermark } from "@/components/Watermark";

type TaskStatus = "idle" | "pending" | "completed";
import { PDFGenerationOverlay } from "@/components/PDFGenerationOverlay";

const CANVAS_WIDTH = 794; // 必须与 pdf_template.go (794px) 匹配
const CANVAS_HEIGHT = Math.round((CANVAS_WIDTH * 297) / 210);

export default function Home() {
  const router = useRouter();
  const { accessToken, setAccessToken, isAuthenticated, isCheckingAuth } = useAuth();
  const authFetch = useAuthFetch();
  const { showAlert } = useAlertModal();
  const [title, setTitle] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [savedResumeId, setSavedResumeId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingResume, setIsFetchingResume] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
  const [readyResumeId, setReadyResumeId] = useState<number | null>(null);
  const [downloadDeadline, setDownloadDeadline] = useState<number | null>(null);
  const [downloadCountdown, setDownloadCountdown] = useState<number>(0);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [downloadUid, setDownloadUid] = useState<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const generationCorrelationIdRef = useRef<string | null>(null);
  const savedResumeIdRef = useRef<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isMyResumesOpen, setIsMyResumesOpen] = useState(false);
  const [isAssetsOpen, setIsAssetsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [assetPanelRefreshToken, setAssetPanelRefreshToken] = useState(0);
  const [zoom, setZoom] = useState(1);
  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const previewWindowRef = useRef<Window | null>(null);
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
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  useEffect(() => {
    savedResumeIdRef.current = savedResumeId;
  }, [savedResumeId]);

  const resetPdfGenerationState = useCallback(() => {
    generationCorrelationIdRef.current = null;
    setReadyResumeId(null);
    setDownloadDeadline(null);
    setDownloadCountdown(0);
    setDownloadToken(null);
    setDownloadUid(null);
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setTaskStatus("idle");
  }, []);

  const resetDownloadLinkState = useCallback(() => {
    setDownloadDeadline(null);
    setDownloadCountdown(0);
    setDownloadToken(null);
    setDownloadUid(null);
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const startDownloadCountdown = useCallback(
    (ttlSeconds: number) => {
      const ttl = Math.max(0, Math.floor(ttlSeconds));
      const now = Date.now();
      setDownloadDeadline(ttl > 0 ? now + ttl * 1000 : null);
      setDownloadCountdown(ttl);
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
      }
      if (ttl <= 0) {
        countdownTimerRef.current = null;
        return;
      }
      countdownTimerRef.current = window.setInterval(() => {
        setDownloadCountdown((prev) => {
          const next = Math.max(0, prev - 1);
          if (next === 0 && countdownTimerRef.current) {
            window.clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          return next;
        });
      }, 1000);
    },
    [],
  );

  useEffect(() => {
    if (taskStatus === "pending") {
      setIsOverlayVisible(true);
      setGenerationProgress(0);
      progressTimerRef.current = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 80) return prev;
          return prev + 5;
        });
      }, 1000);
    } else if (taskStatus === "completed") {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setGenerationProgress(100);
      // 延迟隐藏遮罩层，让用户看到完成动画
      const hideTimer = setTimeout(() => {
        setIsOverlayVisible(false);
      }, 2000); // 0.5s buffer + 1.5s success show
      return () => clearTimeout(hideTimer);
    } else {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setGenerationProgress(0);
      setIsOverlayVisible(false);
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, [taskStatus]);

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

  const requestDownloadLink = useCallback(
    async (resumeId: number, forceDownload = false) => {
      if (!isAuthenticated) {
        setError("请先登录");
        resetDownloadLinkState();
        return;
      }

      setError(null);

      try {
        const url = new URL(API_ROUTES.RESUME.downloadLink(resumeId), window.location.origin);
        if (forceDownload) {
          url.searchParams.set("download", "1");
          const fname = `Resume-${resumeId}.pdf`;
          url.searchParams.set("filename", fname);
        }
        const response = await authFetch(url.toString());

        if (!response.ok) {
          throw new Error(`failed to request download link: ${response.status}`);
        }

        const data = await response.json();
        const token = typeof data?.token === "string" ? data.token : null;
        const uid = typeof data?.uid === "number" ? data.uid : null;
        const expiresIn = typeof data?.expires_in === "number" ? data.expires_in : null;
        if (!token || typeof uid !== "number" || !expiresIn) {
          throw new Error("invalid download token response");
        }
        setDownloadToken(token);
        setDownloadUid(uid);
        startDownloadCountdown(expiresIn);
      } catch (err) {
        console.error("获取下载链接失败", err);
        resetDownloadLinkState();
        setError("获取下载链接失败，请稍后重试");
      }
    },
    [isAuthenticated, authFetch, resetDownloadLinkState, startDownloadCountdown],
  );

  const handleRequestDownloadLink = useCallback(async () => {
    if (!readyResumeId) return;
    await requestDownloadLink(readyResumeId, true);
  }, [readyResumeId, requestDownloadLink]);

  const handleDownloadFile = useCallback(() => {
    if (!readyResumeId) return;
    if (!downloadToken || !downloadUid || downloadCountdown <= 0) {
      setError("下载链接已过期，请重新获取");
      return;
    }

    const fname = `Resume-${readyResumeId}.pdf`;
    const url = API_ROUTES.RESUME.downloadFile(readyResumeId, {
      uid: downloadUid,
      token: downloadToken,
      download: "1",
      filename: fname,
    });

    // 立即在前端失效，避免重复点击（真正的一次性校验在后端）
    resetDownloadLinkState();

    try {
      const win = window.open(url, "_blank");
      if (!win) {
        window.location.href = url;
      }
    } catch {
      window.location.href = url;
    }
  }, [downloadCountdown, downloadToken, downloadUid, readyResumeId, resetDownloadLinkState]);

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

    const connect = () => {
      const ws = new WebSocket(wsURL);
      socketRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        ws.send(JSON.stringify({ type: "auth", token: accessToken }));
        console.log("WebSocket connected and authenticated.");
        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        heartbeatTimerRef.current = window.setInterval(() => {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {}
        }, 45000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const status = typeof data?.status === "string" ? data.status : null;
          const resumeId = typeof data?.resume_id === "number" ? data.resume_id : null;
          const correlationId =
            typeof data?.correlation_id === "string" ? data.correlation_id : null;
          const errorCode =
            typeof data?.error_code === "number" ? data.error_code : null;
          const errorMessage =
            typeof data?.error_message === "string" ? data.error_message : "";
          const missingKeys = Array.isArray(data?.missing_keys)
            ? data.missing_keys.filter((v: unknown): v is string => typeof v === "string")
            : [];

          if (!status || typeof resumeId !== "number") {
            return;
          }

          const expectedCorrelationId = generationCorrelationIdRef.current;
          if (expectedCorrelationId) {
            if (!correlationId || correlationId !== expectedCorrelationId) {
              return;
            }
          }

          const currentResumeId = savedResumeIdRef.current;
          if (typeof currentResumeId === "number" && currentResumeId > 0) {
            if (resumeId !== currentResumeId) {
              return;
            }
          }

          if (status === "error") {
            resetPdfGenerationState();
            showAlert({
              title: titleForErrorCode(errorCode ?? ERROR_CODES.SYSTEM_ERROR),
              message: messageForErrorCode(
                errorCode ?? ERROR_CODES.SYSTEM_ERROR,
                errorMessage,
              ),
            });
            return;
          }

          if (status === "completed") {
            setTaskStatus("completed");
            setReadyResumeId(resumeId);
            resetDownloadLinkState();
            void requestDownloadLink(resumeId, true);

            if (errorCode === ERROR_CODES.RESOURCE_MISSING) {
              window.setTimeout(() => {
                showAlert({
                  title: titleForErrorCode(ERROR_CODES.RESOURCE_MISSING),
                  message:
                    missingKeys.length > 0
                      ? `${messageForErrorCode(ERROR_CODES.RESOURCE_MISSING)}（缺失数量：${missingKeys.length}）`
                      : messageForErrorCode(ERROR_CODES.RESOURCE_MISSING),
                });
              }, 2200);
            }

            generationCorrelationIdRef.current = null;
          }
        } catch (parseError) {
          console.error("Invalid WebSocket payload:", parseError);
        }
      };

      const scheduleReconnect = () => {
        socketRef.current = null;
        if (heartbeatTimerRef.current) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        const attempt = Math.min(reconnectAttemptsRef.current + 1, 8);
        reconnectAttemptsRef.current = attempt;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          if (isAuthenticated && accessToken) {
            connect();
          }
        }, delay);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected.");
        scheduleReconnect();
      };

      ws.onerror = () => {
        console.warn("WebSocket error, closing connection.");
        try { ws.close(); } catch {}
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      if (socketRef.current) {
        try { socketRef.current.close(); } catch {}
        socketRef.current = null;
      }
    };
  }, [
    isAuthenticated,
    accessToken,
    requestDownloadLink,
    resetDownloadLinkState,
    resolveWebSocketURL,
    resetPdfGenerationState,
    showAlert,
  ]);

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
    generationCorrelationIdRef.current = null;
    setReadyResumeId(null);
    resetDownloadLinkState();
    setTaskStatus("pending");
    // 不再预开标签，改为等待生成完成后由用户点击下载

    // 不再主动轮询，等待 WebSocket 完成消息后再打开最新 PDF

    try {
      const response = await authFetch(
        API_ROUTES.RESUME.download(savedResumeId),
      );

      if (!response.ok) {
        const msg = friendlyMessageForStatus(response.status, "pdf");
        if (response.status === 429) {
          setRateLimitMessage(msg);
          setRateLimitError("下载失败");
          setIsRateLimitModalOpen(true);
          setError(null);
        } else {
          setError(msg);
        }
        throw new Error("下载失败");
      }

      // 生成任务已提交，待 WebSocket 完成后展示下载按钮
      try {
        const data = await response.json();
        const correlationId =
          typeof data?.correlation_id === "string" ? data.correlation_id : null;
        if (correlationId) {
          generationCorrelationIdRef.current = correlationId;
        } else {
          const headerId = response.headers.get("X-Correlation-ID");
          generationCorrelationIdRef.current = headerId ? headerId : null;
        }
      } catch {
        const headerId = response.headers.get("X-Correlation-ID");
        generationCorrelationIdRef.current = headerId ? headerId : null;
      }
    } catch (err) {
      console.error("生成任务提交失败", err);
      if (!isRateLimitModalOpen) {
        setError((prev) => prev ?? "生成任务提交失败，请稍后重试");
      }
      resetPdfGenerationState();
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
            const nextStyle: ResumeItemStyle = {
              ...(item.style ?? {}),
            };
            delete (nextStyle as unknown as Record<string, unknown>)["borderColor"];
            delete (nextStyle as unknown as Record<string, unknown>)["color"];
            nextStyle.borderTop = `${nextThickness}px solid ${safeColor}`;
            return {
              ...item,
              style: nextStyle,
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
            if (item.type === "section_title") {
              const accent =
                prev.layout_settings?.accent_color ?? DEFAULT_LAYOUT_SETTINGS.accent_color;
              nextStyle.backgroundColor = "transparent";
              delete nextStyle.backgroundOpacity;
              const currentTextColor = (nextStyle.color ?? "").toString().toLowerCase();
              const isWhite =
                currentTextColor === "#ffffff" ||
                currentTextColor === "white" ||
                currentTextColor.includes("rgb(255, 255, 255");
              if (!currentTextColor || isWhite) {
                nextStyle.color = accent;
              }
              if (!nextStyle.borderColor) {
                nextStyle.borderColor = accent;
              }
              return {
                ...item,
                style: nextStyle,
              };
            }
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
          const nextStyle: ResumeItemStyle = {
            ...(item.style ?? {}),
          };
          delete (nextStyle as unknown as Record<string, unknown>)["borderColor"];
          delete (nextStyle as unknown as Record<string, unknown>)["color"];
          nextStyle.borderTop = `${clamped}px solid ${currentColor}`;
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
          if (process.env.NODE_ENV !== "production") {
            console.error("图片上传失败", {
              status: response.status,
            });
          }
          if (response.status === 403) {
            showAlert({
              title: "上传上限",
              message: `您已达到最大上传数量限制（${4}张），请一段时间后再尝试上传`,
            });
            setError(null);
            throw new Error("asset limit reached");
          }
          setError(friendlyMessageForStatus(response.status, "upload"));
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
        if (process.env.NODE_ENV !== "production") {
          console.error("图片上传失败", err);
        }
        if (String((err as Error | undefined)?.message ?? "") !== "asset limit reached") {
          setError((prev) => prev ?? "图片上传失败，请重试");
        }
      } finally {
        setIsUploadingAsset(false);
        event.target.value = "";
      }
    },
    [authFetch, isAuthenticated, appendImageItem, showAlert],
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
  const simplifiedLayoutsMemo = useCallback((data: ResumeData | null) => {
    return simplifiedLayouts(data);
  }, []);
  const isLayoutChangedMemo = useCallback(
    (a: ResumeData | null, b: ResumeData | null) => {
      return isLayoutChanged(a, b);
    },
    [],
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
    if (start && curr && isLayoutChangedMemo(start, curr)) {
      setHistoryStack((hs) => [...hs, deepCloneResumeData(start)]);
      setRedoStack([]);
    }
  }, [isLayoutChangedMemo]);
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
    if (start && curr && isLayoutChangedMemo(start, curr)) {
      setHistoryStack((hs) => [...hs, deepCloneResumeData(start)]);
      setRedoStack([]);
    }
  }, [isLayoutChangedMemo]);

  return (
    <ActiveEditorProvider>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
        
        <PDFGenerationOverlay isVisible={isOverlayVisible} progress={generationProgress} />

        <Modal isOpen={isRateLimitModalOpen} onOpenChange={setIsRateLimitModalOpen}>
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>生成次数上限</ModalHeader>
                <ModalBody>
                  <div className="space-y-2">
                    <div className="text-sm text-kawaii-text">{rateLimitMessage ?? "生成过于频繁，请稍后再试"}</div>
                    <div className="text-xs text-slate-500">错误类型：Console Error</div>
                    <div className="text-xs text-slate-500">错误信息：{rateLimitError ?? "下载失败"}</div>
                    <div className="text-xs text-slate-500">错误位置：handleDownload (app/page.tsx:664:15)</div>
                    <div className="text-xs text-slate-500">Next.js 版本：16.0.1 (Turbopack)</div>
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button color="primary" onPress={onClose}>知道了</Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

      {isFetchingResume && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          正在加载最新简历...
        </div>
      )}

      

      <div className="relative">
        <div className="fixed left-6 inset-y-0 z-40 flex items-center">
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
              onRequestDownloadLink={handleRequestDownloadLink}
              onDownloadFile={handleDownloadFile}
              savedResumeId={savedResumeId}
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
              taskStatus={taskStatus}
              downloadCountdown={downloadCountdown}
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

                      const { borderColor: _dc, color: _dcolor, ...restDividerStyle } =
                        (item.style ?? {}) as Record<string, unknown>;
                      const dividerStyle = {
                        ...(restDividerStyle as ResumeItemStyle),
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

      

      

      

      {error && !isRateLimitModalOpen && (
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

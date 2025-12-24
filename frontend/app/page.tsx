"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import RGL, { type Layout } from "react-grid-layout";
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
import { useItemStyleEditor } from "@/hooks/useItemStyleEditor";
import { useResumeActions } from "@/hooks/useResumeActions";
import { useResumeEditor } from "@/hooks/useResumeEditor";
import { Move } from "lucide-react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import {
  DEFAULT_LAYOUT_SETTINGS,
  GRID_COLS,
  GRID_ROW_HEIGHT,
} from "@/utils/resume";
import {
  DEFAULT_CELL_PADDING_PX,
  DEFAULT_CELL_RADIUS_PX,
  IMAGE_CELL_PADDING_PX,
} from "@/utils/editorStyles";
import { API_ROUTES } from "@/lib/api-routes";
import { ERROR_CODES, messageForErrorCode, titleForErrorCode } from "@/lib/error-codes";
import { applyOpacityToColor, extractBackgroundStyle } from "@/utils/color";
import {
  calcOverlapIds,
} from "@/utils/resumeItemUtils";
import type { LayoutSettings, ResumeItemStyle } from "@/types/resume";

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
  const [error, setError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
  const [readyResumeId, setReadyResumeId] = useState<number | null>(null);
  const [downloadDeadline, setDownloadDeadline] = useState<number | null>(null);
  const [downloadCountdown, setDownloadCountdown] = useState<number>(0);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [downloadUid, setDownloadUid] = useState<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const generationCorrelationIdRef = useRef<string | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const editor = useResumeEditor();
  const actions = useResumeActions({
    isAuthenticated,
    authFetch,
    resumeData: editor.resumeData,
    resumeDataRef: editor.resumeDataRef,
    withHistory: editor.withHistory,
    resetEditorState: editor.resetEditorState,
    setSelectedItemId: editor.setSelectedItemId,
    setError,
    showAlert,
    onResumeApplied: () => setTaskStatus("idle"),
    onAssetUploaded: () => setAssetPanelRefreshToken((token) => token + 1),
  });
  const styleEditor = useItemStyleEditor({
    selectedItemId: editor.selectedItemId,
    resumeData: editor.resumeData,
    withHistory: editor.withHistory,
  });
  const {
    resumeData,
    historyStack,
    redoStack,
    selectedItemId,
    withHistory,
    handleUndo,
    handleRedo,
    handleDeleteItem,
    replaceResumeData,
    handleLayoutChange,
    handleContentChange,
    handleDragStart,
    handleDragStop,
    handleResizeStart,
    handleResizeStop,
  } = editor;
  const {
    title,
    setTitle,
    savedResumeId,
    savedResumeIdRef,
    isFetchingResume,
    isUploadingAsset,
    fetchLatestResume,
    handleSave,
    handleAddText,
    handleAddSectionTitle,
    handleAddDivider,
    handleAddImageClick,
    handleImageUpload,
    handleSelectAssetFromPanel,
    handleSelectItem,
    handlePanelResumeSelected,
    handlePanelResumeDeleted,
    saveResume,
  } = actions;
  const {
    selectedItem,
    selectedItemFontSize,
    selectedItemColor,
    selectedItemLineHeight,
    selectedItemFontFamily,
    selectedDividerThickness,
    selectedImageScalePercent,
    selectedImageFocus,
    selectedItemBackgroundColor,
    selectedItemBackgroundOpacity,
    selectedBorderRadius,
    handleItemFontSizeChange,
    handleItemColorChange,
    handleItemLineHeightChange,
    handleItemBackgroundColorChange,
    handleItemBackgroundOpacityChange,
    handleDividerThicknessChange,
    handleItemFontFamilyChange,
    handleBorderRadiusChange,
    handleImageZoomChange,
    handleImageFocusChange,
    handleImageZoomReset,
  } = styleEditor;

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

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      fetchLatestResume();
    }
  }, [isAuthenticated, isCheckingAuth, fetchLatestResume]);

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

  const handleSettingsChange = useCallback(
    (newSettings: LayoutSettings) => {
      withHistory((prev) => ({ ...prev, layout_settings: newSettings }));
    },
    [withHistory],
  );

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
  const overlapIds = useMemo(() => {
    if (!resumeData) return new Set<string>();
    return calcOverlapIds(resumeData.items);
  }, [resumeData]);

  const handleAddImagePanelToggle = useCallback(() => {
    if (!handleAddImageClick()) return;
    setIsAssetsOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsTemplatesOpen(false);
        setIsMyResumesOpen(false);
        setIsSettingsOpen(false);
      }
      return next;
    });
  }, [
    handleAddImageClick,
    setIsAssetsOpen,
    setIsTemplatesOpen,
    setIsMyResumesOpen,
    setIsSettingsOpen,
  ]);

  const handleRequestAssetUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleSelectAssetAndClose = useCallback(
    (objectKey: string) => {
      if (!handleSelectAssetFromPanel(objectKey)) {
        return;
      }
      setIsAssetsOpen(false);
    },
    [handleSelectAssetFromPanel, setIsAssetsOpen],
  );

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
            onAddImage={handleAddImagePanelToggle}
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
              editor.setResumeData({
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
              onSelectedItemLineHeightChange={handleItemLineHeightChange}
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
                        padding:
                          item.type === "image"
                            ? `${IMAGE_CELL_PADDING_PX}px`
                            : `${DEFAULT_CELL_PADDING_PX}px`,
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
                        borderRadius: `${DEFAULT_CELL_RADIUS_PX}px`,
                        transition:
                          "border 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
                      };

                      return (
                        <div
                          key={item.id}
                          className={`group relative h-full w-full border text-sm text-zinc-900 shadow-sm transition-all hover-glass ${
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
                              style={item.style as CSSProperties}
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
        onSelectAsset={handleSelectAssetAndClose}
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

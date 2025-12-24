"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Layout } from "react-grid-layout";
import Inspector from "@/components/Inspector";
import Dock from "@/components/Dock";
import { TemplatesPanel } from "@/components/TemplatesPanel";
import { MyResumesPanel } from "@/components/MyResumesPanel";
import { AssetsPanel } from "@/components/AssetsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import ResumeCanvas from "@/components/ResumeCanvas";
import { RateLimitModal } from "@/components/RateLimitModal";
import { PDFGenerationOverlay } from "@/components/PDFGenerationOverlay";
import { useAuth } from "@/context/AuthContext";
import { ActiveEditorProvider } from "@/context/ActiveEditorContext";
import { useAlertModal } from "@/context/AlertModalContext";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { useItemStyleEditor } from "@/hooks/useItemStyleEditor";
import { usePdfDownload } from "@/hooks/usePdfDownload";
import { useResumeActions } from "@/hooks/useResumeActions";
import { useResumeEditor } from "@/hooks/useResumeEditor";
import { useWebSocketConnection } from "@/hooks/useWebSocketConnection";
import {
  DEFAULT_LAYOUT_SETTINGS,
  GRID_COLS,
  GRID_ROW_HEIGHT,
} from "@/utils/resume";
import { API_ROUTES } from "@/lib/api-routes";
import {
  calcOverlapIds,
} from "@/utils/resumeItemUtils";
import type { LayoutSettings } from "@/types/resume";

const CANVAS_WIDTH = 794; // 必须与 pdf_template.go (794px) 匹配
const CANVAS_HEIGHT = Math.round((CANVAS_WIDTH * 297) / 210);

type PanelKey = "templates" | "myResumes" | "assets" | "settings";

export default function Home() {
  const router = useRouter();
  const { accessToken, setAccessToken, isAuthenticated, isCheckingAuth } = useAuth();
  const authFetch = useAuthFetch();
  const { showAlert } = useAlertModal();
  const [error, setError] = useState<string | null>(null);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isMyResumesOpen, setIsMyResumesOpen] = useState(false);
  const [isAssetsOpen, setIsAssetsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [assetPanelRefreshToken, setAssetPanelRefreshToken] = useState(0);
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfResetRef = useRef<(() => void) | null>(null);

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
    onResumeApplied: () => {
      pdfResetRef.current?.();
    },
    onAssetUploaded: () => setAssetPanelRefreshToken((token) => token + 1),
  });
  const pdf = usePdfDownload({
    savedResumeId: actions.savedResumeId,
    savedResumeIdRef: actions.savedResumeIdRef,
    isAuthenticated,
    authFetch,
    showAlert,
    setError,
  });
  useEffect(() => {
    pdfResetRef.current = pdf.resetPdfGenerationState;
  }, [pdf.resetPdfGenerationState]);
  const styleEditor = useItemStyleEditor({
    selectedItemId: editor.selectedItemId,
    resumeData: editor.resumeData,
    withHistory: editor.withHistory,
  });
  const resolveWebSocketURL = useCallback(() => {
    return API_ROUTES.resolveWsUrl();
  }, []);
  useWebSocketConnection({
    isAuthenticated,
    accessToken,
    resolveWebSocketURL,
    onMessage: pdf.handleWebSocketMessage,
    onError: (err) => {
      console.warn("WebSocket error", err);
    },
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

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated === false) {
      router.push("/login");
    }
  }, [isAuthenticated, isCheckingAuth, router]);

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      fetchLatestResume();
    }
  }, [isAuthenticated, isCheckingAuth, fetchLatestResume]);


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

  const togglePanel = useCallback((panel: PanelKey) => {
    setIsTemplatesOpen((prev) => (panel === "templates" ? !prev : false));
    setIsMyResumesOpen((prev) => (panel === "myResumes" ? !prev : false));
    setIsAssetsOpen((prev) => (panel === "assets" ? !prev : false));
    setIsSettingsOpen((prev) => (panel === "settings" ? !prev : false));
  }, []);

  const handleAddImagePanelToggle = useCallback(() => {
    if (!handleAddImageClick()) return;
    togglePanel("assets");
  }, [handleAddImageClick, togglePanel]);

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
        <PDFGenerationOverlay
          isVisible={pdf.isOverlayVisible}
          progress={pdf.generationProgress}
        />

        <RateLimitModal
          isOpen={pdf.isRateLimitModalOpen}
          onOpenChange={pdf.setIsRateLimitModalOpen}
          message={pdf.rateLimitMessage}
          error={pdf.rateLimitError}
        />

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
              onOpenTemplates={() => togglePanel("templates")}
              onOpenMyResumes={() => togglePanel("myResumes")}
              onOpenSettings={() => togglePanel("settings")}
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

          <div className="fixed right-6 top-1/2 -translate-y-1/2 z-40 w-80">
            {resumeData && (
              <Inspector
              title={title}
              onUpdateTitle={setTitle}
              onSave={handleSave}
              onDownload={pdf.handleDownload}
              onRequestDownloadLink={pdf.handleRequestDownloadLink}
              onDownloadFile={pdf.handleDownloadFile}
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
              taskStatus={pdf.taskStatus}
              downloadCountdown={pdf.downloadCountdown}
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
              <ResumeCanvas
                resumeData={resumeData}
                selectedItemId={selectedItemId}
                layout={layout}
                currentColumns={currentColumns}
                currentRowHeight={currentRowHeight}
                scaledCanvasWidth={scaledCanvasWidth}
                scaledCanvasHeight={scaledCanvasHeight}
                innerCanvasWidth={innerCanvasWidth}
                innerCanvasHeight={innerCanvasHeight}
                layoutMarginPx={layoutMarginPx}
                overlapIds={overlapIds}
                onLayoutChange={handleLayoutChange}
                onDragStart={handleDragStart}
                onDragStop={handleDragStop}
                onResizeStart={handleResizeStart}
                onResizeStop={handleResizeStop}
                onSelectItem={handleSelectItem}
                onContentChange={handleContentChange}
              />
            ) : (
              <div className="py-10 text-center text-sm text-zinc-500">
                {isFetchingResume ? "正在加载布局..." : "暂无简历布局数据"}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && !pdf.isRateLimitModalOpen && (
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

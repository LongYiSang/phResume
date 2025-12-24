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
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { useItemStyleEditor } from "@/hooks/useItemStyleEditor";
import { usePdfDownload } from "@/hooks/usePdfDownload";
import { useResumeActions } from "@/hooks/useResumeActions";
import { useResumeEditor } from "@/hooks/useResumeEditor";
import { useWebSocketConnection } from "@/hooks/useWebSocketConnection";
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
import { applyOpacityToColor, extractBackgroundStyle } from "@/utils/color";
import {
  calcOverlapIds,
} from "@/utils/resumeItemUtils";
import type { LayoutSettings, ResumeItemStyle } from "@/types/resume";

import { Watermark } from "@/components/Watermark";

import { PDFGenerationOverlay } from "@/components/PDFGenerationOverlay";

const CANVAS_WIDTH = 794; // 必须与 pdf_template.go (794px) 匹配
const CANVAS_HEIGHT = Math.round((CANVAS_WIDTH * 297) / 210);

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
        
        <PDFGenerationOverlay
          isVisible={pdf.isOverlayVisible}
          progress={pdf.generationProgress}
        />

        <Modal
          isOpen={pdf.isRateLimitModalOpen}
          onOpenChange={pdf.setIsRateLimitModalOpen}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>生成次数上限</ModalHeader>
                <ModalBody>
                  <div className="space-y-2">
                    <div className="text-sm text-kawaii-text">
                      {pdf.rateLimitMessage ?? "生成过于频繁，请稍后再试"}
                    </div>
                    <div className="text-xs text-slate-500">错误类型：Console Error</div>
                    <div className="text-xs text-slate-500">
                      错误信息：{pdf.rateLimitError ?? "下载失败"}
                    </div>
                    <div className="text-xs text-slate-500">错误位置：handleDownload (hooks/usePdfDownload.ts)</div>
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

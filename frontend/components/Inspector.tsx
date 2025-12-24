"use client";

import { useActiveEditor } from "@/context/ActiveEditorContext";
import { Button } from "@heroui/react";
import { Redo2, Undo2, Download, ZoomIn, ZoomOut, Trash2 } from "lucide-react";
import { 
  ElementFormatType,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  type TextFormatType,
} from "lexical";
import { StylePanel } from "@/components/StylePanel";
import type { LayoutSettings } from "@/types/resume";
import { toggleListCommand } from "@/utils/lexical";

type InspectorProps = {
  title: string;
  onUpdateTitle: (t: string) => void;
  onSave: () => void;
  onDownload: () => void;
  onRequestDownloadLink?: () => void;
  onDownloadFile?: () => void;
  savedResumeId?: number | null;
  historyCanUndo: boolean;
  historyCanRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  styleSettings: LayoutSettings;
  onStyleSettingsChange: (s: LayoutSettings) => void;
  selectedItemType: string | null;
  selectedItemFontSize: number | null;
  onSelectedItemFontSizeChange: (v: number) => void;
  selectedItemLineHeight?: number | null;
  onSelectedItemLineHeightChange?: (v: number) => void;
  selectedItemColor: string | null;
  onSelectedItemColorChange: (v: string) => void;
  selectedItemFontFamily?: string | null;
  selectedItemContent?: string | null;
  selectedItemBackgroundColor?: string | null;
  selectedItemBackgroundOpacity?: number | null;
  selectedDividerThickness?: number | null;
  selectedImageScalePercent?: number | null;
  selectedImageFocus?: { x: number; y: number } | null;
  onSelectedItemFontFamilyChange?: (family: string) => void;
  onBackgroundColorChange?: (value: string | null) => void;
  onBackgroundOpacityChange?: (value: number) => void;
  onDividerThicknessChange?: (px: number) => void;
  onDeleteSelected?: () => void;
  onFormatText?: (type: "bold" | "italic" | "underline") => void;
  onAlignElement?: (format: ElementFormatType) => void;
  onListToggle?: (type: "bullet" | "number") => void;
  onImageZoomChange?: (scale: number) => void;
  onImageFocusChange?: (xPercent: number, yPercent: number) => void;
  onImageZoomReset?: () => void;
  selectedBorderRadius?: number | null;
  onBorderRadiusChange?: (value: number) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
};

function HeaderButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center rounded-xl w-10 h-10 text-kawaii-text hover:bg-white hover:shadow-sm disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export default function Inspector({ title, onUpdateTitle, onSave, onDownload, historyCanUndo, historyCanRedo, onUndo, onRedo, styleSettings, onStyleSettingsChange, selectedItemType, selectedItemFontSize, onSelectedItemFontSizeChange, selectedItemLineHeight, onSelectedItemLineHeightChange, selectedItemColor, onSelectedItemColorChange, selectedItemFontFamily, selectedItemContent, selectedItemBackgroundColor, selectedItemBackgroundOpacity, selectedDividerThickness, selectedImageScalePercent, selectedImageFocus, selectedBorderRadius, onBorderRadiusChange, onSelectedItemFontFamilyChange, onBackgroundColorChange, onBackgroundOpacityChange, onDividerThicknessChange, onDeleteSelected, onImageZoomChange, onImageFocusChange,
  onImageZoomReset,
  zoom,
  setZoom,
  taskStatus,
  downloadCountdown,
  savedResumeId,
  onRequestDownloadLink,
  onDownloadFile,
}: InspectorProps & {
  taskStatus?: "idle" | "pending" | "completed";
  downloadCountdown?: number;
}) {
  const { activeEditor } = useActiveEditor();

  const renderDownloadButton = () => {
    const canDownload =
      taskStatus === "completed" && typeof downloadCountdown === "number" && downloadCountdown > 0;
    const canRequestLink = taskStatus === "completed" && !canDownload;

    return (
      <Button
        variant={canDownload ? "solid" : "bordered"}
        color={canDownload ? "success" : "default"}
        className={`rounded-2xl transition-all duration-500 ${
          canDownload
            ? "bg-kawaii-mint text-white border-transparent shadow-md hover:shadow-lg opacity-100"
            : "opacity-100" // 淡入淡出通过 key 切换时的 transition 处理
        }`}
        onPress={() => {
          if (canDownload) {
            onDownloadFile?.();
            return;
          }
          if (canRequestLink) {
            onRequestDownloadLink?.();
            return;
          }
          if (taskStatus !== "pending") {
            onDownload();
          }
        }}
        disabled={taskStatus === "pending"}
        startContent={<Download size={18} />}
        key={canDownload ? "download-btn" : canRequestLink ? "refresh-link-btn" : "generate-btn"}
      >
        <div className="flex flex-col items-center leading-tight">
          <span className="animate-fadeIn">
            {taskStatus === "pending"
              ? "生成中..."
              : canDownload
              ? "下载 PDF"
              : canRequestLink
              ? "重新获取链接"
              : "生成 PDF"}
          </span>
          {canDownload && downloadCountdown && (
            <span className="text-[10px] opacity-90 animate-fadeIn">
              {Math.floor(downloadCountdown / 60)}:
              {(downloadCountdown % 60).toString().padStart(2, "0")} 后过期
            </span>
          )}
          {canRequestLink && (
            <span className="text-[10px] opacity-70 animate-fadeIn">链接已过期或已使用</span>
          )}
        </div>
      </Button>
    );
  };

  return (
    <div
      className="bg-white/80 backdrop-blur-xl border border-white/50 rounded-[32px] shadow-soft h-full max-h-[90vh] flex flex-col overflow-hidden hover:shadow-card"
      data-top-toolbar="true"
    >
      <div className="p-5 border-b border-kawaii-pinkLight space-y-4 bg-white/40">
        <div className="relative">
          <input
            value={title}
            onChange={(e) => onUpdateTitle(e.target.value)}
            placeholder="请输入简历标题"
            className="w-full bg-white/50 border-2 border-transparent hover:border-kawaii-pinkLight focus:border-kawaii-pink rounded-2xl px-4 py-2.5 text-kawaii-text font-display font-bold text-lg text-center focus:outline-none focus:bg-white transition-all"
          />
          {typeof savedResumeId === "number" && (
            <div className="mt-2 text-xs text-kawaii-text/70 text-center">
              已保存的简历 ID：{savedResumeId}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between bg-kawaii-pinkLight/30 p-1.5 rounded-2xl">
          <div className="flex gap-1">
            <HeaderButton onClick={onUndo} disabled={!historyCanUndo}><Undo2 size={18} /></HeaderButton>
            <HeaderButton onClick={onRedo} disabled={!historyCanRedo}><Redo2 size={18} /></HeaderButton>
          </div>
          <div className="flex items-center gap-1">
            <HeaderButton onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}><ZoomOut size={16} /></HeaderButton>
            <span className="text-xs font-bold w-10 text-center text-kawaii-text/70">{Math.round(zoom * 100)}%</span>
            <HeaderButton onClick={() => setZoom((z) => Math.min(2, z + 0.1))}><ZoomIn size={16} /></HeaderButton>
          </div>
        </div>
        {selectedItemType && (
          <div className="flex items-center justify-between">
            <span className="px-3 py-1 rounded-full bg-kawaii-purpleLight text-kawaii-purple text-xs font-bold">
              {selectedItemType === "text" ? "Text Box" : selectedItemType === "divider" ? "Divider" : selectedItemType}
            </span>
            <HeaderButton onClick={() => onDeleteSelected?.()}><Trash2 size={16} className="text-red-500" /></HeaderButton>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-8 scrollbar-kawaii">
        <StylePanel
          settings={styleSettings}
          onSettingsChange={onStyleSettingsChange}
          selectedItemType={selectedItemType}
          selectedItemFontSize={selectedItemFontSize}
          onSelectedItemFontSizeChange={onSelectedItemFontSizeChange}
          selectedItemLineHeight={selectedItemLineHeight}
          onSelectedItemLineHeightChange={onSelectedItemLineHeightChange}
          selectedItemColor={selectedItemColor}
          onSelectedItemColorChange={onSelectedItemColorChange}
          selectedItemFontFamily={selectedItemFontFamily}
          selectedItemBackgroundColor={selectedItemBackgroundColor}
          selectedItemBackgroundOpacity={selectedItemBackgroundOpacity}
          selectedItemContent={selectedItemContent}
          selectedDividerThickness={selectedDividerThickness}
          selectedImageScalePercent={selectedImageScalePercent}
          selectedImageFocus={selectedImageFocus}
          onSelectedItemFontFamilyChange={onSelectedItemFontFamilyChange}
          onBackgroundColorChange={onBackgroundColorChange}
          onBackgroundOpacityChange={onBackgroundOpacityChange}
          onDividerThicknessChange={onDividerThicknessChange}
          onFormatText={(t) => {
            if (!activeEditor) return;
            activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, t as TextFormatType);
            activeEditor.focus();
          }}
          onAlignElement={(f) => {
            if (!activeEditor) return;
            activeEditor.dispatchCommand(FORMAT_ELEMENT_COMMAND, f as ElementFormatType);
            activeEditor.focus();
          }}
          onListToggle={(type) => {
            if (!activeEditor) return;
            toggleListCommand(activeEditor, type as "bullet" | "number");
          }}
          onImageZoomChange={onImageZoomChange}
          onImageFocusChange={onImageFocusChange}
          onImageZoomReset={onImageZoomReset}
          selectedBorderRadius={selectedBorderRadius}
          onBorderRadiusChange={onBorderRadiusChange}
        />
      </div>

      <div className="p-5 bg-white/40 border-t border-kawaii-pinkLight flex gap-2">
        <Button color="primary" className="rounded-2xl font-bold shadow-pop" onPress={onSave}>保存简历</Button>
        {renderDownloadButton()}
      </div>
    </div>
  );
}

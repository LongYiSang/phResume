import { Button, Slider } from "@heroui/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LayoutSettings } from "@/types/resume";

type SettingsPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  layoutSettings?: LayoutSettings;
  onSettingsChange: (settings: LayoutSettings) => void;
};

export function SettingsPanel({
  isOpen,
  onClose,
  layoutSettings,
  onSettingsChange,
}: SettingsPanelProps) {
  const [margin, setMargin] = useState(36); // Default 1.0cm ≈ 36px

  useEffect(() => {
    if (layoutSettings?.margin_px !== undefined) {
      setMargin(layoutSettings.margin_px);
    }
  }, [layoutSettings]);

  if (!isOpen) return null;

  const handleMarginChange = (value: number | number[]) => {
    const newVal = Array.isArray(value) ? value[0] : value;
    setMargin(newVal);
    
    if (layoutSettings) {
      onSettingsChange({
        ...layoutSettings,
        margin_px: newVal,
      });
    }
  };

  const cmValue = (margin / 37.8).toFixed(1);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm transition-all animate-in fade-in duration-200">
      <div 
        className="w-[400px] bg-white/90 backdrop-blur-xl border border-white/60 rounded-[32px] shadow-card p-6 flex flex-col gap-6 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-zinc-800">页面设置</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-600">页边距 (Safe Area)</label>
              <span className="text-xs font-mono bg-zinc-100 px-2 py-1 rounded text-zinc-500">
                {cmValue} cm ({margin}px)
              </span>
            </div>
            
            <Slider 
              size="sm"
              step={1}
              minValue={18}
              maxValue={113} // approx 3cm
              value={margin}
              onChange={handleMarginChange}
              aria-label="Margin Adjustment"
              className="max-w-md"
              color="secondary"
              classNames={{
                track: "bg-zinc-100 border-s-secondary-100",
                filler: "bg-gradient-to-r from-kawaii-pink to-kawaii-purple",
                thumb: "bg-white shadow-md border border-zinc-100 w-5 h-5 after:bg-kawaii-purple"
              }}
            />
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              调整页边距会自动挤压内容区域。打印时，页边距区域的内容将被自动遮挡。
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button 
            color="primary" 
            onPress={onClose}
            className="rounded-2xl bg-zinc-900 text-white shadow-lg hover:bg-zinc-800 font-medium"
          >
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}

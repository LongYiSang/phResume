"use client";

import type { ChangeEvent } from "react";
import type { LayoutSettings } from "@/types/resume";
import { Card, Select, SelectItem, Slider, Input, Switch, type Selection } from "@heroui/react";

type StylePanelProps = {
  settings: LayoutSettings;
  onSettingsChange: (newSettings: LayoutSettings) => void;
  selectedItemFontSize: number | null;
  onSelectedItemFontSizeChange: (value: number) => void;
  selectedItemColor: string | null;
  onSelectedItemColorChange: (value: string) => void;
  onToggleBold?: () => void;
  onToggleItalic?: () => void;
  onToggleUnderline?: () => void;
};

const FONT_OPTIONS = [
  "Arial",
  "Helvetica",
  "Roboto",
  "Georgia",
  "Times New Roman",
  "PingFang SC",
  "Noto Sans SC",
];

export function StylePanel({
  settings,
  onSettingsChange,
  selectedItemFontSize,
  onSelectedItemFontSizeChange,
  selectedItemColor,
  onSelectedItemColorChange,
  onToggleBold,
  onToggleItalic,
  onToggleUnderline,
}: StylePanelProps) {
  const handleChange = (
    key: "accent_color" | "font_family" | "font_size_pt",
    value: string,
  ) => {
    const nextValue = key === "font_size_pt" ? Number(value) : value;
    onSettingsChange({
      ...settings,
      [key]: nextValue,
    });
  };

  const handleFontSelectionChange = (keys: Selection) => {
    if (keys === "all") return;
    const currentKey = (keys as unknown as { currentKey?: string }).currentKey;
    const val = currentKey ?? Array.from(keys as Set<string>)[0] ?? settings.font_family;
    handleChange("font_family", val);
  };

  const handleBlockRangeChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSelectedItemFontSizeChange(Number(event.target.value));
  };

  const handleBlockColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSelectedItemColorChange(event.target.value);
  };

  return (
    <Card className="rounded-3xl bg-white/70 backdrop-blur-md shadow-lg">
      <div className="p-4">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">样式设置</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">选择模块后可单独调整其字号与颜色。</p>

        <div className="mt-4 space-y-5 text-sm">
          <div className="flex flex-col gap-2">
            <Select
              label="字体"
              selectedKeys={new Set([settings.font_family]) as Selection}
              onSelectionChange={handleFontSelectionChange}
              className="rounded-2xl"
            >
              {FONT_OPTIONS.map((font) => (
                <SelectItem key={font}>
                  {font}
                </SelectItem>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Slider
              label="当前模块字号（pt）"
              minValue={8}
              maxValue={32}
              step={1}
              value={selectedItemFontSize ?? settings.font_size_pt}
              isDisabled={selectedItemFontSize === null}
              onChange={(val) =>
                typeof val === "number" && onSelectedItemFontSizeChange(val)
              }
            />
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedItemFontSize === null
                ? "点击右侧模块后可调整该模块字号"
                : `当前：${selectedItemFontSize} pt`}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">当前模块颜色</label>
            <Input
              type="color"
              value={selectedItemColor ?? settings.accent_color ?? "#1f2937"}
              isDisabled={selectedItemColor === null}
              onChange={(e) => handleBlockColorChange(e as unknown as ChangeEvent<HTMLInputElement>)}
              className="h-10 rounded-2xl"
            />
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {selectedItemColor === null ? "点击模块后可调整颜色" : `当前：${selectedItemColor}`}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch isDisabled={!onToggleBold} onChange={() => onToggleBold?.()}>粗体</Switch>
            <Switch isDisabled={!onToggleItalic} onChange={() => onToggleItalic?.()}>斜体</Switch>
            <Switch isDisabled={!onToggleUnderline} onChange={() => onToggleUnderline?.()}>下划线</Switch>
          </div>
        </div>
      </div>
    </Card>
  );
}

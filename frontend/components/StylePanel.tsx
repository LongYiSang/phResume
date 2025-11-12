"use client";

import type { ChangeEvent } from "react";
import type { LayoutSettings } from "@/types/resume";

type StylePanelProps = {
  settings: LayoutSettings;
  onSettingsChange: (newSettings: LayoutSettings) => void;
  selectedItemFontSize: number | null;
  onSelectedItemFontSizeChange: (value: number) => void;
  selectedItemColor: string | null;
  onSelectedItemColorChange: (value: string) => void;
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

  const handleFontChange = (event: ChangeEvent<HTMLSelectElement>) => {
    handleChange("font_family", event.target.value);
  };

  const handleBlockRangeChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSelectedItemFontSizeChange(Number(event.target.value));
  };

  const handleBlockColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSelectedItemColorChange(event.target.value);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        样式设置
      </h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        选择模块后可单独调整其字号与颜色。
      </p>

      <div className="mt-4 space-y-5 text-sm">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            字体
          </label>
          <select
            value={settings.font_family}
            onChange={handleFontChange}
            className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            当前模块字号（pt）
          </label>
          <input
            type="range"
            min={8}
            max={32}
            step={1}
            value={selectedItemFontSize ?? settings.font_size_pt}
            onChange={handleBlockRangeChange}
            disabled={selectedItemFontSize === null}
          />
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {selectedItemFontSize === null
              ? "点击右侧模块后可调整该模块字号"
              : `当前：${selectedItemFontSize} pt`}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            当前模块颜色
          </label>
          <input
            type="color"
            value={
              selectedItemColor ?? settings.accent_color ?? "#1f2937"
            }
            onChange={handleBlockColorChange}
            disabled={selectedItemColor === null}
            className="h-10 w-full cursor-pointer rounded-md border border-zinc-200 bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {selectedItemColor === null
              ? "点击模块后可调整颜色"
              : `当前：${selectedItemColor}`}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { TextItem } from "@/components/TextItem";

type SectionTitleItemProps = {
  html: string;
  style?: CSSProperties;
  onChange?: (newHtml: string) => void;
  readOnly?: boolean;
  accentColor?: string; // 主题色，用于背景和线条
};

export function SectionTitleItem({
  html,
  style,
  onChange,
  readOnly = false,
  accentColor = "#000000",
}: SectionTitleItemProps) {
  // 提取样式中的颜色，如果 style 中有 backgroundColor 则优先使用，否则使用 accentColor
  // 注意：ResumeItem 的 style 通常包含 color, fontFamily 等
  // 对于 SectionTitle，我们需要区分：
  // 1. 容器样式 (style)
  // 2. 文字块背景色 (style.backgroundColor 或 accentColor)
  // 3. 文字颜色 (通常是白色，或者由 style.color 覆盖)
  // 4. 线条颜色 (style.borderColor 或 accentColor)

  const backgroundColor = style?.backgroundColor ?? accentColor;
  const lineColor = style?.borderColor ?? backgroundColor;
  const textColor = style?.color ?? "#ffffff";

  // 从 style 中剔除会导致冲突或不应应用在容器上的属性
  // 尤其是 borderColor 与 border: "none" 混用会导致 React 报错
  const {
    borderColor: _borderColor,
    border,
    borderTop,
    borderBottom,
    borderLeft,
    borderRight,
    borderWidth,
    borderStyle,
    backgroundColor: _backgroundColor,
    ...restStyle
  } = style || {};

  // 容器样式：继承定位、宽高
  const containerStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-end", // 底部对齐
    width: "100%",
    height: "100%",
    ...restStyle,
    // 重置一些可能干扰 Flex 布局的样式
    backgroundColor: "transparent", // 容器背景透明
    border: "none",
    padding: 0,
  };

  // 文字块样式
  const textBlockStyle: CSSProperties = {
    backgroundColor: backgroundColor,
    color: textColor,
    padding: "2px 12px",
    minWidth: "100px", // 最小宽度
    flexShrink: 0, // 不允许压缩
    position: "relative",
    borderTopLeftRadius: style?.borderTopLeftRadius,
    borderTopRightRadius: style?.borderTopRightRadius,
  };

  // 线条样式
  const lineStyle: CSSProperties = {
    flex: 1, // 占据剩余空间
    height: "3px", // 实线高度
    backgroundColor: lineColor,
    marginBottom: "0px", // 移除底部偏移，使其与文字块底部对齐
    alignSelf: "flex-end", // 确保线条在底部
  };

  // 传递给 TextItem 的样式
  // 我们强制 TextItem 背景透明，颜色继承
  const textItemStyle: CSSProperties = {
    color: "inherit",
    backgroundColor: "transparent",
    fontSize: style?.fontSize,
    fontFamily: style?.fontFamily,
    fontWeight: "bold", // 默认为粗体
    margin: 0,
  };

  return (
    <div style={containerStyle} className="section-title-container">
      <div style={textBlockStyle}>
        <TextItem
          html={html}
          style={textItemStyle}
          onChange={onChange}
          readOnly={readOnly}
        />
      </div>
      <div style={lineStyle} />
    </div>
  );
}

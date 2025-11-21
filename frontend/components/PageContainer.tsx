"use client";

import type { CSSProperties, PropsWithChildren } from "react";

interface PageContainerProps extends PropsWithChildren {
  width?: number;
  height?: number;
  style?: CSSProperties;
}

export function PageContainer({
  children,
  width = 900,
  height = 1272,
  style,
}: PageContainerProps) {
  const baseStyle: CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    backgroundColor: "white",
    boxShadow: "0 20px 40px -10px rgba(251,113,133,0.15)",
    margin: "0 auto",
    position: "relative",
    display: "flex",
    justifyContent: "stretch",
    alignItems: "stretch",
  };

  return <div style={{ ...baseStyle, ...style }}>{children}</div>;
}

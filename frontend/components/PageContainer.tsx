"use client";

import type { CSSProperties, PropsWithChildren } from "react";

interface PageContainerProps extends PropsWithChildren {
  width?: number;
  style?: CSSProperties;
}

export function PageContainer({
  children,
  width = 900,
  style,
}: PageContainerProps) {
  const baseStyle: CSSProperties = {
    width: `${width}px`,
    aspectRatio: "210 / 297",
    backgroundColor: "white",
    boxShadow: "0 0 10px rgba(0,0,0,0.1)",
    margin: "2rem auto",
    position: "relative",
    display: "flex",
    justifyContent: "stretch",
    alignItems: "stretch",
  };

  return <div style={{ ...baseStyle, ...style }}>{children}</div>;
}

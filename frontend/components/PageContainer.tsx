"use client";

import type { PropsWithChildren } from "react";

interface PageContainerProps extends PropsWithChildren {
  width?: number;
}

export function PageContainer({ children, width = 900 }: PageContainerProps) {
  return (
    <div
      style={{
        width: `${width}px`,
        aspectRatio: "210 / 297",
        backgroundColor: "white",
        boxShadow: "0 0 10px rgba(0,0,0,0.1)",
        margin: "2rem auto",
        position: "relative",
      }}
    >
      {children}
    </div>
  );
}

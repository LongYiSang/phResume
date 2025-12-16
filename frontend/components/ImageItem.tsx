"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { API_ROUTES } from "@/lib/api-routes";

type ImageItemProps = {
  objectKey?: string;
  style?: CSSProperties;
  preSignedURL?: string;
};

function combineStyle(style?: CSSProperties): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transformOrigin: "center",
    display: "block",
    borderRadius: "0.375rem",
    ...style,
  };
}

function InlineImage({
  src,
  style,
}: {
  src: string;
  style?: CSSProperties;
}) {
  const combinedStyle = combineStyle(style);
  return (
    <img
      src={src}
      alt="上传的图片"
      style={combinedStyle}
      className="pointer-events-none select-none"
    />
  );
}

function AuthedImage({
  objectKey,
  style,
}: {
  objectKey: string;
  style?: CSSProperties;
}) {
  const { accessToken } = useAuth();
  const authFetch = useAuthFetch();
  const [imageURL, setImageURL] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      setImageURL(null);
      return;
    }

    let isMounted = true;

    const fetchImageURL = async () => {
      setIsLoading(true);
      try {
        const response = await authFetch(API_ROUTES.ASSETS.view(objectKey));

        if (!response.ok) {
          throw new Error("failed to fetch presigned url");
        }

        const data = await response.json();
        if (isMounted) {
          setImageURL(typeof data?.url === "string" ? data.url : null);
        }
      } catch (err) {
        console.error("获取图片 URL 失败", err);
        if (isMounted) {
          setImageURL(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchImageURL();

    return () => {
      isMounted = false;
    };
  }, [objectKey, accessToken, authFetch]);

  const combinedStyle = combineStyle(style);

  if (!imageURL) {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-500"
        style={combinedStyle}
      >
        {isLoading ? "图片加载中..." : "无法加载图片"}
      </div>
    );
  }

  return <InlineImage src={imageURL} style={style} />;
}

export function ImageItem({ objectKey, style, preSignedURL }: ImageItemProps) {
  if (preSignedURL) {
    return <InlineImage src={preSignedURL} style={style} />;
  }

  if (!objectKey) {
    const combinedStyle = combineStyle(style);
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-500"
        style={combinedStyle}
      >
        无法加载图片
      </div>
    );
  }

  return <AuthedImage objectKey={objectKey} style={style} />;
}

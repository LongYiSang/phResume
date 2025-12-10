"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthFetch, friendlyMessageForStatus } from "@/hooks/useAuthFetch";
import { X, Images, Plus } from "lucide-react";
import { API_ROUTES } from "@/lib/api-routes";

type AssetListItem = {
  objectKey: string;
  previewUrl?: string;
  size?: number;
  lastModified?: string;
};

type AssetsPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  onSelectAsset: (objectKey: string) => void;
  onRequestUpload: () => void;
  isUploading: boolean;
  refreshToken: number;
};

export function AssetsPanel({
  isOpen,
  onClose,
  accessToken,
  onSelectAsset,
  onRequestUpload,
  isUploading,
  refreshToken,
}: AssetsPanelProps) {
  const authFetch = useAuthFetch();
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canInteract = useMemo(() => Boolean(accessToken), [accessToken]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (!accessToken) {
      setError("请先登录");
      setAssets([]);
      return;
    }
    let mounted = true;
    const fetchAssets = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await authFetch(API_ROUTES.ASSETS.list({ limit: 60 }));
        if (!resp.ok) {
          setError(friendlyMessageForStatus(resp.status));
          throw new Error(`list assets failed: ${resp.status}`);
        }
        const data = await resp.json();
        const rawItems: unknown[] = Array.isArray(data?.items) ? data.items : [];
        if (mounted) {
          const normalized = rawItems.reduce<AssetListItem[]>((acc, item) => {
            if (!item || typeof item !== "object") {
              return acc;
            }
            const record = item as Record<string, unknown>;
            const objectKey = record.objectKey;
            if (typeof objectKey !== "string" || objectKey.length === 0) {
              return acc;
            }
            acc.push({
              objectKey,
              previewUrl:
                typeof record.previewUrl === "string"
                  ? record.previewUrl
                  : undefined,
              size:
                typeof record.size === "number" ? (record.size as number) : undefined,
              lastModified:
                typeof record.lastModified === "string"
                  ? (record.lastModified as string)
                  : undefined,
            });
            return acc;
          }, []);
          setAssets(normalized);
        }
      } catch (err) {
        console.error("加载图片资产失败", err);
        if (mounted) {
          setError("加载图片资产失败，请稍后重试");
          setAssets([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    fetchAssets();
    return () => {
      mounted = false;
    };
  }, [isOpen, accessToken, authFetch, refreshToken]);

  const formatFileSize = (size?: number) => {
    if (typeof size !== "number" || Number.isNaN(size) || size <= 0) {
      return null;
    }
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${size} B`;
  };

  const renderEmpty = () => {
    if (isLoading) {
      return <span className="text-xs text-zinc-500">加载中...</span>;
    }
    return (
      <div className="flex flex-col items-center justify-center py-12 text-kawaii-text/40 space-y-3">
        <div className="w-16 h-16 bg-white/50 rounded-full flex items-center justify-center">
          <Images size={32} className="opacity-50" />
        </div>
        <p className="text-sm font-medium">尚未上传任何图片</p>
      </div>
    );
  };

  return (
    <div
      className={`fixed top-6 bottom-6 left-28 w-80 z-30 bg-white/90 backdrop-blur-2xl border border-white/60 rounded-[32px] shadow-2xl shadow-kawaii-purple/10 flex flex-col overflow-hidden transition-all duration-500 ease-out ${
        isOpen
          ? "translate-x-0 opacity-100"
          : "-translate-x-[120%] opacity-0 pointer-events-none"
      }`}
      style={{
        backgroundImage: "radial-gradient(#fce7f3 1.5px, transparent 1.5px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div className="relative p-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm bg-kawaii-mint text-white">
            <Images size={20} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-kawaii-text leading-none">
              Assets
            </h2>
            <span className="text-[10px] font-bold text-kawaii-text/40 uppercase tracking-wider">
              Upload & reuse
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-white/50 hover:bg-kawaii-pink hover:text-white flex items-center justify-center text-kawaii-text/50 transition-all duration-200 active:scale-90"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
        {error && (
          <div className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {assets.map((asset) => {
            const label =
              asset.objectKey.split("/").pop() ?? asset.objectKey;
            return (
              <button
                type="button"
                key={asset.objectKey}
                onClick={() => onSelectAsset(asset.objectKey)}
                className="relative bg-white p-2 rounded-xl shadow-sm border border-white transition-all duration-300 hover:shadow-card hover:-translate-y-1 hover:-rotate-1"
              >
                <div className="aspect-square rounded-lg relative overflow-hidden bg-kawaii-bg">
                  {asset.previewUrl ? (
                    <img
                      src={asset.previewUrl}
                      alt={label}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500">
                      预览不可用
                    </div>
                  )}
                  <div className="absolute inset-0 bg-kawaii-text/10 backdrop-blur-[2px] opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center text-xs font-semibold text-white">
                    插入
                  </div>
                </div>
                <div className="mt-2 text-left">
                  <p className="text-xs font-medium text-kawaii-text truncate">
                    {label}
                  </p>
                  <p className="text-[10px] text-kawaii-text/60">
                    {formatFileSize(asset.size) ??
                      (asset.lastModified
                        ? new Date(asset.lastModified).toLocaleDateString()
                        : " ")}
                  </p>
                </div>
              </button>
            );
          })}

          <button
            type="button"
            onClick={onRequestUpload}
            disabled={!canInteract || isUploading}
            className="relative bg-white p-2 rounded-xl shadow-sm border border-dashed border-kawaii-mint/60 flex flex-col items-center justify-center h-full min-h-[140px] text-kawaii-text/60 hover:border-kawaii-mint hover:text-kawaii-mint transition-all duration-200 disabled:opacity-50"
          >
            <div className="w-16 h-16 rounded-2xl bg-kawaii-mint/10 flex flex-col items-center justify-center text-kawaii-mint">
              {isUploading ? (
                <SpinnerIcon className="h-6 w-6" />
              ) : (
                <Plus size={28} />
              )}
            </div>
            <span className="mt-3 text-sm font-medium">
              {isUploading ? "上传中..." : "上传图片"}
            </span>
          </button>
        </div>

        {assets.length === 0 && renderEmpty()}
      </div>
    </div>
  );
}

function SpinnerIcon({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`animate-spin ${className ?? ""}`}
      {...props}
      aria-hidden="true"
    >
      <circle
        className="opacity-30"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4z"
      />
    </svg>
  );
}

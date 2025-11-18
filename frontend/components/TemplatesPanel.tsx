"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { useAuthFetch } from "@/hooks/useAuthFetch";

type TemplateListItem = {
  id: number;
  title: string;
  preview_image_url?: string;
};

type TemplatesPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  currentResumeData: ResumeData | null;
  onApply: (data: ResumeData) => void;
};

export function TemplatesPanel({
  isOpen,
  onClose,
  accessToken,
  currentResumeData,
  onApply,
}: TemplatesPanelProps) {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveTitle, setSaveTitle] = useState("");
  const authFetch = useAuthFetch();
  const canInteract = useMemo(() => Boolean(accessToken), [accessToken]);

  useEffect(() => {
    if (!isOpen) return;
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    let isMounted = true;
    const fetchList = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await authFetch("/api/v1/templates");
        if (!resp.ok) {
          throw new Error("list templates failed");
        }
        const data = (await resp.json()) as TemplateListItem[];
        if (isMounted) {
          setTemplates(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error("模板列表获取失败", err);
        if (isMounted) {
          setError("模板列表获取失败");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    fetchList();
    return () => {
      isMounted = false;
    };
  }, [isOpen, accessToken, authFetch]);

  const handleApply = async (id: number) => {
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    setError(null);
    try {
      const resp = await authFetch(`/api/v1/templates/${id}`);
      if (!resp.ok) {
        throw new Error("get template failed");
      }
      const data = await resp.json();
      const content = data?.content;
      if (!content) {
        throw new Error("missing content");
      }
      const normalized = normalizeResumeContent(content);
      if (!normalized) {
        throw new Error("invalid template content");
      }
      onApply(normalized);
      onClose();
    } catch (err) {
      console.error("应用模板失败", err);
      setError("应用模板失败，请重试");
    }
  };

  const handleSave = async () => {
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    if (!currentResumeData) {
      setError("当前没有可保存的简历内容");
      return;
    }
    const title = saveTitle.trim();
    if (!title) {
      setError("请输入模板标题");
      return;
    }
    setError(null);
    try {
      const resp = await authFetch("/api/v1/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          content: currentResumeData,
          // preview_image_url: null, // 暂不处理上传
        }),
      });
      if (!resp.ok) {
        throw new Error("create template failed");
      }
      // 保存成功，刷新列表
      setSaveTitle("");
      const reload = await authFetch("/api/v1/templates");
      if (reload.ok) {
        const data = (await reload.json()) as TemplateListItem[];
        setTemplates(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("保存模板失败", err);
      setError("保存模板失败，请重试");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-lg dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            模板
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              保存当前为模板
            </h3>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="请输入模板标题"
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={!canInteract || !currentResumeData}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                保存
              </button>
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                我的模板与公开模板
              </h3>
              {isLoading && (
                <span className="text-xs text-zinc-500">加载中...</span>
              )}
            </div>
            {error && (
              <div className="mb-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  {t.preview_image_url ? (
                    // 简易缩略图
                    <img
                      src={t.preview_image_url}
                      alt={t.title}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      无预览
                    </div>
                  )}
                  <div className="flex-1 overflow-hidden">
                    <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {t.title}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApply(t.id)}
                    disabled={!canInteract}
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    应用
                  </button>
                </div>
              ))}
              {templates.length === 0 && !isLoading && (
                <div className="col-span-full select-none rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  暂无模板
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 以宽松方式规范化服务端返回的模板 content
function normalizeResumeContent(content: unknown): ResumeData | null {
  if (!content) return null;
  try {
    // content 可能是对象或 JSON 字符串
    const raw = typeof content === "string" ? JSON.parse(content) : content;
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const items = Array.isArray(obj.items) ? obj.items : [];
    const layout = (obj.layout_settings ?? {}) as Record<string, unknown>;
    return {
      layout_settings: {
        accent_color:
          typeof layout.accent_color === "string" ? layout.accent_color : "#3388ff",
        font_family:
          typeof layout.font_family === "string" ? layout.font_family : "Arial",
        font_size_pt:
          typeof layout.font_size_pt === "number" ? layout.font_size_pt : 10,
        columns: typeof layout.columns === "number" ? layout.columns : 24,
        row_height_px:
          typeof layout.row_height_px === "number" ? layout.row_height_px : 10,
        margin_px: typeof layout.margin_px === "number" ? layout.margin_px : 30,
      },
      items: items.map((it, idx) => {
        const rec = (it as Record<string, unknown>) ?? {};
        const layoutRaw = (rec.layout as Record<string, unknown>) ?? {};
        return {
          id: typeof rec.id === "string" ? rec.id : `item-${idx}`,
          type: typeof rec.type === "string" ? rec.type : "text",
          content: typeof rec.content === "string" ? rec.content : "",
          style:
            typeof rec.style === "object" && rec.style
              ? (rec.style as Record<string, string | number>)
              : {},
          layout: {
            x: typeof layoutRaw.x === "number" ? layoutRaw.x : 0,
            y: typeof layoutRaw.y === "number" ? layoutRaw.y : 0,
            w: typeof layoutRaw.w === "number" ? layoutRaw.w : 4,
            h: typeof layoutRaw.h === "number" ? layoutRaw.h : 4,
          },
        };
      }),
    };
  } catch (e) {
    console.error("normalize template content error", e);
    return null;
  }
}

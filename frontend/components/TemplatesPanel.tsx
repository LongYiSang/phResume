"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { useAuthFetch, friendlyMessageForStatus } from "@/hooks/useAuthFetch";
import { normalizeResumeContent } from "@/utils/resume";
import { Button, Input } from "@heroui/react";
import { X, LayoutTemplate } from "lucide-react";

type TemplateListItem = {
  id: number;
  title: string;
  preview_image_url?: string;
  is_owner?: boolean;
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
  const [previewLoadingMap, setPreviewLoadingMap] = useState<Record<number, boolean>>({});
  const authFetch = useAuthFetch();
  const canInteract = useMemo(() => Boolean(accessToken), [accessToken]);
  const refreshTemplates = async () => {
    const { API_ROUTES } = await import("@/lib/api-routes");
    const resp = await authFetch(API_ROUTES.TEMPLATES.list());
    if (!resp.ok) {
      return;
    }
    const data = (await resp.json()) as TemplateListItem[];
    setTemplates(Array.isArray(data) ? data : []);
  };

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
        const { API_ROUTES } = await import("@/lib/api-routes");
        const resp = await authFetch(API_ROUTES.TEMPLATES.list());
        if (!resp.ok) {
          setError(friendlyMessageForStatus(resp.status));
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
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.TEMPLATES.byId(id));
      if (!resp.ok) {
        setError(friendlyMessageForStatus(resp.status));
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
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.TEMPLATES.create(), {
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
        if (resp.status === 403) {
          setError("已达模板保存上限，请升级会员以扩容。");
          return;
        }
        setError(friendlyMessageForStatus(resp.status));
        throw new Error("create template failed");
      }
      // 保存成功，刷新列表
      setSaveTitle("");
      await refreshTemplates();
    } catch (err) {
      console.error("保存模板失败", err);
      setError("保存模板失败，请重试");
    }
  };

  const handleGeneratePreview = async (id: number) => {
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    setError(null);
    setPreviewLoadingMap((prev) => ({ ...prev, [id]: true }));
    try {
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.TEMPLATES.generatePreview(id), {
        method: "POST",
      });
      if (!resp.ok) {
        setError(friendlyMessageForStatus(resp.status, "pdf"));
        throw new Error("generate preview failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await refreshTemplates();
    } catch (err) {
      console.error("生成模板预览失败", err);
      setError("生成模板预览失败，请稍后重试");
    } finally {
      setPreviewLoadingMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    const confirmed = window.confirm("确定要删除该模板吗？此操作不可撤销。");
    if (!confirmed) return;
    setError(null);
    try {
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.TEMPLATES.delete(id), {
        method: "DELETE",
      });
      if (!resp.ok && resp.status !== 204) {
        setError(friendlyMessageForStatus(resp.status));
        throw new Error("delete template failed");
      }
      setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    } catch (err) {
      console.error("删除模板失败", err);
      setError("删除模板失败，请稍后重试");
    }
  };

  return (
    <div
      className={`fixed top-6 bottom-6 left-28 w-80 z-30 bg-white/90 backdrop-blur-2xl border border-white/60 rounded-[32px] shadow-2xl shadow-kawaii-purple/10 flex flex-col overflow-hidden transition-all duration-500 ease-out ${isOpen ? "translate-x-0 opacity-100" : "-translate-x-[120%] opacity-0 pointer-events-none"}`}
      style={{ backgroundImage: "radial-gradient(#fce7f3 1.5px, transparent 1.5px)", backgroundSize: "20px 20px" }}
    >
      <div className="relative p-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm bg-kawaii-pink text-white">
            <LayoutTemplate size={20} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-kawaii-text leading-none">Templates</h2>
            <span className="text-[10px] font-bold text-kawaii-text/40 uppercase tracking-wider">Choose a style</span>
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

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        <div className="mb-6 relative">
          <div className="relative bg-white border border-white/60 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-kawaii-text/60 text-xs font-bold uppercase tracking-wide">
              <span>保存当前为模板</span>
            </div>
            <div className="flex items-center gap-2 bg-kawaii-bg rounded-xl p-1 pr-1">
              <Input
                value={saveTitle}
                onChange={(e) => setSaveTitle((e.target as HTMLInputElement).value)}
                placeholder="请输入模板标题"
                className="flex-1 rounded-2xl"
              />
              <Button color="primary" onPress={handleSave} isDisabled={!canInteract || !currentResumeData} className="rounded-2xl">
                保存
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">{error}</div>
          )}
          {isLoading && <span className="text-xs text-zinc-500">加载中...</span>}
          {templates.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-kawaii-text/40 space-y-3">
              <div className="w-16 h-16 bg-white/50 rounded-full flex items-center justify-center">
                <LayoutTemplate size={32} className="opacity-50" />
              </div>
              <p className="text-sm font-medium">暂无模板</p>
            </div>
          ) : (
            templates.map((t) => {
              const isPreviewUpdating = Boolean(previewLoadingMap[t.id]);
              return (
                <div key={t.id} className="relative">
                  <div className="relative bg-white p-3 pb-10 rounded-xl shadow-sm border border-white transform transition-all duration-300 hover:scale-[1.02] hover:-rotate-1 hover:shadow-card">
                    <div className="aspect-[4/3] rounded-lg mb-3 relative overflow-hidden bg-kawaii-bg">
                      {t.preview_image_url ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={t.preview_image_url}
                            alt={t.title}
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        </>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500">
                          <CameraIcon className="h-4 w-4 opacity-70" />
                        </div>
                      )}
                      {isPreviewUpdating && (
                        <div className="absolute inset-0 flex items-center justify-center rounded bg-black/30">
                          <SpinnerIcon className="h-4 w-4 text-white" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-kawaii-text/10 backdrop-blur-[2px] opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleApply(t.id)}
                          disabled={!canInteract}
                          className="w-10 h-10 rounded-full bg-white text-kawaii-purple hover:bg-kawaii-purple hover:text-white shadow-lg transition-all"
                        >
                          应用
                        </button>
                        {t.is_owner && (
                          <button
                            type="button"
                            onClick={() => handleGeneratePreview(t.id)}
                            disabled={!canInteract || isPreviewUpdating}
                            className="w-10 h-10 rounded-full bg-white text-kawaii-text hover:bg-kawaii-blue hover:text-white shadow-lg transition-all"
                          >
                            <CameraIcon className="h-4 w-4" />
                          </button>
                        )}
                        {t.is_owner && (
                          <button
                            type="button"
                            onClick={() => handleDelete(t.id)}
                            className="w-10 h-10 rounded-full bg-white text-kawaii-pink hover:bg-kawaii-pink hover:text-white shadow-lg transition-all"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="absolute bottom-3 left-3 right-3 flex items-start justify-between">
                      <div className="overflow-hidden">
                        <h4 className="font-bold text-kawaii-text text-sm truncate pr-2">{t.title}</h4>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function CameraIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 8h3.2l1.2-2h7.2l1.2 2H20v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
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
        className="opacity-25"
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

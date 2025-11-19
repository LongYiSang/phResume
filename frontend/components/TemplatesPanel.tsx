"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { normalizeResumeContent } from "@/utils/resume";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Card } from "@heroui/react";

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
    const resp = await authFetch("/api/v1/templates");
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
        if (resp.status === 403) {
          setError("已达模板保存上限，请升级会员以扩容。");
          return;
        }
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
      const resp = await authFetch(`/api/v1/templates/${id}/generate-preview`, {
        method: "POST",
      });
      if (!resp.ok) {
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
      const resp = await authFetch(`/api/v1/templates/${id}`, {
        method: "DELETE",
      });
      if (!resp.ok && resp.status !== 204) {
        throw new Error("delete template failed");
      }
      setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    } catch (err) {
      console.error("删除模板失败", err);
      setError("删除模板失败，请稍后重试");
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} backdrop="blur">
      <ModalContent className="rounded-3xl">
        <ModalHeader>模板</ModalHeader>
        <ModalBody>
          <Card className="p-3 rounded-2xl bg-white/70 backdrop-blur-md">
            <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">保存当前为模板</h3>
            <div className="mt-2 flex gap-2">
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
          </Card>

          <Card className="p-3 rounded-2xl bg-white/70 backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">我的模板与公开模板</h3>
              {isLoading && <span className="text-xs text-zinc-500">加载中...</span>}
            </div>
            {error && (
              <div className="mb-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">{error}</div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((t) => {
                const isPreviewUpdating = Boolean(previewLoadingMap[t.id]);
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-zinc-200 p-2">
                    <div className="relative h-12 w-12">
                      {t.preview_image_url ? (
                        <img src={t.preview_image_url} alt={t.title} className="h-12 w-12 rounded object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500">
                          <CameraIcon className="h-4 w-4 opacity-70" />
                        </div>
                      )}
                      {isPreviewUpdating && (
                        <div className="absolute inset-0 flex items-center justify-center rounded bg-black/30">
                          <SpinnerIcon className="h-4 w-4 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="truncate text-sm font-medium text-zinc-900">{t.title}</div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button variant="bordered" onPress={() => handleApply(t.id)} isDisabled={!canInteract} className="rounded-2xl">
                        应用
                      </Button>
                      {t.is_owner && (
                        <>
                          <Button
                            variant="bordered"
                            onPress={() => handleGeneratePreview(t.id)}
                            isDisabled={!canInteract || isPreviewUpdating}
                            className="rounded-2xl"
                          >
                            <span className="flex items-center justify-center gap-1">
                              {isPreviewUpdating ? (
                                <>
                                  <SpinnerIcon className="h-3.5 w-3.5" />
                                  <span>生成中</span>
                                </>
                              ) : (
                                <>
                                  <CameraIcon className="h-3.5 w-3.5" />
                                  <span>刷新预览</span>
                                </>
                              )}
                            </span>
                          </Button>
                          <Button variant="bordered" color="danger" onPress={() => handleDelete(t.id)} className="rounded-2xl">
                            删除
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {templates.length === 0 && !isLoading && (
                <div className="col-span-full select-none rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">暂无模板</div>
              )}
            </div>
          </Card>
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" onPress={onClose} className="rounded-2xl">关闭</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
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

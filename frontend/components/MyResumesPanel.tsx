"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { normalizeResumeContent } from "@/utils/resume";

type ResumeListItem = {
  id: number;
  title: string;
  preview_image_url?: string;
  created_at?: string;
};

type LoadedResume = {
  id: number;
  title: string;
  content: ResumeData;
};

type MyResumesPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  currentResumeData: ResumeData | null;
  onResumeSelected: (resume: LoadedResume) => void;
  onResumeDeleted?: (deletedId: number) => void;
};

export function MyResumesPanel({
  isOpen,
  onClose,
  accessToken,
  currentResumeData,
  onResumeSelected,
  onResumeDeleted,
}: MyResumesPanelProps) {
  const [resumes, setResumes] = useState<ResumeListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const authFetch = useAuthFetch();
  const canInteract = useMemo(
    () => Boolean(accessToken && currentResumeData),
    [accessToken, currentResumeData],
  );

  useEffect(() => {
    if (!isOpen || !accessToken) {
      return;
    }
    let mounted = true;
    const fetchList = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const resp = await authFetch("/api/v1/resume");
        if (!resp.ok) {
          throw new Error(`list resumes failed: ${resp.status}`);
        }
        const data = (await resp.json()) as ResumeListItem[];
        if (mounted) {
          setResumes(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error("获取简历列表失败", err);
        if (mounted) {
          setError("获取简历列表失败，请稍后重试");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    fetchList();
    return () => {
      mounted = false;
    };
  }, [isOpen, accessToken, authFetch]);

  const refreshList = async () => {
    if (!accessToken) return;
    try {
      const resp = await authFetch("/api/v1/resume");
      if (!resp.ok) {
        throw new Error("reload list failed");
      }
      const data = (await resp.json()) as ResumeListItem[];
      setResumes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("刷新简历列表失败", err);
    }
  };

  const handleCreate = async () => {
    if (!canInteract) {
      setError("请先登录并加载简历内容");
      return;
    }
    const title = newTitle.trim();
    if (!title) {
      setError("请输入新简历标题");
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const resp = await authFetch("/api/v1/resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          content: currentResumeData,
        }),
      });
      if (!resp.ok) {
        if (resp.status === 403) {
          setError("已达简历保存上限，请升级会员以扩容。");
          return;
        }
        throw new Error(`create resume failed: ${resp.status}`);
      }

      const data = (await resp.json()) as {
        id?: number;
        title?: string;
        content?: unknown;
      };
      const normalized = normalizeResumeContent(data?.content);
      if (!normalized || typeof data?.id !== "number") {
        throw new Error("invalid resume data");
      }
      onResumeSelected({
        id: data.id,
        title: data.title ?? title,
        content: normalized,
      });
      setNewTitle("");
      await refreshList();
      onClose();
    } catch (err) {
      console.error("创建新简历失败", err);
      setError("创建新简历失败，请稍后重试");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLoad = async (id: number) => {
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const resp = await authFetch(`/api/v1/resume/${id}`);
      if (!resp.ok) {
        throw new Error(`get resume failed: ${resp.status}`);
      }
      const data = (await resp.json()) as {
        id?: number;
        title?: string;
        content?: unknown;
      };
      const normalized = normalizeResumeContent(data?.content);
      if (!normalized || typeof data?.id !== "number") {
        throw new Error("invalid resume data");
      }
      onResumeSelected({
        id: data.id,
        title: data.title ?? "",
        content: normalized,
      });
      onClose();
    } catch (err) {
      console.error("加载简历失败", err);
      setError("加载简历失败，请稍后重试");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!accessToken) {
      setError("请先登录");
      return;
    }
    const confirmed = window.confirm("确定要删除该简历吗？此操作不可撤销。");
    if (!confirmed) return;

    setActionLoading(true);
    setError(null);
    try {
      const resp = await authFetch(`/api/v1/resume/${id}`, {
        method: "DELETE",
      });
      if (!resp.ok && resp.status !== 204) {
        throw new Error(`delete resume failed: ${resp.status}`);
      }
      await refreshList();
      onResumeDeleted?.(id);
    } catch (err) {
      console.error("删除简历失败", err);
      setError("删除简历失败，请稍后重试");
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-lg dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            我的简历
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
              另存为新简历
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              输入标题后保存为新的独立简历。普通用户最多可保存 3 份。
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="请输入新简历标题"
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!canInteract || actionLoading}
                className="whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {actionLoading ? "处理中..." : "保存为新简历"}
              </button>
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                我的简历列表
              </h3>
              {isLoading && (
                <span className="text-xs text-zinc-500">加载中...</span>
              )}
            </div>
            {error && (
              <div className="mb-3 rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {resumes.map((resume) => (
                <div
                  key={resume.id}
                  className="flex gap-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  {resume.preview_image_url ? (
                    <img
                      src={resume.preview_image_url}
                      alt={resume.title}
                      className="h-16 w-16 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      预览
                    </div>
                  )}
                  <div className="flex flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {resume.title}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {resume.created_at
                        ? new Date(resume.created_at).toLocaleString()
                        : "创建时间未知"}
                    </span>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleLoad(resume.id)}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        加载
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(resume.id)}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-900/30"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {resumes.length === 0 && !isLoading && (
                <div className="col-span-full select-none rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  暂无已保存的简历
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

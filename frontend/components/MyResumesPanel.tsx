"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { useAuthFetch, friendlyMessageForStatus } from "@/hooks/useAuthFetch";
import { normalizeResumeContent } from "@/utils/resume";
import { Button, Input } from "@heroui/react";
import { X, FolderOpen } from "lucide-react";

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
  const [page, setPage] = useState(1);
  const pageSize = 6;
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
        const { API_ROUTES } = await import("@/lib/api-routes");
        const resp = await authFetch(API_ROUTES.RESUME.list());
        if (!resp.ok) {
          setError(friendlyMessageForStatus(resp.status));
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
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.RESUME.list());
      if (!resp.ok) {
        setError(friendlyMessageForStatus(resp.status));
        throw new Error("reload list failed");
      }
      const data = (await resp.json()) as ResumeListItem[];
      setResumes(Array.isArray(data) ? data : []);
      setPage(1);
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
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.RESUME.create(), {
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
        setError(friendlyMessageForStatus(resp.status));
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
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.RESUME.byId(id));
      if (!resp.ok) {
        setError(friendlyMessageForStatus(resp.status));
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
      const { API_ROUTES } = await import("@/lib/api-routes");
      const resp = await authFetch(API_ROUTES.RESUME.delete(id), {
        method: "DELETE",
      });
      if (!resp.ok && resp.status !== 204) {
        setError(friendlyMessageForStatus(resp.status));
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

  return (
    <div
      className={`fixed top-6 bottom-6 left-28 w-80 z-30 bg-white/90 backdrop-blur-2xl border border-white/60 rounded-[32px] shadow-2xl shadow-kawaii-purple/10 flex flex-col overflow-hidden transition-all duration-500 ease-out ${isOpen ? "translate-x-0 opacity-100" : "-translate-x-[120%] opacity-0 pointer-events-none"}`}
      style={{ backgroundImage: "radial-gradient(#fce7f3 1.5px, transparent 1.5px)", backgroundSize: "20px 20px" }}
    >
      <div className="relative p-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm bg-kawaii-purple text-white">
            <FolderOpen size={20} />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-kawaii-text leading-none">Library</h2>
            <span className="text-[10px] font-bold text-kawaii-text/40 uppercase tracking-wider">Your history</span>
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
              <span>另存为新简历</span>
            </div>
            <div className="flex items-center gap-2 bg-kawaii-bg rounded-xl p-1 pr-1">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle((e.target as HTMLInputElement).value)}
                placeholder="请输入新简历标题"
                className="flex-1 rounded-2xl"
              />
              <Button color="primary" onPress={handleCreate} isDisabled={!canInteract || actionLoading} className="rounded-2xl">
                {actionLoading ? "处理中..." : "保存"}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded bg-red-100 px-2 py-1 text-xs text-red-700">{error}</div>
        )}
        {isLoading && <span className="text-xs text-zinc-500">加载中...</span>}

        <div className="space-y-4">
          {resumes
            .slice((page - 1) * pageSize, page * pageSize)
            .map((resume) => (
              <div key={resume.id} className="relative">
                <div className="relative bg-white p-3 pb-10 rounded-xl shadow-sm border border-white transform transition-all duration-300 hover:scale-[1.02] hover:-rotate-1 hover:shadow-card">
                  <div className="aspect-[4/3] rounded-lg mb-3 relative overflow-hidden bg-kawaii-bg">
                    {resume.preview_image_url ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resume.preview_image_url}
                          alt={resume.title}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500">预览</div>
                    )}
                    <div className="absolute inset-0 bg-kawaii-text/10 backdrop-blur-[2px] opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleLoad(resume.id)}
                        className="w-10 h-10 rounded-full bg-white text-kawaii-purple hover:bg-kawaii-purple hover:text-white shadow-lg transition-all"
                      >
                        加载
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(resume.id)}
                        className="w-10 h-10 rounded-full bg-white text-kawaii-pink hover:bg-kawaii-pink hover:text-white shadow-lg transition-all"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-3 right-3 flex items-start justify-between">
                    <div className="overflow-hidden">
                      <h4 className="font-bold text-kawaii-text text-sm truncate pr-2">{resume.title}</h4>
                      <p className="text-[10px] text-kawaii-text/50">
                        {resume.created_at ? new Date(resume.created_at).toLocaleString() : "创建时间未知"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

          {resumes.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-kawaii-text/40 space-y-3">
              <div className="w-16 h-16 bg-white/50 rounded-full flex items-center justify-center">
                <FolderOpen size={32} className="opacity-50" />
              </div>
              <p className="text-sm font-medium">暂无已保存的简历</p>
            </div>
          )}
        </div>

        {resumes.length > pageSize && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              variant="bordered"
              className="rounded-2xl"
              isDisabled={page === 1}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <div className="text-xs text-zinc-500">
              第 {page} / {Math.ceil(resumes.length / pageSize)} 页
            </div>
            <Button
              variant="bordered"
              className="rounded-2xl"
              isDisabled={page >= Math.ceil(resumes.length / pageSize)}
              onPress={() => setPage((p) => Math.min(Math.ceil(resumes.length / pageSize), p + 1))}
            >
              下一页
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

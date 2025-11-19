"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResumeData } from "@/types/resume";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { normalizeResumeContent } from "@/utils/resume";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Card } from "@heroui/react";

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

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} backdrop="blur">
      <ModalContent className="rounded-3xl">
        <ModalHeader>我的简历</ModalHeader>
        <ModalBody>
          <Card className="p-3 rounded-2xl bg-white/70 backdrop-blur-md">
            <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">另存为新简历</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">输入标题后保存为新的独立简历。普通用户最多可保存 3 份。</p>
            <div className="mt-3 flex gap-2">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle((e.target as HTMLInputElement).value)}
                placeholder="请输入新简历标题"
                className="flex-1 rounded-2xl"
              />
              <Button color="primary" onPress={handleCreate} isDisabled={!canInteract || actionLoading} className="rounded-2xl">
                {actionLoading ? "处理中..." : "保存为新简历"}
              </Button>
            </div>
          </Card>

          <Card className="p-3 rounded-2xl bg-white/70 backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">我的简历列表</h3>
              {isLoading && <span className="text-xs text-zinc-500">加载中...</span>}
            </div>
            {error && (
              <div className="mb-3 rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">{error}</div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {resumes
                .slice((page - 1) * pageSize, page * pageSize)
                .map((resume) => (
                <div key={resume.id} className="flex gap-3 rounded-2xl border border-zinc-200 p-2">
                  {resume.preview_image_url ? (
                    <img src={resume.preview_image_url} alt={resume.title} className="h-16 w-16 rounded object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 text-[10px] text-zinc-500">预览</div>
                  )}
                  <div className="flex flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-zinc-900">{resume.title}</span>
                    <span className="text-xs text-zinc-500">
                      {resume.created_at ? new Date(resume.created_at).toLocaleString() : "创建时间未知"}
                    </span>
                    <div className="mt-2 flex gap-2">
                      <Button variant="bordered" onPress={() => handleLoad(resume.id)} className="rounded-2xl">加载</Button>
                      <Button variant="bordered" color="danger" onPress={() => handleDelete(resume.id)} className="rounded-2xl">删除</Button>
                    </div>
                  </div>
                </div>
              ))}
              {resumes.length === 0 && !isLoading && (
                <div className="col-span-full select-none rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">暂无已保存的简历</div>
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
          </Card>
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" onPress={onClose} className="rounded-2xl">关闭</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

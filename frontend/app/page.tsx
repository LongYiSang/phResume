"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

type TaskStatus = "idle" | "pending" | "completed";

export default function Home() {
  const router = useRouter();
  const { accessToken, isAuthenticated } = useAuth();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [savedResumeId, setSavedResumeId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
  const socketRef = useRef<WebSocket | null>(null);

  const fetchDownloadLink = useCallback(
    async (resumeId: number) => {
      if (!accessToken) {
        setError("请先登录");
        setTaskStatus("idle");
        return;
      }

      setError(null);

      try {
        const response = await fetch(
          `/api/v1/resume/${resumeId}/download-link`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error("failed to fetch download link");
        }

        const data = await response.json();
        if (data?.url) {
          window.open(data.url, "_blank", "noopener");
        } else {
          throw new Error("missing url in response");
        }
      } catch (err) {
        console.error("获取预签名链接失败", err);
        setError("获取下载链接失败，请稍后重试");
      } finally {
        setTaskStatus("idle");
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (isAuthenticated === false) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }

    const ws = new WebSocket("ws://localhost/api/v1/ws");
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: accessToken }));
      console.log("WebSocket connected and authenticated.");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.status === "completed" && typeof data.resume_id === "number") {
          setTaskStatus("completed");
          fetchDownloadLink(data.resume_id);
        }
      } catch (parseError) {
        console.error("Invalid WebSocket payload:", parseError);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected.");
      socketRef.current = null;
    };

    ws.onerror = () => {
      console.error("WebSocket error.");
      socketRef.current = null;
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, [isAuthenticated, accessToken, fetchDownloadLink]);

  const handleSave = async () => {
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle || !trimmedContent) {
      setError("标题和内容不能为空");
      return;
    }

    setIsLoading(true);

    if (!accessToken) {
      setError("请先登录");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/v1/resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ title: trimmedTitle, content: trimmedContent }),
      });

      if (!response.ok) {
        throw new Error("保存失败");
      }

      const data = await response.json();
      setSavedResumeId(data.ID ?? null);
    } catch (err) {
      setError("保存失败，请重试");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!savedResumeId) {
      return;
    }

    if (!accessToken) {
      setError("请先登录");
      return;
    }

    setError(null);
    setTaskStatus("pending");

    try {
      const response = await fetch(`/api/v1/resume/${savedResumeId}/download`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("下载失败");
      }
    } catch (err) {
      setError("生成任务提交失败，请稍后重试");
      setTaskStatus("idle");
    }
  };

  const renderDownloadLabel = () => {
    if (taskStatus === "pending") {
      return "生成中...";
    }
    if (taskStatus === "completed") {
      return "已生成，重新生成";
    }
    return "生成 PDF";
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
          简历编辑器
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          输入简历内容，保存并生成 PDF。
        </p>
      </header>

      <input
        className="w-full rounded-md border border-zinc-200 bg-white p-4 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="请输入简历标题"
      />

      <textarea
        className="min-h-[300px] w-full rounded-md border border-zinc-200 bg-white p-4 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="请在此输入简历内容..."
      />

      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading}
          className="rounded-md bg-zinc-900 px-6 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isLoading ? "保存中..." : "保存简历"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={savedResumeId === null || taskStatus === "pending"}
          className="rounded-md border border-zinc-300 px-6 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {renderDownloadLabel()}
        </button>
      </div>

      {savedResumeId !== null && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          已保存的简历 ID：{savedResumeId}
        </div>
      )}

      {taskStatus === "pending" && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          正在生成 PDF，请稍候...
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-100 px-4 py-2 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

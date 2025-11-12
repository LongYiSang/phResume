"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RGL, { type Layout } from "react-grid-layout";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/context/AuthContext";

type TaskStatus = "idle" | "pending" | "completed";

const GRID_COLS = 24;
const GRID_ROW_HEIGHT = 10;
const CANVAS_WIDTH = 900;

type ResumeLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  [key: string]: unknown;
};

type ResumeItem = {
  id: string;
  type: string;
  content?: string;
  layout: ResumeLayout;
  [key: string]: unknown;
};

type ResumeData = {
  layout_settings?: Record<string, unknown>;
  items: ResumeItem[];
};

function normalizeResumeContent(content: unknown): ResumeData | null {
  if (!content) {
    return null;
  }

  let parsed: unknown = content;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      console.error("简历内容 JSON 解析失败", err);
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const draft = parsed as Record<string, unknown> & {
    items?: unknown;
    layout_settings?: Record<string, unknown>;
  };

  const itemsSource = Array.isArray(draft.items) ? draft.items : [];

  const items: ResumeItem[] = itemsSource.map((raw, index) => {
    const item = (raw as Record<string, unknown>) ?? {};
    const layoutRaw = (item.layout as Record<string, unknown>) ?? {};

    const layout: ResumeLayout = {
      x: typeof layoutRaw.x === "number" ? layoutRaw.x : 0,
      y: typeof layoutRaw.y === "number" ? layoutRaw.y : 0,
      w: typeof layoutRaw.w === "number" ? layoutRaw.w : 4,
      h: typeof layoutRaw.h === "number" ? layoutRaw.h : 4,
    };

    return {
      ...(item as Omit<ResumeItem, "id" | "layout">),
      id: typeof item.id === "string" ? item.id : `item-${index}`,
      type: typeof item.type === "string" ? item.type : "text",
      content: typeof item.content === "string" ? item.content : undefined,
      layout,
    };
  });

  return {
    layout_settings: draft.layout_settings,
    items,
  };
}

export default function Home() {
  const router = useRouter();
  const { accessToken, isAuthenticated } = useAuth();
  const [title, setTitle] = useState("");
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [savedResumeId, setSavedResumeId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingResume, setIsFetchingResume] = useState(false);
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

  const fetchLatestResume = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsFetchingResume(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/resume/latest", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("failed to fetch latest resume");
      }

      const data = await response.json();
      setTitle(data?.title ?? "");

      const parsedContent = normalizeResumeContent(data?.content);
      setResumeData(parsedContent);
      setSavedResumeId(
        typeof data?.id === "number" && data.id > 0 ? data.id : null,
      );
    } catch (err) {
      console.error("加载最新简历失败", err);
      setError("加载最新简历失败，请稍后重试");
    } finally {
      setIsFetchingResume(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (isAuthenticated && accessToken) {
      fetchLatestResume();
    }
  }, [isAuthenticated, accessToken, fetchLatestResume]);

  const handleSave = async () => {
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("简历标题不能为空");
      return;
    }

    if (!accessToken) {
      setError("请先登录");
      return;
    }

    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/v1/resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ title: trimmedTitle, content: resumeData }),
      });

      if (!response.ok) {
        throw new Error("保存失败");
      }

      const data = await response.json();
      setSavedResumeId(
        typeof data?.id === "number" && data.id > 0 ? data.id : null,
      );
      setTaskStatus("idle");
    } catch (err) {
      console.error("保存失败", err);
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

  const layout = useMemo<Layout[]>(() => {
    if (!resumeData) {
      return [];
    }

    return resumeData.items.map((item) => {
      const { layout: itemLayout } = item;
      return {
        i: item.id,
        x: itemLayout?.x ?? 0,
        y: itemLayout?.y ?? 0,
        w: itemLayout?.w ?? 4,
        h: itemLayout?.h ?? 4,
      };
    });
  }, [resumeData]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      setResumeData((prev) => {
        if (!prev) {
          return prev;
        }

        const updatedItems = prev.items.map((item) => {
          const nextLayout = newLayout.find((layoutItem) => layoutItem.i === item.id);
          if (!nextLayout) {
            return item;
          }

          const { x, y, w, h } = nextLayout;
          return {
            ...item,
            layout: {
              ...item.layout,
              x,
              y,
              w,
              h,
            },
          };
        });

        return { ...prev, items: updatedItems };
      });
    },
    [],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
          简历编辑器
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          加载并编辑结构化 JSON 布局，保存后可生成 PDF。
        </p>
      </header>

      {isFetchingResume && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          正在加载最新简历...
        </div>
      )}

      <input
        className="w-full rounded-md border border-zinc-200 bg-white p-4 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="请输入简历标题"
      />

      <div className="w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50/60 p-4">
        {resumeData ? (
          <PageContainer width={CANVAS_WIDTH}>
            <RGL
              layout={layout}
              cols={GRID_COLS}
              rowHeight={GRID_ROW_HEIGHT}
              width={CANVAS_WIDTH}
              onLayoutChange={handleLayoutChange}
            >
              {resumeData.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    border: "1px dashed #ccc",
                    backgroundColor: "rgba(255,255,255,0.9)",
                    padding: "0.5rem",
                    color: "#1f2937",
                    fontSize: "12px",
                    overflow: "hidden",
                  }}
                >
                  {item.type === "text"
                    ? item.content ?? "文本"
                    : `[${item.type}]`}
                </div>
              ))}
            </RGL>
          </PageContainer>
        ) : (
          <div className="py-10 text-center text-sm text-zinc-500">
            {isFetchingResume ? "正在加载布局..." : "暂无简历布局数据"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isLoading || isFetchingResume}
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

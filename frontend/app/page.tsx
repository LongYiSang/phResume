"use client";

import { useState } from "react";

export default function Home() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [savedResumeId, setSavedResumeId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle || !trimmedContent) {
      setError("标题和内容不能为空");
      return;
    }

    setIsLoading(true);

    const apiUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL}/v1/resume`;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

  const handleDownload = () => {
    if (!savedResumeId) {
      return;
    }

    window.open(`/api/v1/resume/${savedResumeId}/download`);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
          简历编辑器
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          输入简历内容，保存并下载 PDF。
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
          disabled={savedResumeId === null}
          className="rounded-md border border-zinc-300 px-6 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          下载 PDF
        </button>
      </div>

      {savedResumeId !== null && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          已保存的简历 ID：{savedResumeId}
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

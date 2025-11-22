"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError("用户名和密码不能为空");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
        }),
      });

      if (response.status === 201) {
        router.push("/login");
        return;
      }

      setError("注册失败，请稍后再试");
    } catch {
      setError("注册失败，请稍后再试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
        注册账号
      </h1>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
            用户名
          </span>
          <input
            className="w-full rounded-md border border-zinc-200 bg-white p-3 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="请输入用户名"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
            密码
          </span>
          <input
            type="password"
            className="w-full rounded-md border border-zinc-200 bg-white p-3 text-base text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="请输入密码"
          />
        </label>

        {error && (
          <div className="rounded-md bg-red-100 px-4 py-2 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting ? "提交中..." : "注册"}
        </button>
      </form>
    </div>
  );
}

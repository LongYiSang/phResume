"use client";

import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function useAuthFetch() {
  const { accessToken, refreshAccessToken } = useAuth();

  const authFetch = useCallback(
    async (
      input: FetchInput,
      init?: FetchInit,
      retryOnUnauthorized = true,
    ): Promise<Response> => {
      const ensureToken = async () => {
        if (accessToken) {
          return accessToken;
        }
        return refreshAccessToken();
      };

      const issueRequest = async (token: string) => {
        const headers = new Headers(init?.headers ?? {});
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, {
          ...init,
          headers,
          credentials: init?.credentials ?? "include",
        });
      };

      const token = await ensureToken();
      if (!token) {
        return new Response(null, { status: 401, statusText: "unauthorized" });
      }

      let response = await issueRequest(token);
      if (response.status !== 401 || !retryOnUnauthorized) {
        return response;
      }

      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        return response;
      }
      response = await issueRequest(refreshed);
      return response;
    },
    [accessToken, refreshAccessToken],
  );

  return authFetch;
}

export function friendlyMessageForStatus(status: number, kind?: "upload" | "pdf" | "login" | "default") {
  const k = kind ?? "default";
  if (k === "upload") {
    if (status === 429) return "上传过于频繁，请稍后再试";
    if (status === 413) return "文件过大，最大 5MB";
    if (status === 400) return "不支持的文件类型，请使用 PNG/JPEG/WebP";
    if (status === 403) return "图片数量已达上限，请先删除后再上传";
    return "图片上传失败，请重试";
  }
  if (k === "pdf") {
    if (status === 429) return "生成过于频繁，请稍后再试";
    return "生成任务提交失败，请稍后重试";
  }
  if (k === "login") {
    if (status === 429) return "登录过于频繁或账号已锁定，请稍后再试";
    if (status === 401 || status === 403) return "账号或密码错误";
    return "登录失败，请稍后再试";
  }
  if (status === 429) return "操作过于频繁，请稍后再试";
  if (status === 413) return "请求体过大";
  if (status === 400) return "请求无效";
  if (status === 401) return "请重新登录";
  return "请求失败，请稍后重试";
}

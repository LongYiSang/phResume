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

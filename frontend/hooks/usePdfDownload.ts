"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_ROUTES } from "@/lib/api-routes";
import { ERROR_CODES, messageForErrorCode, titleForErrorCode } from "@/lib/error-codes";
import { friendlyMessageForStatus } from "@/hooks/useAuthFetch";

type TaskStatus = "idle" | "pending" | "completed";

type UsePdfDownloadParams = {
  savedResumeId: number | null;
  savedResumeIdRef: React.MutableRefObject<number | null>;
  isAuthenticated: boolean;
  authFetch: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>;
  showAlert: (payload: { title?: string; message: string }) => void;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
};

export function usePdfDownload({
  savedResumeId,
  savedResumeIdRef,
  isAuthenticated,
  authFetch,
  showAlert,
  setError,
}: UsePdfDownloadParams) {
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
  const [readyResumeId, setReadyResumeId] = useState<number | null>(null);
  const [downloadDeadline, setDownloadDeadline] = useState<number | null>(null);
  const [downloadCountdown, setDownloadCountdown] = useState<number>(0);
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [downloadUid, setDownloadUid] = useState<number | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const countdownTimerRef = useRef<number | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const generationCorrelationIdRef = useRef<string | null>(null);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const resetDownloadLinkState = useCallback(() => {
    setDownloadDeadline(null);
    setDownloadCountdown(0);
    setDownloadToken(null);
    setDownloadUid(null);
    clearCountdownTimer();
  }, [clearCountdownTimer]);

  const resetPdfGenerationState = useCallback(() => {
    generationCorrelationIdRef.current = null;
    setReadyResumeId(null);
    resetDownloadLinkState();
    setTaskStatus("idle");
  }, [resetDownloadLinkState]);

  const startDownloadCountdown = useCallback(
    (ttlSeconds: number) => {
      const ttl = Math.max(0, Math.floor(ttlSeconds));
      const now = Date.now();
      setDownloadDeadline(ttl > 0 ? now + ttl * 1000 : null);
      setDownloadCountdown(ttl);
      clearCountdownTimer();
      if (ttl <= 0) {
        return;
      }
      countdownTimerRef.current = window.setInterval(() => {
        setDownloadCountdown((prev) => {
          const next = Math.max(0, prev - 1);
          if (next === 0) {
            clearCountdownTimer();
          }
          return next;
        });
      }, 1000);
    },
    [clearCountdownTimer],
  );

  useEffect(() => {
    if (taskStatus === "pending") {
      setIsOverlayVisible(true);
      setGenerationProgress(0);
      progressTimerRef.current = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 80) return prev;
          return prev + 5;
        });
      }, 1000);
    } else if (taskStatus === "completed") {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setGenerationProgress(100);
      const hideTimer = setTimeout(() => {
        setIsOverlayVisible(false);
      }, 2000);
      return () => clearTimeout(hideTimer);
    } else {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      setGenerationProgress(0);
      setIsOverlayVisible(false);
    }

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, [taskStatus]);

  const requestDownloadLink = useCallback(
    async (resumeId: number, forceDownload = false) => {
      if (!isAuthenticated) {
        setError("请先登录");
        resetDownloadLinkState();
        return;
      }

      setError(null);

      try {
        const url = new URL(API_ROUTES.RESUME.downloadLink(resumeId), window.location.origin);
        if (forceDownload) {
          url.searchParams.set("download", "1");
          const fname = `Resume-${resumeId}.pdf`;
          url.searchParams.set("filename", fname);
        }
        const response = await authFetch(url.toString());

        if (!response.ok) {
          throw new Error(`failed to request download link: ${response.status}`);
        }

        const data = await response.json();
        const token = typeof data?.token === "string" ? data.token : null;
        const uid = typeof data?.uid === "number" ? data.uid : null;
        const expiresIn = typeof data?.expires_in === "number" ? data.expires_in : null;
        if (!token || typeof uid !== "number" || !expiresIn) {
          throw new Error("invalid download token response");
        }
        setDownloadToken(token);
        setDownloadUid(uid);
        startDownloadCountdown(expiresIn);
      } catch (err) {
        console.error("获取下载链接失败", err);
        resetDownloadLinkState();
        setError("获取下载链接失败，请稍后重试");
      }
    },
    [isAuthenticated, authFetch, resetDownloadLinkState, setError, startDownloadCountdown],
  );

  const handleRequestDownloadLink = useCallback(async () => {
    if (!readyResumeId) return;
    await requestDownloadLink(readyResumeId, true);
  }, [readyResumeId, requestDownloadLink]);

  const handleDownloadFile = useCallback(() => {
    if (!readyResumeId) return;
    if (!downloadToken || !downloadUid || downloadCountdown <= 0) {
      setError("下载链接已过期，请重新获取");
      return;
    }

    const fname = `Resume-${readyResumeId}.pdf`;
    const url = API_ROUTES.RESUME.downloadFile(readyResumeId, {
      uid: downloadUid,
      token: downloadToken,
      download: "1",
      filename: fname,
    });

    resetDownloadLinkState();

    try {
      const win = window.open(url, "_blank");
      if (!win) {
        window.location.href = url;
      }
    } catch {
      window.location.href = url;
    }
  }, [
    downloadCountdown,
    downloadToken,
    downloadUid,
    readyResumeId,
    resetDownloadLinkState,
    setError,
  ]);

  const handleDownload = useCallback(async () => {
    if (!savedResumeId) {
      return;
    }

    if (!isAuthenticated) {
      setError("请先登录");
      return;
    }

    setError(null);
    generationCorrelationIdRef.current = null;
    setReadyResumeId(null);
    resetDownloadLinkState();
    setTaskStatus("pending");

    try {
      const response = await authFetch(API_ROUTES.RESUME.download(savedResumeId));

      if (!response.ok) {
        const msg = friendlyMessageForStatus(response.status, "pdf");
        if (response.status === 429) {
          setRateLimitMessage(msg);
          setRateLimitError("下载失败");
          setIsRateLimitModalOpen(true);
          setError(null);
        } else {
          setError(msg);
        }
        throw new Error("下载失败");
      }

      try {
        const data = await response.json();
        const correlationId =
          typeof data?.correlation_id === "string" ? data.correlation_id : null;
        if (correlationId) {
          generationCorrelationIdRef.current = correlationId;
        } else {
          const headerId = response.headers.get("X-Correlation-ID");
          generationCorrelationIdRef.current = headerId ? headerId : null;
        }
      } catch {
        const headerId = response.headers.get("X-Correlation-ID");
        generationCorrelationIdRef.current = headerId ? headerId : null;
      }
    } catch (err) {
      console.error("生成任务提交失败", err);
      if (!isRateLimitModalOpen) {
        setError((prev) => prev ?? "生成任务提交失败，请稍后重试");
      }
      resetPdfGenerationState();
    }
  }, [
    authFetch,
    isAuthenticated,
    isRateLimitModalOpen,
    resetDownloadLinkState,
    resetPdfGenerationState,
    savedResumeId,
    setError,
  ]);

  const handleWebSocketMessage = useCallback(
    (raw: string) => {
      try {
        const data = JSON.parse(raw);
        const status = typeof data?.status === "string" ? data.status : null;
        const resumeId = typeof data?.resume_id === "number" ? data.resume_id : null;
        const correlationId =
          typeof data?.correlation_id === "string" ? data.correlation_id : null;
        const errorCode =
          typeof data?.error_code === "number" ? data.error_code : null;
        const errorMessage =
          typeof data?.error_message === "string" ? data.error_message : "";
        const missingKeys = Array.isArray(data?.missing_keys)
          ? data.missing_keys.filter((v: unknown): v is string => typeof v === "string")
          : [];

        if (!status || typeof resumeId !== "number") {
          return;
        }

        const expectedCorrelationId = generationCorrelationIdRef.current;
        if (expectedCorrelationId) {
          if (!correlationId || correlationId !== expectedCorrelationId) {
            return;
          }
        }

        const currentResumeId = savedResumeIdRef.current;
        if (typeof currentResumeId === "number" && currentResumeId > 0) {
          if (resumeId !== currentResumeId) {
            return;
          }
        }

        if (status === "error") {
          resetPdfGenerationState();
          showAlert({
            title: titleForErrorCode(errorCode ?? ERROR_CODES.SYSTEM_ERROR),
            message: messageForErrorCode(
              errorCode ?? ERROR_CODES.SYSTEM_ERROR,
              errorMessage,
            ),
          });
          return;
        }

        if (status === "completed") {
          setTaskStatus("completed");
          setReadyResumeId(resumeId);
          resetDownloadLinkState();
          void requestDownloadLink(resumeId, true);

          if (errorCode === ERROR_CODES.RESOURCE_MISSING) {
            window.setTimeout(() => {
              showAlert({
                title: titleForErrorCode(ERROR_CODES.RESOURCE_MISSING),
                message:
                  missingKeys.length > 0
                    ? `${messageForErrorCode(ERROR_CODES.RESOURCE_MISSING)}（缺失数量：${missingKeys.length}）`
                    : messageForErrorCode(ERROR_CODES.RESOURCE_MISSING),
              });
            }, 2200);
          }

          generationCorrelationIdRef.current = null;
        }
      } catch (parseError) {
        console.error("Invalid WebSocket payload:", parseError);
      }
    },
    [
      requestDownloadLink,
      resetDownloadLinkState,
      resetPdfGenerationState,
      savedResumeIdRef,
      showAlert,
    ],
  );

  return {
    taskStatus,
    readyResumeId,
    downloadDeadline,
    downloadCountdown,
    downloadToken,
    downloadUid,
    generationProgress,
    isOverlayVisible,
    isRateLimitModalOpen,
    rateLimitMessage,
    rateLimitError,
    setIsRateLimitModalOpen,
    resetPdfGenerationState,
    handleDownload,
    handleRequestDownloadLink,
    handleDownloadFile,
    handleWebSocketMessage,
  };
}

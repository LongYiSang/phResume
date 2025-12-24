"use client";

import { useCallback, useEffect, useRef } from "react";

type UseWebSocketConnectionParams = {
  isAuthenticated: boolean;
  accessToken: string | null;
  resolveWebSocketURL: () => string | null;
  onMessage?: (raw: string) => void;
  onError?: (error: Error) => void;
};

export function useWebSocketConnection({
  isAuthenticated,
  accessToken,
  resolveWebSocketURL,
  onMessage,
  onError,
}: UseWebSocketConnectionParams) {
  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const connectRef = useRef<() => void>(() => {});
  const onMessageRef = useRef<typeof onMessage>(onMessage);
  const onErrorRef = useRef<typeof onError>(onError);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearReconnect();
    clearHeartbeat();
    const ws = socketRef.current;
    if (!ws) {
      return;
    }
    socketRef.current = null;
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.onopen = () => {
        try { ws.close(); } catch {}
      };
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      return;
    }
    try { ws.close(); } catch {}
  }, [clearHeartbeat, clearReconnect]);

  const scheduleReconnect = useCallback(() => {
    socketRef.current = null;
    clearHeartbeat();
    const attempt = Math.min(reconnectAttemptsRef.current + 1, 8);
    reconnectAttemptsRef.current = attempt;
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    clearReconnect();
    reconnectTimerRef.current = window.setTimeout(() => {
      if (isAuthenticated && accessToken) {
        connectRef.current();
      }
    }, delay);
  }, [accessToken, clearHeartbeat, clearReconnect, isAuthenticated]);

  const connect = useCallback(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }
    const wsURL = resolveWebSocketURL();
    if (!wsURL) {
      console.warn("WebSocket URL unavailable, skipping connection.");
      return;
    }
    const existing = socketRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    shouldReconnectRef.current = true;
    const ws = new WebSocket(wsURL);
    socketRef.current = ws;

    ws.onopen = () => {
      if (socketRef.current !== ws) {
        try { ws.close(); } catch {}
        return;
      }
      reconnectAttemptsRef.current = 0;
      ws.send(JSON.stringify({ type: "auth", token: accessToken }));
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      heartbeatTimerRef.current = window.setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }, 45000);
    };

    ws.onmessage = (event) => {
      if (socketRef.current !== ws) {
        return;
      }
      if (typeof event.data !== "string") {
        return;
      }
      onMessageRef.current?.(event.data);
    };

    ws.onclose = () => {
      if (socketRef.current !== ws) {
        return;
      }
      if (!shouldReconnectRef.current) {
        return;
      }
      scheduleReconnect();
    };

    ws.onerror = () => {
      if (socketRef.current !== ws) {
        return;
      }
      if (!shouldReconnectRef.current) {
        return;
      }
      onErrorRef.current?.(new Error("WebSocket error"));
      try { ws.close(); } catch {}
      scheduleReconnect();
    };
  }, [
    accessToken,
    isAuthenticated,
    resolveWebSocketURL,
    scheduleReconnect,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const sendMessage = useCallback(
    (payload: unknown) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socketRef.current.send(JSON.stringify(payload));
      } catch (err) {
        onErrorRef.current?.(err as Error);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      disconnect();
      return;
    }
    connect();
    return () => {
      disconnect();
    };
  }, [accessToken, connect, disconnect, isAuthenticated]);

  return {
    connect,
    disconnect,
    sendMessage,
  };
}

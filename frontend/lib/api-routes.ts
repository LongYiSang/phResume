const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
const API_ROOT = "/v1";

function trimSlashes(s: string) {
  return s.replace(/\/+$/g, "").replace(/^\/+/, "/");
}

function joinUrl(base: string, path: string) {
  const b = trimSlashes(base);
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`.replace(/\/+$/g, "");
}

const INTERNAL_API_BASE = process.env.NEXT_PUBLIC_INTERNAL_API_URL ?? "/api";

export const API_ROUTES = {
  AUTH: {
    register: () => joinUrl(API_BASE, `${API_ROOT}/auth/register`),
    login: () => joinUrl(API_BASE, `${API_ROOT}/auth/login`),
    refresh: () => joinUrl(API_BASE, `${API_ROOT}/auth/refresh`),
    logout: () => joinUrl(API_BASE, `${API_ROOT}/auth/logout`),
  },
  RESUME: {
    list: () => joinUrl(API_BASE, `${API_ROOT}/resume`),
    latest: () => joinUrl(API_BASE, `${API_ROOT}/resume/latest`),
    create: () => joinUrl(API_BASE, `${API_ROOT}/resume`),
    byId: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/resume/${id}`),
    update: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/resume/${id}`),
    delete: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/resume/${id}`),
    download: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/resume/${id}/download`),
    downloadLink: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/resume/${id}/download-link`),
  },
  ASSETS: {
    list: (params?: { limit?: number }) => {
      const limit = typeof params?.limit === "number" ? params.limit : undefined;
      const search = new URLSearchParams();
      if (typeof limit === "number") search.set("limit", String(limit));
      const qs = search.toString();
      const path = `${API_ROOT}/assets${qs ? `?${qs}` : ""}`;
      return joinUrl(API_BASE, path);
    },
    upload: () => joinUrl(API_BASE, `${API_ROOT}/assets/upload`),
    view: (key: string) => {
      const search = new URLSearchParams();
      search.set("key", key);
      const path = `${API_ROOT}/assets/view?${search.toString()}`;
      return joinUrl(API_BASE, path);
    },
  },
  TEMPLATES: {
    list: () => joinUrl(API_BASE, `${API_ROOT}/templates`),
    create: () => joinUrl(API_BASE, `${API_ROOT}/templates`),
    byId: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/templates/${id}`),
    delete: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/templates/${id}`),
    generatePreview: (id: number | string) => joinUrl(API_BASE, `${API_ROOT}/templates/${id}/generate-preview`),
  },
  PRINT: {
    resume: (id: number | string, token: string) => {
      const search = new URLSearchParams();
      search.set("internal_token", token);
      const path = `${API_ROOT}/resume/print/${id}?${search.toString()}`;
      return joinUrl(INTERNAL_API_BASE, path);
    },
    template: (id: number | string, token: string) => {
      const search = new URLSearchParams();
      search.set("internal_token", token);
      const path = `${API_ROOT}/templates/print/${id}?${search.toString()}`;
      return joinUrl(INTERNAL_API_BASE, path);
    },
  },
  resolveWsUrl: (): string | null => {
    if (typeof window === "undefined") return null;
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
    try {
      const isAbsolute = /^https?:\/\//i.test(base);
      if (!isAbsolute) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        return `${protocol}//${host}${joinUrl(base, `${API_ROOT}/ws`)}`;
      }
      const u = new URL(base);
      const protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.protocol = protocol;
      u.pathname = trimSlashes(`${u.pathname}${API_ROOT}/ws`);
      return u.toString();
    } catch {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      return `${protocol}//${host}${joinUrl("/api", `${API_ROOT}/ws`)}`;
    }
  },
} as const;

export type ApiRoutes = typeof API_ROUTES;
export { API_BASE, API_ROOT, INTERNAL_API_BASE, joinUrl };


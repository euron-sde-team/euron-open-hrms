import axios, { type AxiosError, type AxiosInstance } from "axios";
import { createTokenStore, type TokenStore } from "./token-store";
import { isWorkspaceSuspendedError } from "./errors";
import { filenameFromDisposition, saveBlob } from "./download";

export interface ApiClientOptions {
  /** localStorage key for the bearer token. */
  tokenKey: string;
  /**
   * API base URL including `/api`. A function is read on every request, which
   * is what lets a runtime-configured URL (window.__HRMS_ENV) take effect
   * without rebuilding the image.
   */
  baseURL: string | (() => string);
  /**
   * Called after a 401 has cleared the token. Defaults to sending the browser
   * to `/login` (unless it is already there).
   */
  onUnauthorized?: () => void;
  /**
   * Called on the 403 `WORKSPACE_SUSPENDED` answer. The token is KEPT: the
   * session is valid, the workspace is not, and the user should be told so
   * rather than bounced to a login form that would only fail again.
   */
  onWorkspaceSuspended?: () => void;
}

export interface Http {
  get: <T>(url: string, params?: Record<string, unknown>) => Promise<T>;
  post: <T>(url: string, body?: unknown) => Promise<T>;
  put: <T>(url: string, body?: unknown) => Promise<T>;
  patch: <T>(url: string, body?: unknown) => Promise<T>;
  del: <T>(url: string, body?: unknown) => Promise<T>;
  /** POST a file as multipart/form-data. `fields` are sent alongside it. */
  upload: <T>(url: string, file: File, fields?: Record<string, string>) => Promise<T>;
}

export interface ApiClient {
  /** The underlying axios instance, for the rare call that needs raw config. */
  api: AxiosInstance;
  http: Http;
  tokenStore: TokenStore;
  /**
   * Fetch a binary response and hand it to the browser as a download. Goes
   * through the same instance as everything else so the bearer token is
   * attached: a plain <a href> to an API route would arrive unauthenticated.
   */
  downloadFile: (
    url: string,
    fallbackName: string,
    opts?: { method?: "get" | "post"; body?: unknown; params?: Record<string, unknown> }
  ) => Promise<void>;
  /** Subscribe to suspended-workspace answers. Returns an unsubscribe function. */
  onWorkspaceSuspended: (listener: () => void) => () => void;
}

const stripSlash = (s: string) => s.replace(/\/+$/, "");

function defaultUnauthorized() {
  if (typeof window === "undefined") return;
  if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const tokenStore = createTokenStore(options.tokenKey);
  const resolveBase = () =>
    stripSlash(typeof options.baseURL === "function" ? options.baseURL() : options.baseURL);
  const suspendedListeners = new Set<() => void>();

  const api = axios.create();

  api.interceptors.request.use((config) => {
    config.baseURL = resolveBase();
    const token = tokenStore.get();
    if (token) config.headers.set("Authorization", `Bearer ${token}`);
    return config;
  });

  api.interceptors.response.use(
    (r) => r,
    (error: AxiosError) => {
      if (typeof window !== "undefined") {
        if (error.response?.status === 401) {
          // Expired or revoked session: forget it and send the user to sign in.
          tokenStore.clear();
          (options.onUnauthorized ?? defaultUnauthorized)();
        } else if (isWorkspaceSuspendedError(error)) {
          options.onWorkspaceSuspended?.();
          suspendedListeners.forEach((fn) => fn());
        }
      }
      return Promise.reject(error);
    }
  );

  const http: Http = {
    get: async (url, params) => (await api.get(url, { params })).data,
    post: async (url, body) => (await api.post(url, body)).data,
    put: async (url, body) => (await api.put(url, body)).data,
    patch: async (url, body) => (await api.patch(url, body)).data,
    del: async (url, body) => (await api.delete(url, body === undefined ? undefined : { data: body })).data,
    upload: async (url, file, fields = {}) => {
      const form = new FormData();
      form.append("file", file);
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      return (await api.post(url, form)).data;
    },
  };

  async function downloadFile(
    url: string,
    fallbackName: string,
    opts: { method?: "get" | "post"; body?: unknown; params?: Record<string, unknown> } = {}
  ): Promise<void> {
    const res =
      opts.method === "post"
        ? await api.post<Blob>(url, opts.body, { responseType: "blob", params: opts.params })
        : await api.get<Blob>(url, { responseType: "blob", params: opts.params });
    // Prefer the filename the server chose, if it sent one.
    const disposition = res.headers["content-disposition"];
    saveBlob(res.data, filenameFromDisposition(typeof disposition === "string" ? disposition : null, fallbackName));
  }

  return {
    api,
    http,
    tokenStore,
    downloadFile,
    onWorkspaceSuspended(listener) {
      suspendedListeners.add(listener);
      return () => {
        suspendedListeners.delete(listener);
      };
    },
  };
}

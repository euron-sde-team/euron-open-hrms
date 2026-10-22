import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

export interface StubResponse {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}

/**
 * An axios adapter that never touches the network. Records each request and
 * answers with `respond(config)`, rejecting non-2xx the way the real adapter does.
 */
export function stubAdapter(respond: (config: InternalAxiosRequestConfig) => StubResponse) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const r = respond(config);
    const response = {
      data: r.data,
      status: r.status,
      statusText: String(r.status),
      headers: new AxiosHeaders(r.headers ?? {}),
      config,
    };
    if (r.status >= 200 && r.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${r.status}`, "ERR_BAD_RESPONSE", config, null, response);
  };
  return { adapter, calls };
}

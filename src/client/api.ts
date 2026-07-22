let csrfToken = "";

export function setCsrfToken(value: string): void {
  csrfToken = value;
}

export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrfToken && !["GET", "HEAD"].includes(options.method || "GET")) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api${url}`, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `请求失败 (${response.status})` })) as { error?: string };
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") || "";
  return (type.includes("application/json") ? response.json() : response.text()) as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(url: string, body?: unknown) => request<T>(url, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  upload: <T>(url: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<T>(url, { method: "POST", body });
  }
};

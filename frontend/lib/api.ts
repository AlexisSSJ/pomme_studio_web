import { getToken, clearToken } from "./auth";

// Same-origin by default: Next.js rewrites proxy /api/v1/* to the backend
// (see next.config.js). NEXT_PUBLIC_API_URL overrides for split deployments.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function extractDetail(data: unknown, fallback: string): string {
  if (typeof data === "string") return data;

  if (Array.isArray(data)) {
    const messages = data
      .map((item) => {
        if (
          item !== null &&
          typeof item === "object" &&
          "msg" in item &&
          typeof item.msg === "string"
        ) {
          return item.msg;
        }
        return null;
      })
      .filter((message): message is string => message !== null);
    return messages.length > 0 ? messages.join("; ") : fallback;
  }

  if (data !== null && typeof data === "object") {
    if ("msg" in data && typeof data.msg === "string") return data.msg;
    if ("detail" in data) return extractDetail(data.detail, fallback);
  }

  return fallback;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  // With a FormData body the browser must set the Content-Type itself
  // (including the multipart boundary), so the JSON default is skipped.
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
  }

  return response;
}

/**
 * Fetch a protected binary file and wrap it in a blob URL.
 *
 * The returned URL must be revoked by the caller once it is no longer
 * needed (unmount, state change, or after triggering a download).
 */
export async function apiFetchBlobUrl(path: string): Promise<string> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data, "Error al cargar el archivo"));
  }
  return URL.createObjectURL(await res.blob());
}

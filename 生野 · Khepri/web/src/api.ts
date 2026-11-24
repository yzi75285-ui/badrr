import type { Capabilities, Media } from "./types";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError("服务没有连上。");
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && body.error && typeof body.error.message === "string"
      ? body.error.message
      : "请求没有完成。";
    throw new ApiError(message);
  }
  return body as T;
}

export function getMedia(): Promise<Media[]> {
  return request<{ media: Media[] }>("/api/media").then((body) => body.media);
}

export function getCapabilities(): Promise<Capabilities> {
  return request<Capabilities>("/api/capabilities");
}

export function uploadMedia(file: File, fields: Record<string, string>, idempotencyKey: string): Promise<Media> {
  const body = new FormData();
  body.set("file", file);
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return request<Media>("/api/media", {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function retryMedia(id: string, file?: File): Promise<Media> {
  if (!file) return request<Media>(`/api/media/${id}/retry`, { method: "POST" });
  const body = new FormData();
  body.set("file", file);
  return request<Media>(`/api/media/${id}/retry`, { method: "POST", body });
}

export function deleteMedia(id: string): Promise<void> {
  return request<void>(`/api/media/${id}`, { method: "DELETE" });
}

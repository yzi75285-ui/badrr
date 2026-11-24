import type { Asset, AssetInput } from "../shared/contracts";

function errorMessage(text: string, status: number): string {
  try {
    const body: unknown = JSON.parse(text);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    // A proxy or an unavailable server may return a non-JSON response.
  }
  return status === 413
    ? "文件过大，请选择较短的片段后重试。"
    : `请求失败（${status}），请稍后重试。`;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (!response.ok)
    throw new Error(errorMessage(await response.text(), response.status));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function uploadAsset(
  file: File,
  fields: AssetInput,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  idempotencyKey?: string,
): Promise<{ asset: Asset; reused?: boolean }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("上传已取消", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) form.append(key, value);
    }
    form.append("file", file);
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    xhr.open("POST", "/api/assets");
    xhr.timeout = 300_000;
    if (idempotencyKey) xhr.setRequestHeader("Idempotency-Key", idempotencyKey);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(errorMessage(xhr.responseText, xhr.status)));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as {
          asset?: Asset;
          reused?: boolean;
        };
        if (!body.asset?.id)
          throw new Error("服务器未返回素材记录，请刷新素材库后检查。");
        onProgress(100);
        resolve({ asset: body.asset, reused: body.reused });
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("无法读取上传结果，请刷新素材库后检查。"),
        );
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("上传连接中断，请检查服务端连接后重试。"));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error("上传超时，请检查网络并重试。"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("上传已取消", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(form);
  });
}

import { createReadStream, existsSync } from "node:fs";
import { open, mkdir, rename, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Binaries } from "./binaries.js";
import { isId, newId, newToken } from "./ids.js";
import { withMediaLock } from "./lock.js";
import { toPublic } from "./public.js";
import type { IngestQueue } from "./queue.js";
import { assertMedia, assertTask } from "./schema.js";
import type { Store } from "./store.js";
import { tokensMatch } from "./scrub.js";
import { emptyPreview, type StoredMedia, type TaskRecord } from "./types.js";
import { HttpError, parseFields, readUpload, safeFilename } from "./upload.js";
import { detectBuffer } from "./detect.js";

export type AppContext = {
  store: Store;
  queue: IngestQueue;
  binaries: Binaries;
  publicDir?: string;
  inflight: Set<string>;
};

export async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  try {
    await route(req, res, ctx);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: { code: "internal", message: "服务暂时无法完成这一步。" } });
  }
}

async function route(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, product: "khepri", stage: 1 });
    return;
  }
  if (method === "GET" && pathname === "/api/capabilities") {
    sendJson(res, 200, capabilities(ctx.binaries));
    return;
  }
  if (method === "GET" && pathname === "/api/media") {
    await sendMediaList(res, ctx);
    return;
  }
  if (method === "POST" && pathname === "/api/media") {
    await createMedia(req, res, ctx);
    return;
  }
  if (method === "GET" && pathname === "/api/tasks") {
    await sendTasks(res, ctx, url.searchParams.get("media_id"));
    return;
  }

  const mediaMatch = /^\/api\/media\/(med_[0-9a-hjkmnp-tv-z]{26})(?:\/(original|preview|retry))?$/.exec(pathname);
  if (mediaMatch) {
    const id = mediaMatch[1]!;
    const action = mediaMatch[2];
    if (!action && method === "GET") {
      await sendOneMedia(res, ctx, id);
      return;
    }
    if (!action && method === "DELETE") {
      await deleteMedia(res, ctx, id);
      return;
    }
    if (action === "retry" && method === "POST") {
      await retryMedia(req, res, ctx, id);
      return;
    }
    if ((action === "original" || action === "preview") && (method === "GET" || method === "HEAD")) {
      await sendContent(req, res, ctx, id, action, method === "HEAD");
      return;
    }
    throw new HttpError(405, "method_not_allowed", "这个地址不接受当前操作。");
  }

  if (/^\/api\/media\/[^/]+/.test(pathname)) throw new HttpError(404, "not_found", "没有这份素材。");
  if (pathname === "/api/tasks" && method !== "GET") throw new HttpError(405, "method_not_allowed", "任务在本段由上传创建。");
  const taskMatch = /^\/api\/tasks\/(task_[0-9a-hjkmnp-tv-z]{26})$/.exec(pathname);
  if (taskMatch && method === "GET") {
    await sendOneTask(res, ctx, taskMatch[1]!);
    return;
  }
  if (pathname.startsWith("/api/tasks/")) throw new HttpError(404, "not_found", "没有这张任务。");

  if (isCollection(pathname, method, res, "reports", "动作分析报告")) return;
  if (isCollection(pathname, method, res, "training-records", "训练记录")) return;
  if (isCollection(pathname, method, res, "memories", "个人记忆")) return;
  if (pathname.startsWith("/api/")) throw new HttpError(404, "not_found", "没有这个接口。");
  if (method === "GET" || method === "HEAD") {
    await sendStatic(req, res, ctx, pathname, method === "HEAD");
    return;
  }
  throw new HttpError(405, "method_not_allowed", "这个地址不接受当前操作。");
}

function capabilities(binaries: Binaries) {
  return {
    contract_version: 1,
    product: "khepri",
    stage: 1,
    stage_name: "网页与服务端素材流程",
    ffmpeg: binaries.ffmpeg !== null,
    ffprobe: binaries.ffprobe !== null,
    resources: [
      { name: "media", status: "implemented" },
      { name: "tasks", status: "implemented" },
      { name: "reports", status: "not_implemented" },
      { name: "training_records", status: "not_implemented" },
      { name: "memories", status: "not_implemented" },
    ],
    analysis: {
      status: "not_implemented",
      label: "动作分析尚未实现，不记为完成",
    },
  };
}

function isCollection(pathname: string, method: string, res: ServerResponse, name: string, label: string): boolean {
  const collection = name === "reports" ? "reports" : name === "training-records" ? "training_records" : "memories";
  if (pathname === `/api/${name}` && method === "GET") {
    sendJson(res, 200, { contract_version: 1, implementation: "not_implemented", [collection]: [] });
    return true;
  }
  if (pathname === `/api/${name}` && method === "POST") {
    sendJson(res, 501, { error: { code: "not_implemented", message: `${label}在后续阶段实现。第 1 段不把它记为完成。` } });
    return true;
  }
  if (pathname.startsWith(`/api/${name}/`)) {
    sendJson(res, 501, { error: { code: "not_implemented", message: `${label}在后续阶段实现。第 1 段不把它记为完成。` } });
    return true;
  }
  return false;
}

async function sendMediaList(res: ServerResponse, ctx: AppContext): Promise<void> {
  const media = await ctx.store.listMedia();
  const body = media.map((item) => {
    const pub = toPublic(item);
    assertMedia(pub);
    return pub;
  });
  sendJson(res, 200, { contract_version: 1, media: body });
}

async function sendOneMedia(res: ServerResponse, ctx: AppContext, id: string): Promise<void> {
  const media = await ctx.store.readMedia(id);
  if (!media) throw new HttpError(404, "not_found", "没有这份素材。");
  const pub = toPublic(media);
  assertMedia(pub);
  sendJson(res, 200, pub);
}

async function sendTasks(res: ServerResponse, ctx: AppContext, mediaId: string | null): Promise<void> {
  if (mediaId && !isId(mediaId, "med")) throw new HttpError(400, "invalid_request", "素材标识无法识别。");
  const tasks = (await ctx.store.listTasks()).filter((task) => !mediaId || task.media_id === mediaId);
  for (const task of tasks) assertTask(task);
  sendJson(res, 200, { contract_version: 1, tasks });
}

async function sendOneTask(res: ServerResponse, ctx: AppContext, id: string): Promise<void> {
  const task = await ctx.store.readTask(id);
  if (!task) throw new HttpError(404, "not_found", "没有这张任务。");
  assertTask(task);
  sendJson(res, 200, task);
}

async function createMedia(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const key = idempotencyKey(req);
  const existingId = ctx.store.findIdempotency(key);
  if (existingId) {
    const existing = await ctx.store.readMedia(existingId);
    if (existing) {
      req.resume();
      const pub = toPublic(existing);
      assertMedia(pub);
      sendJson(res, 200, pub, { "X-Idempotent-Replay": "true" });
      return;
    }
  }
  if (ctx.inflight.has(key)) throw new HttpError(409, "conflict", "同一上传仍在接收。");
  ctx.inflight.add(key);
  const tmp = await ctx.store.tempFile();
  try {
    const uploaded = await readUpload(req, tmp);
    const fields = parseFields(uploaded.fields);
    const detected = detectBuffer(await readStart(tmp, 64));
    const now = new Date().toISOString();
    const mediaId = newId("med");
    const taskId = newId("task");
    const media: StoredMedia = {
      contract_version: 1,
      media_id: mediaId,
      task_id: taskId,
      created_at: now,
      updated_at: now,
      sport: fields.sport,
      action: fields.action,
      capture: fields.capture,
      source: {
        original_filename: safeFilename(uploaded.file.filename),
        client_import_label: fields.clientImportLabel,
        byte_size: uploaded.file.byteSize,
        declared_content_type: uploaded.file.mimeType ? uploaded.file.mimeType.slice(0, 120) : null,
        content_type: detected.contentType,
        kind: detected.kind,
      },
      status: "received",
      failure: null,
      probe: null,
      preview: emptyPreview(),
      analysis: { status: "not_implemented", report_id: null },
      attempt: 1,
      access_token: newToken(),
      extension: detected.extension,
      preview_extension: null,
    };
    const task: TaskRecord = {
      contract_version: 1,
      task_id: taskId,
      kind: "ingest",
      media_id: mediaId,
      idempotency_key: key,
      status: "queued",
      attempt: 1,
      created_at: now,
      updated_at: now,
      error: null,
    };
    await mkdir(ctx.store.mediaDir(mediaId), { recursive: true });
    await rename(tmp, ctx.store.originalPath(media));
    await ctx.store.saveMedia(media);
    await ctx.store.saveTask(task);
    await ctx.store.rememberIdempotency(key, mediaId);
    ctx.queue.enqueue(mediaId);
    const pub = toPublic(media);
    assertMedia(pub);
    assertTask(task);
    sendJson(res, 201, pub, { Location: `/api/media/${mediaId}` });
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  } finally {
    ctx.inflight.delete(key);
  }
}

async function retryMedia(req: IncomingMessage, res: ServerResponse, ctx: AppContext, id: string): Promise<void> {
  const contentType = req.headers["content-type"] ?? "";
  const tmp = contentType.includes("multipart/form-data") ? await ctx.store.tempFile() : null;
  let uploaded: Awaited<ReturnType<typeof readUpload>> | null = null;
  if (tmp) {
    try {
      uploaded = await readUpload(req, tmp);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }
  try {
    const media = await withMediaLock(id, async () => {
      const current = await ctx.store.readMedia(id);
      if (!current) throw new HttpError(404, "not_found", "没有这份素材。");
      if (current.status === "preprocessing" || current.status === "receiving") {
        throw new HttpError(409, "conflict", "这份素材正在预处理，请稍后再试。");
      }
      if (current.status !== "failed") throw new HttpError(409, "conflict", "只有失败的素材可以重试。");
      const previous = ctx.store.previewPath(current);
      if (previous) await rm(previous, { force: true });
      current.preview = emptyPreview();
      current.preview_extension = null;
      if (uploaded && tmp) {
        await rm(ctx.store.originalPath(current), { force: true });
        const previous = ctx.store.previewPath(current);
        if (previous) await rm(previous, { force: true });
        const detected = detectBuffer(await readStart(tmp, 64));
        current.extension = detected.extension;
        current.probe = null;
        current.source.original_filename = safeFilename(uploaded.file.filename);
        current.source.declared_content_type = uploaded.file.mimeType ? uploaded.file.mimeType.slice(0, 120) : null;
        current.source.content_type = detected.contentType;
        current.source.kind = detected.kind;
        current.source.byte_size = uploaded.file.byteSize;
        await rename(tmp, ctx.store.originalPath(current));
      }
      current.status = "received";
      current.failure = null;
      current.attempt += 1;
      current.analysis = { status: "not_implemented", report_id: null };
      current.updated_at = new Date().toISOString();
      const task = await ctx.store.readTask(current.task_id);
      if (task) {
        task.status = "queued";
        task.error = null;
        task.attempt = current.attempt;
        task.updated_at = current.updated_at;
        await ctx.store.saveTask(task);
      }
      await ctx.store.saveMedia(current);
      return current;
    });
    ctx.queue.enqueue(id);
    const pub = toPublic(media);
    assertMedia(pub);
    sendJson(res, 202, pub);
  } catch (error) {
    if (tmp) await rm(tmp, { force: true });
    throw error;
  }
}

async function deleteMedia(res: ServerResponse, ctx: AppContext, id: string): Promise<void> {
  await withMediaLock(id, async () => {
    const media = await ctx.store.readMedia(id);
    if (!media) throw new HttpError(404, "not_found", "没有这份素材。");
    await ctx.store.deleteMedia(id);
    await ctx.store.deleteTask(media.task_id);
    await ctx.store.forgetIdempotency(id);
  });
  res.writeHead(204);
  res.end();
}

async function sendContent(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  id: string,
  kind: "original" | "preview",
  headOnly: boolean,
): Promise<void> {
  const media = await ctx.store.readMedia(id);
  if (!media) throw new HttpError(404, "not_found", "没有这份素材。");
  const access = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("access") ?? "";
  if (!tokensMatch(media.access_token, access)) throw new HttpError(403, "unauthorized", "没有这份文件的访问授权。");
  const file = kind === "original" ? ctx.store.originalPath(media) : ctx.store.previewPath(media);
  if (!file || !existsSync(file)) throw new HttpError(404, "not_found", kind === "preview" ? "预览还没有准备好。" : "原片不在了。");
  const contentType = kind === "preview" ? media.preview.content_type ?? "application/octet-stream" : media.source.content_type;
  await sendFile(req, res, file, contentType, headOnly, kind === "preview" ? "inline" : "attachment", media.source.original_filename);
}

async function sendStatic(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  pathname: string,
  headOnly: boolean,
): Promise<void> {
  if (!ctx.publicDir) throw new HttpError(404, "not_found", "页面还没有构建。开发时请打开网页开发地址。");
  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = path.normalize(path.join(ctx.publicDir, decodeURIComponent(requested)));
  if (!isInside(ctx.publicDir, target)) throw new HttpError(403, "unauthorized", "不能访问这个路径。");
  const file = existsSync(target) && (await stat(target)).isFile() ? target : path.join(ctx.publicDir, "index.html");
  if (!existsSync(file)) throw new HttpError(404, "not_found", "页面不存在。");
  if (!existsSync(target) && path.extname(requested)) throw new HttpError(404, "not_found", "页面不存在。");
  await sendFile(_req, res, file, mime(file), headOnly, "inline");
}

async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  contentType: string,
  headOnly: boolean,
  disposition: "inline" | "attachment",
  filename?: string,
): Promise<void> {
  const info = await stat(file);
  const size = info.size;
  const headers: Record<string, string | number> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0",
    "X-Khepri-Stage": "1",
  };
  if (filename) headers["Content-Disposition"] = contentDisposition(disposition, filename);
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
    });
    if (headOnly) {
      res.end();
      return;
    }
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "Content-Length": size });
  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replaceAll("\"", "");
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function mime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
    ".ico": "image/x-icon",
    ".map": "application/json",
    ".woff2": "font/woff2",
  };
  return types[ext] ?? "application/octet-stream";
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function idempotencyKey(req: IncomingMessage): string {
  const header = req.headers["idempotency-key"];
  const value = Array.isArray(header) ? header[0] : header;
  const key = (value ?? "").trim() || `gen_${newId("key").slice(4)}`;
  if (key.length > 200) throw new HttpError(400, "invalid_request", "幂等键过长。");
  return key;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Khepri-Stage": "1",
    ...extra,
  });
  res.end(payload);
}

async function readStart(file: string, length: number): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

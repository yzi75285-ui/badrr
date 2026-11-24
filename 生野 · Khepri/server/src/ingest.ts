import { open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Binaries } from "./binaries.js";
import { detectBuffer } from "./detect.js";
import { withMediaLock } from "./lock.js";
import { buildPreview } from "./preview.js";
import { probeFile } from "./probe.js";
import { ProcessError } from "./process.js";
import { failure, scrub } from "./scrub.js";
import type { Store } from "./store.js";
import { emptyPreview } from "./types.js";

export async function ingestMedia(store: Store, mediaId: string, binaries: Binaries): Promise<void> {
  await withMediaLock(mediaId, async () => {
    const media = await store.readMedia(mediaId);
    if (!media) return;
    if (media.status !== "received" && media.status !== "preprocessing") return;
    const task = await store.readTask(media.task_id);
    media.status = "preprocessing";
    media.failure = null;
    media.updated_at = new Date().toISOString();
    await store.saveMedia(media);
    if (task) {
      task.status = "running";
      task.error = null;
      task.updated_at = media.updated_at;
      await store.saveTask(task);
    }
    try {
      const located = store.originalPath(media);
      const fileStat = await stat(located).catch(() => null);
      if (!fileStat) throw new ProcessError("original_missing", "原片不在了，无法继续预处理。");
      if (fileStat.size === 0) throw new ProcessError("empty_file", "文件是空的。请更换文件后重试。");
      const detected = detectBuffer(await readStart(located, 64));
      if (detected.kind === "unknown") {
        throw new ProcessError("unsupported_type", "无法识别为照片或视频。请更换文件后重试。");
      }
      if (detected.extension !== media.extension) {
        const next = path.join(store.mediaDir(media.media_id), `original.${detected.extension}`);
        await rename(located, next);
        media.extension = detected.extension;
      }
      media.source.kind = detected.kind;
      media.source.content_type = detected.contentType;
      media.source.byte_size = fileStat.size;
      const probe = await probeFile({
        file: store.originalPath(media),
        kind: detected.kind,
        container: detected.container,
        speedAltered: media.capture.speed_altered,
        binaries,
      });
      media.probe = probe;
      const previous = store.previewPath(media);
      if (previous) await rm(previous, { force: true });
      const preview = await buildPreview({
        input: store.originalPath(media),
        directory: store.mediaDir(media.media_id),
        kind: detected.kind,
        contentType: detected.contentType,
        videoCodec: probe.video_codec,
        rotation: probe.rotation_degrees,
        binaries,
      });
      media.preview_extension = preview.extension;
      media.preview = {
        available: true,
        kind: detected.kind === "photo" ? "image" : "video",
        content_type: preview.contentType,
        method: preview.method,
      };
      media.status = "ready";
      media.failure = null;
      if (task) {
        task.status = "succeeded";
        task.error = null;
      }
    } catch (error) {
      const coded = error instanceof ProcessError
        ? { code: error.code, message: withDetail(error.message, error.detail, store.root) }
        : { code: "probe_failed", message: "预处理没有完成。" };
      media.preview = emptyPreview();
      media.preview_extension = null;
      media.status = "failed";
      media.failure = failure(coded.code, coded.message, [store.root]);
      if (task) {
        task.status = "failed";
        task.error = media.failure;
      }
    }
    media.analysis = { status: "not_implemented", report_id: null };
    media.updated_at = new Date().toISOString();
    if (task) {
      task.attempt = media.attempt;
      task.updated_at = media.updated_at;
      await store.saveTask(task);
    }
    await store.saveMedia(media);
  });
}

function withDetail(message: string, detail: string, root: string): string {
  const tail = scrub(detail, [root]).slice(-160).trim();
  return tail ? `${message} ${tail}` : message;
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

import { copyFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Binaries } from "./binaries.js";
import { ProcessError, runProcess } from "./process.js";

export async function buildPreview(options: {
  input: string;
  directory: string;
  kind: "photo" | "video";
  contentType: string;
  videoCodec: string | null;
  rotation: number | null;
  binaries: Binaries;
}): Promise<{ extension: string; contentType: string; method: "copy" | "transcode" }> {
  if (options.kind === "photo") return previewPhoto(options);
  return previewVideo(options);
}

async function previewPhoto(options: {
  input: string;
  directory: string;
  contentType: string;
  binaries: Binaries;
}): Promise<{ extension: string; contentType: string; method: "copy" | "transcode" }> {
  if (options.contentType === "image/heic" || options.contentType === "image/heif") {
    if (!options.binaries.ffmpeg) {
      throw new ProcessError("ffmpeg_missing", "HEIC 照片需要 ffmpeg 才能生成可回看的预览。原片已保存，可以稍后重试。");
    }
    await transcodePhoto(options.binaries.ffmpeg, options.input, path.join(options.directory, "preview.jpg"));
    return { extension: "jpg", contentType: "image/jpeg", method: "transcode" };
  }
  const extension = extensionFor(options.contentType);
  await copyFile(options.input, path.join(options.directory, `preview.${extension}`));
  return { extension, contentType: options.contentType, method: "copy" };
}

async function previewVideo(options: {
  input: string;
  directory: string;
  contentType: string;
  videoCodec: string | null;
  rotation: number | null;
  binaries: Binaries;
}): Promise<{ extension: string; contentType: string; method: "copy" | "transcode" }> {
  const output = path.join(options.directory, "preview.mp4");
  const upright = options.rotation === null || options.rotation === 0;
  const browserMp4 = options.contentType === "video/mp4" && isH264(options.videoCodec) && upright;
  if (!options.binaries.ffmpeg) {
    if (!browserMp4) {
      throw new ProcessError("ffmpeg_missing", "这部视频需要 ffmpeg 才能生成浏览器可回看的预览。原片已保存，可以稍后重试。");
    }
    await copyFile(options.input, output);
    return { extension: "mp4", contentType: "video/mp4", method: "copy" };
  }
  if (browserMp4) {
    try {
      await runFfmpeg(options.binaries.ffmpeg, ["-y", "-i", options.input, "-c", "copy", "-movflags", "+faststart", output], output);
      return { extension: "mp4", contentType: "video/mp4", method: "copy" };
    } catch {
      await rm(output, { force: true });
    }
  }
  await transcodeVideo(options.binaries.ffmpeg, options.input, output);
  return { extension: "mp4", contentType: "video/mp4", method: "transcode" };
}

function isH264(codec: string | null): boolean {
  return codec === "h264" || codec === "avc1";
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

async function transcodePhoto(ffmpeg: string, input: string, output: string): Promise<void> {
  await runFfmpeg(ffmpeg, ["-y", "-i", input, "-frames:v", "1", "-vf", "scale='min(1920,iw)':-2", output], output);
}

async function transcodeVideo(ffmpeg: string, input: string, output: string): Promise<void> {
  const withAudio = ["-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output];
  try {
    await runFfmpeg(ffmpeg, withAudio, output);
  } catch (error) {
    await rm(output, { force: true });
    const withoutAudio = ["-y", "-i", input, "-map", "0:v:0", "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output];
    try {
      await runFfmpeg(ffmpeg, withoutAudio, output);
    } catch (second) {
      const detail = second instanceof ProcessError ? second.detail : error instanceof ProcessError ? error.detail : "";
      throw new ProcessError("preview_failed", "预览没有生成。", detail);
    }
  }
}

async function runFfmpeg(ffmpeg: string, args: string[], output: string): Promise<void> {
  const result = await runProcess(ffmpeg, args, 180000);
  if (result.code !== 0) {
    await rm(output, { force: true });
    throw new ProcessError("preview_failed", "预览没有生成。", result.stderr);
  }
  const info = await stat(output).catch(() => null);
  if (!info || info.size === 0) {
    throw new ProcessError("preview_failed", "预览没有生成。");
  }
}

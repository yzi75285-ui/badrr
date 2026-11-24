import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import Busboy from "busboy";
import type { Capture, DominantSide, Sport, UploadFields } from "./types.js";

export const MAX_BYTES = 4 * 1024 * 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type UploadedFile = {
  tmpPath: string;
  filename: string;
  mimeType: string;
  byteSize: number;
};

export async function readUpload(req: IncomingMessage, tmpPath: string): Promise<{ fields: Record<string, string>; file: UploadedFile }> {
  const contentType = req.headers["content-type"];
  if (!contentType?.includes("multipart/form-data")) {
    throw new HttpError(400, "invalid_request", "请用表单上传照片或视频。");
  }
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let file: UploadedFile | null = null;
    let fileWrites: Promise<void> = Promise.resolve();
    let limited = false;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      void rm(tmpPath, { force: true }).finally(() => reject(error));
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_BYTES, fields: 24, fieldSize: 16 * 1024 },
      });
    } catch {
      fail(new HttpError(400, "invalid_request", "上传表单无法读取。"));
      return;
    }
    parser.on("field", (name: string, value: string) => {
      if (Object.keys(fields).length < 24) fields[name] = value;
    });
    parser.on("file", (_name: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      if (file) {
        stream.resume();
        return;
      }
      const output = createWriteStream(tmpPath);
      fileWrites = new Promise((done, rejectWrite) => {
        output.on("finish", () => done());
        output.on("error", rejectWrite);
      });
      stream.on("limit", () => {
        limited = true;
      });
      stream.pipe(output);
      file = {
        tmpPath,
        filename: info.filename || "upload",
        mimeType: info.mimeType || "",
        byteSize: 0,
      };
    });
    parser.on("filesLimit", () => fail(new HttpError(400, "invalid_request", "一次只能上传一个文件。")));
    parser.on("error", (error: unknown) => fail(error));
    parser.on("finish", () => {
      void fileWrites.then(async () => {
        if (settled) return;
        if (limited) {
          fail(new HttpError(413, "too_large", "文件超过 4 GB 上限。"));
          return;
        }
        if (!file) {
          fail(new HttpError(400, "invalid_request", "请选择照片或视频。"));
          return;
        }
        const info = await stat(tmpPath).catch(() => null);
        file.byteSize = info?.size ?? 0;
        settled = true;
        resolve({ fields, file });
      }).catch((error: unknown) => fail(error));
    });
    req.on("aborted", () => fail(new HttpError(400, "incomplete_upload", "上传未完成，服务端没有接收这份素材。")));
    req.pipe(parser);
  });
}

export function parseFields(fields: Record<string, string>): UploadFields {
  const sportRaw = (fields.sport ?? "").trim();
  if (sportRaw && sportRaw !== "basketball" && sportRaw !== "sprint") {
    throw new HttpError(400, "invalid_request", "运动只接受篮球、短跑，或留空。");
  }
  const capture: Capture = {
    taken_at: optionalText(fields.taken_at, 40, "拍摄时间"),
    device: optionalText(fields.device, 80, "设备"),
    viewpoint: optionalText(fields.viewpoint, 80, "视角"),
    location: optionalText(fields.location, 120, "地点"),
    distance_m: optionalNumber(fields.distance_m, 10000, "距离"),
    dominant_side: optionalSide(fields.dominant_side),
    declared_frame_rate: optionalNumber(fields.declared_frame_rate, 1000, "帧率"),
    speed_altered: optionalBool(fields.speed_altered),
    notes: optionalText(fields.notes, 2000, "备注"),
  };
  return {
    sport: (sportRaw || null) as Sport | null,
    action: optionalText(fields.action, 80, "动作"),
    capture,
    clientImportLabel: optionalText(fields.client_import_label, 200, "导入备注"),
  };
}

function optionalText(value: string | undefined, max: number, label: string): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length > max) throw new HttpError(400, "invalid_request", `${label}超过 ${max} 字。`);
  return text;
}

function optionalNumber(value: string | undefined, max: number, label: string): number | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > max) {
    throw new HttpError(400, "invalid_request", `${label}无法读取。`);
  }
  return number;
}

function optionalSide(value: string | undefined): DominantSide | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text === "left" || text === "right" || text === "unknown") return text;
  throw new HttpError(400, "invalid_request", "惯用侧只接受左手、右手、未知，或留空。");
}

function optionalBool(value: string | undefined): boolean | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text === "true") return true;
  if (text === "false") return false;
  throw new HttpError(400, "invalid_request", "变速说明只接受已变速、未变速，或留空。");
}

export function safeFilename(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "upload";
  const clean = base.replace(/[\u0000-\u001f]/g, "").trim();
  return (clean || "upload").slice(0, 260);
}

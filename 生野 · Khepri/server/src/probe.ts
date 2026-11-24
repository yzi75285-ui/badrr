import { open } from "node:fs/promises";
import type { Binaries } from "./binaries.js";
import { parseBmffFile, type BmffInfo } from "./parseBmff.js";
import { parseImage } from "./parseImage.js";
import { ProcessError, runProcess } from "./process.js";
import type { Probe, Timeline } from "./types.js";

const versions = new Map<string, string | null>();

export async function probeFile(options: {
  file: string;
  kind: "photo" | "video" | "unknown";
  container: string | null;
  speedAltered: boolean | null;
  binaries: Binaries;
}): Promise<Probe> {
  if (options.kind === "unknown") {
    throw new ProcessError("unsupported_type", "无法识别为照片或视频。请更换文件后重试。");
  }
  const head = await readStart(options.file, 2 * 1024 * 1024);
  const image = options.kind === "photo" ? parseImage(head) : null;
  const bmff = options.kind === "video" ? await parseBmffFile(options.file) : null;
  const external = options.binaries.ffprobe ? await ffprobe(options.binaries.ffprobe, options.file) : null;
  if (!image && !bmff && !external) {
    throw new ProcessError(
      options.binaries.ffprobe ? "probe_failed" : "ffmpeg_missing",
      options.binaries.ffprobe
        ? "没能读出编码、尺寸或时间信息。"
        : "这部素材需要 ffprobe 才能读取编码和时间。原片已保存，可以稍后重试。",
    );
  }
  return assemble({
    kind: options.kind,
    container: options.container,
    speedAltered: options.speedAltered,
    image,
    bmff,
    external,
    toolVersion: options.binaries.ffprobe ? await ffprobeVersion(options.binaries.ffprobe) : null,
  });
}

type ExternalProbe = {
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  duration: number | null;
  frameRate: number | null;
  frameCount: number | null;
  timeBase: string | null;
  timestamps: number[];
  make: string | null;
  model: string | null;
  playbackIntent: string | null;
};

function assemble(input: {
  kind: "photo" | "video";
  container: string | null;
  speedAltered: boolean | null;
  image: { width: number; height: number; rotationDegrees: number } | null;
  bmff: BmffInfo | null;
  external: ExternalProbe | null;
  toolVersion: string | null;
}): Probe {
  const bmff = input.bmff;
  const external = input.external;
  const width = whole(external?.width ?? input.image?.width ?? bmff?.width ?? null);
  const height = whole(external?.height ?? input.image?.height ?? bmff?.height ?? null);
  const rotation = normalize(external?.rotation ?? input.image?.rotationDegrees ?? bmff?.rotationDegrees ?? 0);
  const swapped = rotation === 90 || rotation === 270;
  const timestamps = external && external.timestamps.length > 0 ? external.timestamps : bmff?.frameTimestamps ?? [];
  const variable = external && external.timestamps.length > 1
    ? intervalsVary(external.timestamps)
    : bmff?.variableFrameRate ?? null;
  const interval = external && external.timestamps.length > 1
    ? intervalRange(external.timestamps)
    : { min: bmff?.intervalMin ?? null, max: bmff?.intervalMax ?? null };
  const frameRate = external?.frameRate ?? bmff?.frameRate ?? null;
  const slowHint = (frameRate ?? 0) >= 120 || input.speedAltered === true || bmff?.editRateAltered === true || external?.playbackIntent === "0";
  const timeline = decideTimeline({
    kind: input.kind,
    speedAltered: input.speedAltered,
    editRateAltered: bmff?.editRateAltered === true,
    hasTimestamps: input.kind === "video" && timestamps.length > 0,
    variable,
    playbackUnclear: external?.playbackIntent === "0",
  });
  const make = external?.make ?? null;
  const model = external?.model ?? null;
  const heic = (input.container ?? "").startsWith("hei") || input.container === "heif";
  const likely = heic || /apple/i.test(make ?? "") || /iphone/i.test(model ?? "");
  const notes: string[] = [];
  if (heic) notes.push("HEIC 容器常见于 iPhone，不能单独证明拍摄设备。");
  if (model) notes.push(`文件标记的设备是 ${clip(model, 60)}。`);
  if (external?.playbackIntent === "0") notes.push("检测到 Apple 全帧率播放标记，真实时间尚未确认。");
  if (external?.playbackIntent === "1") notes.push("文件标明按全帧率播放。");
  if ((frameRate ?? 0) >= 120) notes.push("帧率达到 120 或更高。若导出时已经放慢，真实时间不可恢复。");
  if (input.kind === "video" && input.speedAltered === null) notes.push("上传时没有说明是否变速。");
  const warnings: string[] = [];
  if (input.kind === "photo") warnings.push("照片只做静态观察，没有时间指标。");
  if (input.speedAltered === true || bmff?.editRateAltered) {
    warnings.push("不能恢复真实时间，后续不提供依赖真实时间的指标。");
  } else if (variable === true) {
    warnings.push("帧间隔不稳定，时间关系尚未确认。");
  }
  if ((bmff?.editListSegments ?? 0) > 1) warnings.push("编辑列表有多段，时间轴需要人工核对。");
  const tool = external ? "ffprobe" : input.image ? "image-header" : "bmff";
  return {
    probe_version: 1,
    probed_at: new Date().toISOString(),
    tool,
    tool_version: tool === "ffprobe" ? clip(input.toolVersion, 200) : null,
    container: clip(external?.container ?? bmff?.container ?? input.container, 80),
    video_codec: input.kind === "video" ? clip(external?.videoCodec ?? bmff?.videoCodec ?? null, 40) : null,
    audio_codec: clip(external?.audioCodec ?? bmff?.audioCodec ?? null, 40),
    width,
    height,
    rotation_degrees: rotation,
    display_width: width === null || height === null ? null : swapped ? height : width,
    display_height: width === null || height === null ? null : swapped ? width : height,
    duration_seconds: input.kind === "video" ? round6(external?.duration ?? bmff?.durationSeconds ?? null) : null,
    frame_rate: input.kind === "video" ? round6(frameRate) : null,
    frame_count: input.kind === "video" ? external?.frameCount ?? bmff?.frameCount ?? null : null,
    time_base: clip(external?.timeBase ?? bmff?.timeBase ?? null, 40),
    frame_timestamps: input.kind === "video"
      ? {
          sample: timestamps.slice(0, 24),
          sample_limit: 24,
          first: timestamps[0] ?? null,
          last: timestamps.length > 0 ? timestamps[timestamps.length - 1]! : null,
          interval_min: interval.min,
          interval_max: interval.max,
          variable,
          truncated: timestamps.length > 24 || bmff?.truncatedTimestamps === true || (external?.frameCount ?? 0) > timestamps.length,
        }
      : null,
    iphone: {
      likely,
      model: model ? clip(model, 80) : null,
      slow_motion_hint: slowHint,
      variable_frame_rate: input.kind === "video" ? variable : null,
      timeline,
      notes: notes.slice(0, 20).map((note) => clip(note, 300) ?? note),
    },
    warnings: warnings.slice(0, 20).map((note) => clip(note, 300) ?? note),
  };
}

function decideTimeline(input: {
  kind: "photo" | "video";
  speedAltered: boolean | null;
  editRateAltered: boolean;
  hasTimestamps: boolean;
  variable: boolean | null;
  playbackUnclear: boolean;
}): Timeline {
  if (input.kind === "photo") return "unknown";
  if (input.speedAltered === true || input.editRateAltered) return "unusable";
  if (!input.hasTimestamps || input.variable === true || input.playbackUnclear) return "unknown";
  return "real";
}

async function ffprobe(bin: string, file: string): Promise<ExternalProbe | null> {
  try {
    const result = await runProcess(bin, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], 30000);
    if (result.code !== 0) return null;
    const parsed = JSON.parse(result.stdout) as FfprobeJson;
    const frames = await ffprobeFrames(bin, file);
    return mapFfprobe(parsed, frames);
  } catch {
    return null;
  }
}

async function ffprobeFrames(bin: string, file: string): Promise<number[]> {
  try {
    const result = await runProcess(bin, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "frame=pts_time,best_effort_timestamp_time",
      "-read_intervals", "%+#20",
      "-of", "json",
      file,
    ], 30000);
    if (result.code !== 0) return [];
    const parsed = JSON.parse(result.stdout) as { frames?: Array<{ pts_time?: string; best_effort_timestamp_time?: string }> };
    return (parsed.frames ?? [])
      .map((frame) => Number(frame.best_effort_timestamp_time ?? frame.pts_time))
      .filter((value) => Number.isFinite(value))
      .slice(0, 24)
      .map((value) => round6(value) ?? value);
  } catch {
    return [];
  }
}

type FfprobeJson = {
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    time_base?: string;
    nb_frames?: string;
    duration?: string;
    tags?: Record<string, string>;
    side_data_list?: Array<{ rotation?: number }>;
  }>;
};

function mapFfprobe(parsed: FfprobeJson, timestamps: number[]): ExternalProbe {
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const tags = { ...parsed.format?.tags, ...video?.tags };
  const rotation = video?.side_data_list?.find((side) => side.rotation !== undefined)?.rotation
    ?? numberOrNull(tag(video?.tags, "rotate"));
  const nb = numberOrNull(video?.nb_frames);
  return {
    container: parsed.format?.format_name ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    rotation,
    duration: numberOrNull(video?.duration) ?? numberOrNull(parsed.format?.duration),
    frameRate: rate(video?.avg_frame_rate),
    frameCount: nb === null ? null : Math.round(nb),
    timeBase: video?.time_base ?? null,
    timestamps,
    make: tag(tags, "com.apple.quicktime.make") ?? tag(tags, "make"),
    model: tag(tags, "com.apple.quicktime.model") ?? tag(tags, "model"),
    playbackIntent: tag(tags, "com.apple.quicktime.full-frame-rate-playback-intent"),
  };
}

async function ffprobeVersion(bin: string): Promise<string | null> {
  if (versions.has(bin)) return versions.get(bin) ?? null;
  try {
    const result = await runProcess(bin, ["-version"], 5000);
    const line = result.stdout.split(/\r?\n/)[0]?.trim() || null;
    versions.set(bin, line);
    return line;
  } catch {
    versions.set(bin, null);
    return null;
  }
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

function tag(tags: Record<string, string> | undefined, key: string): string | null {
  if (!tags) return null;
  const found = Object.entries(tags).find(([name]) => name.toLowerCase() === key.toLowerCase());
  const value = found?.[1]?.trim();
  return value ? value : null;
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function rate(value: string | undefined): number | null {
  if (!value || !value.includes("/")) return numberOrNull(value);
  const [num, den] = value.split("/");
  const denominator = Number(den);
  if (!denominator) return null;
  const result = Number(num) / denominator;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function intervalsVary(samples: number[]): boolean {
  if (samples.length < 3) return false;
  const deltas = samples.slice(1).map((value, index) => value - samples[index]!);
  const min = Math.min(...deltas);
  const max = Math.max(...deltas);
  if (min <= 0) return true;
  return max / min > 1.05;
}

function intervalRange(samples: number[]): { min: number | null; max: number | null } {
  if (samples.length < 2) return { min: null, max: null };
  const deltas = samples.slice(1).map((value, index) => value - samples[index]!);
  return { min: round6(Math.min(...deltas)), max: round6(Math.max(...deltas)) };
}

function whole(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalize(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function round6(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 1e6) / 1e6;
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

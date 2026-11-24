import { open } from "node:fs/promises";

export type BmffInfo = {
  container: string;
  brands: string[];
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  rotationDegrees: number;
  durationSeconds: number | null;
  frameRate: number | null;
  frameCount: number | null;
  timeBase: string | null;
  frameTimestamps: number[];
  truncatedTimestamps: boolean;
  variableFrameRate: boolean | null;
  intervalMin: number | null;
  intervalMax: number | null;
  editRateAltered: boolean;
  editListSegments: number;
};

type Reader = {
  size: number;
  read(start: number, length: number): Promise<Buffer>;
  close(): Promise<void>;
};

type Child = {
  type: string;
  start: number;
  end: number;
  contentStart: number;
};

const SAMPLE_LIMIT = 24;

export async function parseBmffFile(file: string): Promise<BmffInfo | null> {
  const reader = await fileReader(file);
  try {
    return await parseBmff(reader);
  } finally {
    await reader.close();
  }
}

export async function parseBmff(reader: Reader): Promise<BmffInfo | null> {
  const top = await children(reader, 0, reader.size);
  const ftyp = top.find((box) => box.type === "ftyp");
  const moov = top.find((box) => box.type === "moov");
  if (!ftyp || !moov) return null;
  const brands = await readBrands(reader, ftyp);
  const moovChildren = await children(reader, moov.contentStart, moov.end);
  const tracks = [];
  for (const child of moovChildren) {
    if (child.type === "trak") tracks.push(await readTrack(reader, child));
  }
  const video = tracks.find((track) => track.handler === "vide" && track.codec);
  const audio = tracks.find((track) => track.handler === "soun" && track.codec);
  const chosen = video ?? tracks.find((track) => track.codec);
  if (!chosen) {
    return base(brands, null, audio?.codec ?? null);
  }
  return {
    ...base(brands, mapCodec(chosen.codec), audio ? mapCodec(audio.codec) : null),
    width: chosen.width,
    height: chosen.height,
    rotationDegrees: chosen.rotationDegrees,
    durationSeconds: chosen.durationSeconds,
    frameRate: chosen.frameRate,
    frameCount: chosen.frameCount,
    timeBase: chosen.timeBase,
    frameTimestamps: chosen.frameTimestamps,
    truncatedTimestamps: chosen.truncatedTimestamps,
    variableFrameRate: chosen.variableFrameRate,
    intervalMin: chosen.intervalMin,
    intervalMax: chosen.intervalMax,
    editRateAltered: chosen.editRateAltered,
    editListSegments: chosen.editListSegments,
  };
}

function base(brands: string[], videoCodec: string | null, audioCodec: string | null): BmffInfo {
  return {
    container: brands[0] ?? "mp4",
    brands,
    videoCodec,
    audioCodec,
    width: null,
    height: null,
    rotationDegrees: 0,
    durationSeconds: null,
    frameRate: null,
    frameCount: null,
    timeBase: null,
    frameTimestamps: [],
    truncatedTimestamps: false,
    variableFrameRate: null,
    intervalMin: null,
    intervalMax: null,
    editRateAltered: false,
    editListSegments: 0,
  };
}

type Track = {
  handler: string | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  rotationDegrees: number;
  durationSeconds: number | null;
  frameRate: number | null;
  frameCount: number | null;
  timeBase: string | null;
  frameTimestamps: number[];
  truncatedTimestamps: boolean;
  variableFrameRate: boolean | null;
  intervalMin: number | null;
  intervalMax: number | null;
  editRateAltered: boolean;
  editListSegments: number;
};

async function readTrack(reader: Reader, trak: Child): Promise<Track> {
  const nodes = await children(reader, trak.contentStart, trak.end);
  const tkhd = nodes.find((box) => box.type === "tkhd");
  const edts = nodes.find((box) => box.type === "edts");
  const mdia = nodes.find((box) => box.type === "mdia");
  const visual = tkhd ? await readTkhd(reader, tkhd) : { width: null, height: null, rotationDegrees: 0 };
  let editRateAltered = false;
  let editListSegments = 0;
  if (edts) {
    const edit = await readEdit(reader, edts);
    editRateAltered = edit.altered;
    editListSegments = edit.segments;
  }
  const empty: Track = {
    handler: null,
    codec: null,
    width: visual.width,
    height: visual.height,
    rotationDegrees: visual.rotationDegrees,
    durationSeconds: null,
    frameRate: null,
    frameCount: null,
    timeBase: null,
    frameTimestamps: [],
    truncatedTimestamps: false,
    variableFrameRate: null,
    intervalMin: null,
    intervalMax: null,
    editRateAltered,
    editListSegments,
  };
  if (!mdia) return empty;
  const media = await children(reader, mdia.contentStart, mdia.end);
  const hdlr = media.find((box) => box.type === "hdlr");
  const mdhd = media.find((box) => box.type === "mdhd");
  const minf = media.find((box) => box.type === "minf");
  const handler = hdlr ? await readHandler(reader, hdlr) : null;
  const timing = mdhd ? await readMdhd(reader, mdhd) : null;
  let codec: string | null = null;
  let samples = {
    frameTimestamps: [] as number[],
    truncatedTimestamps: false,
    frameCount: null as number | null,
    frameRate: null as number | null,
    variableFrameRate: null as boolean | null,
    intervalMin: null as number | null,
    intervalMax: null as number | null,
  };
  if (minf && timing) {
    const tables = await children(reader, minf.contentStart, minf.end);
    const stbl = tables.find((box) => box.type === "stbl");
    if (stbl) {
      const sampleBoxes = await children(reader, stbl.contentStart, stbl.end);
      const stsd = sampleBoxes.find((box) => box.type === "stsd");
      const stts = sampleBoxes.find((box) => box.type === "stts");
      if (stsd) codec = await readSampleCodec(reader, stsd);
      if (stts) samples = await readStts(reader, stts, timing.timescale);
    }
  }
  return {
    ...empty,
    handler,
    codec,
    durationSeconds: timing?.durationSeconds ?? null,
    timeBase: timing ? `1/${timing.timescale}` : null,
    ...samples,
  };
}

async function readBrands(reader: Reader, box: Child): Promise<string[]> {
  const data = await reader.read(box.contentStart, Math.min(64, box.end - box.contentStart));
  const brands: string[] = [];
  if (data.length >= 4) brands.push(data.toString("ascii", 0, 4).trim());
  for (let offset = 8; offset + 4 <= data.length; offset += 4) {
    const brand = data.toString("ascii", offset, offset + 4).trim();
    if (brand) brands.push(brand);
  }
  return brands;
}

async function readTkhd(
  reader: Reader,
  box: Child,
): Promise<{ width: number | null; height: number | null; rotationDegrees: number }> {
  const data = await reader.read(box.contentStart, Math.min(box.end - box.contentStart, 120));
  if (data.length < 84) return { width: null, height: null, rotationDegrees: 0 };
  const version = data[0] ?? 0;
  const widthOffset = version === 1 ? 88 : 76;
  if (data.length < widthOffset + 8) return { width: null, height: null, rotationDegrees: 0 };
  const matrixStart = widthOffset - 36;
  const a = data.readInt32BE(matrixStart);
  const b = data.readInt32BE(matrixStart + 4);
  const degrees = Math.round((Math.atan2(b / 65536, a / 65536) * 180) / Math.PI);
  return {
    width: Math.round(data.readUInt32BE(widthOffset) / 65536),
    height: Math.round(data.readUInt32BE(widthOffset + 4) / 65536),
    rotationDegrees: (degrees + 360) % 360,
  };
}

async function readHandler(reader: Reader, box: Child): Promise<string | null> {
  const data = await reader.read(box.contentStart, 12);
  if (data.length < 12) return null;
  return data.toString("ascii", 8, 12);
}

async function readMdhd(
  reader: Reader,
  box: Child,
): Promise<{ timescale: number; durationSeconds: number | null } | null> {
  const data = await reader.read(box.contentStart, Math.min(box.end - box.contentStart, 40));
  if (data.length < 20) return null;
  const version = data[0] ?? 0;
  const timescaleOffset = version === 1 ? 20 : 12;
  const durationOffset = timescaleOffset + 4;
  if (data.length < durationOffset + (version === 1 ? 8 : 4)) return null;
  const timescale = data.readUInt32BE(timescaleOffset);
  if (!timescale) return null;
  const duration = version === 1 ? Number(data.readBigUInt64BE(durationOffset)) : data.readUInt32BE(durationOffset);
  return { timescale, durationSeconds: duration / timescale };
}

async function readEdit(reader: Reader, edts: Child): Promise<{ altered: boolean; segments: number }> {
  const nodes = await children(reader, edts.contentStart, edts.end);
  const elst = nodes.find((box) => box.type === "elst");
  if (!elst) return { altered: false, segments: 0 };
  const data = await reader.read(elst.contentStart, Math.min(elst.end - elst.contentStart, 4096));
  if (data.length < 8) return { altered: false, segments: 0 };
  const version = data[0] ?? 0;
  const count = data.readUInt32BE(4);
  let offset = 8;
  let altered = false;
  let seen = 0;
  for (let i = 0; i < count && i < 8; i += 1) {
    const rateOffset = version === 1 ? offset + 16 : offset + 8;
    const step = version === 1 ? 20 : 12;
    if (rateOffset + 2 > data.length) break;
    if (data.readInt16BE(rateOffset) !== 1) altered = true;
    offset += step;
    seen += 1;
  }
  return { altered, segments: seen || count };
}

async function readSampleCodec(reader: Reader, stsd: Child): Promise<string | null> {
  const head = await reader.read(stsd.contentStart, 8);
  if (head.length < 8) return null;
  const count = head.readUInt32BE(4);
  let offset = stsd.contentStart + 8;
  let first: string | null = null;
  for (let i = 0; i < count && i < 4; i += 1) {
    const entry = await reader.read(offset, 8);
    if (entry.length < 8) break;
    const size = entry.readUInt32BE(0);
    const type = entry.toString("ascii", 4, 8);
    if (!first) first = type;
    if (size < 8) break;
    offset += size;
  }
  return first;
}

async function readStts(
  reader: Reader,
  stts: Child,
  timescale: number,
): Promise<{
  frameTimestamps: number[];
  truncatedTimestamps: boolean;
  frameCount: number | null;
  frameRate: number | null;
  variableFrameRate: boolean | null;
  intervalMin: number | null;
  intervalMax: number | null;
}> {
  const data = await reader.read(stts.contentStart, Math.min(stts.end - stts.contentStart, 65536));
  const empty = {
    frameTimestamps: [] as number[],
    truncatedTimestamps: false,
    frameCount: null,
    frameRate: null,
    variableFrameRate: null,
    intervalMin: null,
    intervalMax: null,
  };
  if (data.length < 8 || !timescale) return empty;
  const entries = data.readUInt32BE(4);
  let offset = 8;
  let time = 0;
  let frameCount = 0;
  let minDelta: number | null = null;
  let maxDelta: number | null = null;
  const samples: number[] = [];
  let truncated = false;
  for (let i = 0; i < entries; i += 1) {
    if (offset + 8 > data.length) {
      truncated = true;
      break;
    }
    const count = data.readUInt32BE(offset);
    const delta = data.readUInt32BE(offset + 4);
    offset += 8;
    if (count > 0) {
      minDelta = minDelta === null ? delta : Math.min(minDelta, delta);
      maxDelta = maxDelta === null ? delta : Math.max(maxDelta, delta);
    }
    if (samples.length < SAMPLE_LIMIT && count > 0) {
      const take = Math.min(SAMPLE_LIMIT - samples.length, count);
      for (let n = 0; n < take; n += 1) samples.push(round6((time + n * delta) / timescale));
    }
    if (count > SAMPLE_LIMIT) truncated = true;
    time += count * delta;
    frameCount += count;
  }
  if (frameCount > SAMPLE_LIMIT) truncated = true;
  const variable = minDelta !== null && maxDelta !== null ? minDelta !== maxDelta : null;
  const frameRate = minDelta && variable === false ? round6(timescale / minDelta) : null;
  return {
    frameTimestamps: samples,
    truncatedTimestamps: truncated,
    frameCount,
    frameRate,
    variableFrameRate: variable,
    intervalMin: minDelta === null ? null : round6(minDelta / timescale),
    intervalMax: maxDelta === null ? null : round6(maxDelta / timescale),
  };
}

async function children(reader: Reader, start: number, end: number): Promise<Child[]> {
  const boxes: Child[] = [];
  let offset = start;
  for (let guard = 0; guard < 10000 && offset + 8 <= end; guard += 1) {
    const header = await reader.read(offset, 16);
    if (header.length < 8) break;
    let size = header.readUInt32BE(0);
    const type = header.toString("ascii", 4, 8);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) break;
      size = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isFinite(size) || size < headerSize) break;
    const next = offset + size;
    if (next <= offset || next > end + 8) break;
    boxes.push({ type, start: offset, end: Math.min(next, end), contentStart: offset + headerSize });
    offset = next;
  }
  return boxes;
}

async function fileReader(file: string): Promise<Reader> {
  const handle = await open(file, "r");
  const stat = await handle.stat();
  return {
    size: stat.size,
    async read(start: number, length: number) {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    },
    async close() {
      await handle.close();
    },
  };
}

function mapCodec(type: string | null): string | null {
  if (!type) return null;
  const names: Record<string, string> = {
    avc1: "h264",
    avc3: "h264",
    hvc1: "hevc",
    hev1: "hevc",
    av01: "av1",
    vp09: "vp9",
    mp4a: "aac",
  };
  return names[type] ?? type;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

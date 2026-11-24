export type ImageInfo = {
  contentType: string;
  width: number;
  height: number;
  rotationDegrees: number;
};

export function parseImage(buffer: Buffer): ImageInfo | null {
  const png = parsePng(buffer);
  if (png) return png;
  const gif = parseGif(buffer);
  if (gif) return gif;
  const webp = parseWebp(buffer);
  if (webp) return webp;
  const jpeg = parseJpeg(buffer);
  if (jpeg) return jpeg;
  return null;
}

function parsePng(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return {
    contentType: "image/png",
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    rotationDegrees: 0,
  };
}

function parseGif(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 10) return null;
  const head = buffer.toString("ascii", 0, 6);
  if (head !== "GIF87a" && head !== "GIF89a") return null;
  return {
    contentType: "image/gif",
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
    rotationDegrees: 0,
  };
}

function parseWebp(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 16) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      contentType: "image/webp",
      width: 1 + (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16)),
      height: 1 + (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16)),
      rotationDegrees: 0,
    };
  }
  if (chunk === "VP8 ") {
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    if (start >= 0 && buffer.length >= start + 7) {
      return {
        contentType: "image/webp",
        width: buffer.readUInt16LE(start + 3) & 0x3fff,
        height: buffer.readUInt16LE(start + 5) & 0x3fff,
        rotationDegrees: 0,
      };
    }
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b0 = buffer[21]!;
    const b1 = buffer[22]!;
    const b2 = buffer[23]!;
    const b3 = buffer[24]!;
    return {
      contentType: "image/webp",
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      rotationDegrees: 0,
    };
  }
  return null;
}

function parseJpeg(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  let rotation = 0;
  let width: number | null = null;
  let height: number | null = null;
  for (let guard = 0; guard < 4000 && offset + 4 < buffer.length; guard += 1) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if (marker === 0xe1) {
      rotation = exifOrientation(buffer.subarray(offset + 4, offset + 2 + length)) ?? rotation;
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      height = buffer.readUInt16BE(offset + 5);
      width = buffer.readUInt16BE(offset + 7);
    }
    offset += 2 + length;
  }
  if (width === null || height === null) return null;
  return {
    contentType: "image/jpeg",
    width,
    height,
    rotationDegrees: orientationToDegrees(rotation),
  };
}

function orientationToDegrees(orientation: number): number {
  if (orientation === 3) return 180;
  if (orientation === 6) return 90;
  if (orientation === 8) return 270;
  return 0;
}

function exifOrientation(segment: Buffer): number | null {
  if (segment.length < 16 || segment.toString("ascii", 0, 4) !== "Exif") return null;
  const tiff = segment.subarray(6);
  if (tiff.length < 8) return null;
  const little = tiff.toString("ascii", 0, 2) === "II";
  const big = tiff.toString("ascii", 0, 2) === "MM";
  if (!little && !big) return null;
  const read16 = (offset: number) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const read32 = (offset: number) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  if (read16(2) !== 42) return null;
  const ifd = read32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = read16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (read16(entry) === 0x0112) return read16(entry + 8);
  }
  return null;
}

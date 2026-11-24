export type Detection = {
  kind: "photo" | "video" | "unknown";
  contentType: string;
  extension: string;
  container: string | null;
};

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heif", "mif1", "msf1"]);

export function detectBuffer(buffer: Buffer): Detection {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: "photo", contentType: "image/jpeg", extension: "jpg", container: "jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { kind: "photo", contentType: "image/png", extension: "png", container: "png" };
  }
  if (buffer.length >= 6) {
    const gif = buffer.toString("ascii", 0, 6);
    if (gif === "GIF87a" || gif === "GIF89a") {
      return { kind: "photo", contentType: "image/gif", extension: "gif", container: "gif" };
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { kind: "photo", contentType: "image/webp", extension: "webp", container: "webp" };
  }
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { kind: "video", contentType: "video/webm", extension: "webm", container: "webm" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (HEIC_BRANDS.has(brand)) {
      return { kind: "photo", contentType: "image/heic", extension: "heic", container: brand };
    }
    if (brand === "qt  ") {
      return { kind: "video", contentType: "video/quicktime", extension: "mov", container: "qt" };
    }
    return { kind: "video", contentType: "video/mp4", extension: "mp4", container: brand.trim() || "mp4" };
  }
  return { kind: "unknown", contentType: "application/octet-stream", extension: "bin", container: null };
}

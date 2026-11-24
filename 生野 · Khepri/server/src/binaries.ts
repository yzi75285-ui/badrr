import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type Binaries = {
  ffmpeg: string | null;
  ffprobe: string | null;
};

export function resolveBinaries(): Binaries {
  return {
    ffmpeg: binary("KHEPRI_FFMPEG", "ffmpeg-static", false),
    ffprobe: binary("KHEPRI_FFPROBE", "ffprobe-static", true),
  };
}

function binary(envName: string, pkg: string, nested: boolean): string | null {
  const fromEnv = process.env[envName];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const loaded = require(pkg) as string | { path?: string } | null;
    const candidate = nested || typeof loaded !== "string"
      ? loaded && typeof loaded === "object" ? loaded.path : null
      : loaded;
    if (typeof candidate === "string" && existsSync(candidate)) return candidate;
  } catch {
    return null;
  }
  return null;
}

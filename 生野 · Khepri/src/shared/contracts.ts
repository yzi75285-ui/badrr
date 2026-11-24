export type Sport = 'basketball' | 'sprint';
export type AssetStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type TimeBasis = 'unknown' | 'original' | 'edited';

export const ACTIONS: Record<Sport, string[]> = {
  basketball: ['投篮', '运球', '突破变向', '上篮', '起跳落地', '防守移动', '传球', '其他'],
  sprint: ['起跑', '加速', '最高速度', '速度维持', '弯道', '出弯', '全程', '其他'],
};
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface MediaMetadata {
  width: number;
  height: number;
  durationSec: number | null;
  fps: number | null;
  codec: string;
  container: string;
  rotation: number;
  hasAudio: boolean;
}

export interface Asset {
  id: string;
  title: string;
  originalName: string;
  sport: Sport;
  action: string;
  notes: string;
  timeBasis: TimeBasis;
  kind: 'image' | 'video' | 'unknown';
  status: AssetStatus;
  error: string | null;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  metadata: MediaMetadata | null;
  previewUrl: string | null;
  posterUrl: string | null;
  originalUrl: string;
}

export interface AssetInput {
  title?: string;
  sport: Sport;
  action: string;
  notes?: string;
  timeBasis?: TimeBasis;
}

export interface Health {
  status: 'ok';
  version: string;
  localOnly: true;
  maxUploadBytes: number;
  tools: { ffmpeg: boolean; ffprobe: boolean };
}

// API: GET /api/assets -> { assets: Asset[] }
// GET /api/assets/:id -> { asset: Asset }
// POST /api/assets multipart: file + AssetInput fields -> 201 { asset: Asset, reused?: boolean }
// PATCH /api/assets/:id JSON Partial<AssetInput> -> { asset: Asset }
// POST /api/assets/:id/retry -> { asset: Asset }
// DELETE /api/assets/:id -> 204
// GET /api/assets/:id/original|preview|poster -> media, byte ranges for playback
// GET /api/health -> Health
// Errors -> { error: string }, with appropriate 4xx/5xx status.

export type Sport = "basketball" | "sprint";

export type MediaStatus = "receiving" | "received" | "preprocessing" | "ready" | "failed";

export type DominantSide = "left" | "right" | "unknown";

export type Timeline = "real" | "unusable" | "unknown";

export type Failure = {
  code: string;
  message: string;
};

export type Capture = {
  taken_at: string | null;
  device: string | null;
  viewpoint: string | null;
  location: string | null;
  distance_m: number | null;
  dominant_side: DominantSide | null;
  declared_frame_rate: number | null;
  speed_altered: boolean | null;
  notes: string | null;
};

export type FrameTimestamps = {
  sample: number[];
  sample_limit: 24;
  first: number | null;
  last: number | null;
  interval_min: number | null;
  interval_max: number | null;
  variable: boolean | null;
  truncated: boolean;
};

export type IphoneProbe = {
  likely: boolean;
  model: string | null;
  slow_motion_hint: boolean;
  variable_frame_rate: boolean | null;
  timeline: Timeline;
  notes: string[];
};

export type Probe = {
  probe_version: 1;
  probed_at: string;
  tool: "ffprobe" | "bmff" | "image-header";
  tool_version: string | null;
  container: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  width: number | null;
  height: number | null;
  rotation_degrees: number | null;
  display_width: number | null;
  display_height: number | null;
  duration_seconds: number | null;
  frame_rate: number | null;
  frame_count: number | null;
  time_base: string | null;
  frame_timestamps: FrameTimestamps | null;
  iphone: IphoneProbe;
  warnings: string[];
};

export type PreviewInfo = {
  available: boolean;
  kind: "image" | "video" | null;
  content_type: string | null;
  method: "copy" | "transcode" | null;
};

export type AnalysisInfo = {
  status: "not_implemented";
  report_id: null;
};

export type MediaSource = {
  original_filename: string;
  client_import_label: string | null;
  byte_size: number;
  declared_content_type: string | null;
  content_type: string;
  kind: "photo" | "video" | "unknown";
};

export type StoredMedia = {
  contract_version: 1;
  media_id: string;
  task_id: string;
  created_at: string;
  updated_at: string;
  sport: Sport | null;
  action: string | null;
  capture: Capture;
  source: MediaSource;
  status: MediaStatus;
  failure: Failure | null;
  probe: Probe | null;
  preview: PreviewInfo;
  analysis: AnalysisInfo;
  attempt: number;
  access_token: string;
  extension: string;
  preview_extension: string | null;
};

export type PublicMedia = Omit<StoredMedia, "access_token" | "extension" | "preview_extension"> & {
  access: {
    original_url: string;
    preview_url: string | null;
  };
};

export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export type TaskRecord = {
  contract_version: 1;
  task_id: string;
  kind: "ingest";
  media_id: string;
  idempotency_key: string;
  status: TaskStatus;
  attempt: number;
  created_at: string;
  updated_at: string;
  error: Failure | null;
};

export type UploadFields = {
  sport: Sport | null;
  action: string | null;
  capture: Capture;
  clientImportLabel: string | null;
};

export function emptyCapture(): Capture {
  return {
    taken_at: null,
    device: null,
    viewpoint: null,
    location: null,
    distance_m: null,
    dominant_side: null,
    declared_frame_rate: null,
    speed_altered: null,
    notes: null,
  };
}

export function emptyPreview(): PreviewInfo {
  return {
    available: false,
    kind: null,
    content_type: null,
    method: null,
  };
}

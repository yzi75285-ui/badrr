export type MediaStatus = "receiving" | "received" | "preprocessing" | "ready" | "failed";

export type Capture = {
  taken_at: string | null;
  device: string | null;
  viewpoint: string | null;
  location: string | null;
  distance_m: number | null;
  dominant_side: "left" | "right" | "unknown" | null;
  declared_frame_rate: number | null;
  speed_altered: boolean | null;
  notes: string | null;
};

export type Media = {
  media_id: string;
  task_id: string;
  created_at: string;
  updated_at: string;
  sport: "basketball" | "sprint" | null;
  action: string | null;
  capture: Capture;
  source: {
    original_filename: string;
    client_import_label: string | null;
    byte_size: number;
    declared_content_type: string | null;
    content_type: string;
    kind: "photo" | "video" | "unknown";
  };
  status: MediaStatus;
  failure: { code: string; message: string } | null;
  probe: {
    tool: string;
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
    frame_timestamps: {
      sample: number[];
      truncated: boolean;
      variable: boolean | null;
      first: number | null;
      interval_min: number | null;
      interval_max: number | null;
    } | null;
    iphone: {
      likely: boolean;
      model: string | null;
      slow_motion_hint: boolean;
      timeline: "real" | "unusable" | "unknown";
      notes: string[];
    };
    warnings: string[];
  } | null;
  preview: {
    available: boolean;
    kind: "image" | "video" | null;
    content_type: string | null;
    method: "copy" | "transcode" | null;
  };
  analysis: {
    status: string;
    report_id: string | null;
  };
  access: {
    original_url: string;
    preview_url: string | null;
  };
  attempt: number;
};

export type Capabilities = {
  stage: number;
  stage_name: string;
  ffmpeg: boolean;
  ffprobe: boolean;
  analysis: { status: string; label: string };
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteMedia, getCapabilities, getMedia, retryMedia, uploadMedia } from "./api";
import type { Capabilities, Media, MediaStatus } from "./types";

const ACTIONS: Record<string, string[]> = {
  basketball: ["投篮", "运球", "突破变向", "上篮", "起跳与落地", "传球", "防守移动"],
  sprint: ["起跑", "加速", "最高速度", "速度维持", "弯道", "直道转换"],
};

const STATUS: Record<MediaStatus, string> = {
  receiving: "接收中",
  received: "已接收",
  preprocessing: "预处理中",
  ready: "可回看",
  failed: "失败",
};

const emptyForm = {
  sport: "",
  action: "",
  device: "",
  viewpoint: "",
  location: "",
  distance: "",
  side: "",
  fps: "",
  speed: "",
  takenAt: "",
  notes: "",
  label: "",
};

export function App() {
  const [media, setMedia] = useState<Media[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [items, caps] = await Promise.all([getMedia(), getCapabilities()]);
      setMedia(items);
      setCapabilities(caps);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取失败。");
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = media.some((item) => item.status === "received" || item.status === "preprocessing" || item.status === "receiving");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const selected = media.find((item) => item.media_id === selectedId) ?? null;
  const suggestions = ACTIONS[form.sport] ?? [...ACTIONS.basketball, ...ACTIONS.sprint];

  async function submit() {
    if (!file || uploading) return;
    setUploading(true);
    setFormError(null);
    try {
      const created = await uploadMedia(file, {
        sport: form.sport,
        action: form.action,
        device: form.device,
        viewpoint: form.viewpoint,
        location: form.location,
        distance_m: form.distance,
        dominant_side: form.side,
        declared_frame_rate: form.fps,
        speed_altered: form.speed,
        taken_at: form.takenAt,
        notes: form.notes,
        client_import_label: form.label,
      }, crypto.randomUUID());
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setSelectedId(created.media_id);
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setUploading(false);
    }
  }

  async function onRetry(next?: File) {
    if (!selected) return;
    setWorking(true);
    try {
      await retryMedia(selected.media_id, next);
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "重试失败。");
    } finally {
      setWorking(false);
    }
  }

  async function onDelete() {
    if (!selected) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setWorking(true);
    try {
      await deleteMedia(selected.media_id);
      setSelectedId(null);
      setConfirmDelete(false);
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <Sun />
          <div>
            <h1>KHEPRI</h1>
            <p>自用运动素材台。网页与服务端先行，手机端以后接入同一份素材和档案。</p>
          </div>
        </div>
        <ol className="steps">
          <li className="on">素材 · 本段</li>
          <li>分析 · 未开始</li>
          <li>对比 · 未开始</li>
          <li>复测 · 未开始</li>
        </ol>
      </header>
      {loadError ? <p className="banner" role="alert">{loadError} 启动方式写在 KHEPRI 的 README。</p> : null}
      <main className="desk">
        <section className="panel">
          <div className="panel-head">
            <h2>放入素材</h2>
            <button type="button" className="ghost" onClick={() => void refresh()}>刷新</button>
          </div>
          <label
            className={dragging ? "drop hot" : "drop"}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const next = event.dataTransfer.files[0];
              if (next) setFile(next);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*,.heic,.mov,.mp4,.m4v,.webm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? <strong>{file.name}</strong> : <strong>把照片或视频放在这里</strong>}
            <span>{file ? formatBytes(file.size) : "也可以点击选择。拍摄条件可以先空着。"}</span>
          </label>
          <div className="grid">
            <label>
              运动
              <select value={form.sport} onChange={(event) => setForm({ ...form, sport: event.target.value })}>
                <option value="">暂不填写</option>
                <option value="basketball">篮球</option>
                <option value="sprint">短跑</option>
              </select>
            </label>
            <label>
              动作
              <input list="actions" value={form.action} placeholder="可以留空" onChange={(event) => setForm({ ...form, action: event.target.value })} />
              <datalist id="actions">
                {suggestions.map((item) => <option key={item} value={item} />)}
              </datalist>
            </label>
          </div>
          <details>
            <summary>拍摄条件，未知就留空</summary>
            <div className="grid">
              <label>设备<input list="devices" value={form.device} onChange={(event) => setForm({ ...form, device: event.target.value })} /><datalist id="devices"><option value="iPhone 17 Pro" /></datalist></label>
              <label>视角<input list="views" value={form.viewpoint} onChange={(event) => setForm({ ...form, viewpoint: event.target.value })} /><datalist id="views"><option value="侧面" /><option value="正面" /><option value="斜前方" /><option value="后方" /></datalist></label>
              <label>地点<input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
              <label>距离（米）<input inputMode="decimal" value={form.distance} onChange={(event) => setForm({ ...form, distance: event.target.value })} /></label>
              <label>惯用侧
                <select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value })}>
                  <option value="">未填写</option>
                  <option value="left">左手</option>
                  <option value="right">右手</option>
                  <option value="unknown">未知</option>
                </select>
              </label>
              <label>标称帧率<input inputMode="decimal" value={form.fps} onChange={(event) => setForm({ ...form, fps: event.target.value })} /></label>
              <label>变速或慢放
                <select value={form.speed} onChange={(event) => setForm({ ...form, speed: event.target.value })}>
                  <option value="">未填写</option>
                  <option value="false">未变速</option>
                  <option value="true">已变速或慢放</option>
                </select>
              </label>
              <label>拍摄时间<input type="datetime-local" value={form.takenAt} onChange={(event) => setForm({ ...form, takenAt: event.target.value })} /></label>
            </div>
            <label className="stack">导入备注
              <input value={form.label} placeholder="只记你自己的说明，不必填路径" onChange={(event) => setForm({ ...form, label: event.target.value })} />
            </label>
            <label className="stack">备注
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
          </details>
          {formError ? <p className="banner" role="alert">{formError}</p> : null}
          <button type="button" className="primary" disabled={!file || uploading} onClick={() => void submit()}>
            {uploading ? "正在交给服务端…" : "保存到服务端"}
          </button>
          <div className="panel-head library-head">
            <h2>素材 {media.length ? media.length : ""}</h2>
          </div>
          {booting ? <p className="muted">正在读取素材。</p> : null}
          {!booting && media.length === 0 ? <p className="muted">还没有素材。上传一张篮球或短跑的照片，或一段视频。</p> : null}
          <div className="list">
            {media.map((item) => (
              <button
                key={item.media_id}
                type="button"
                className={item.media_id === selectedId ? "item on" : "item"}
                onClick={() => {
                  setSelectedId(item.media_id);
                  setConfirmDelete(false);
                }}
              >
                <span>
                  <strong>{sportLabel(item.sport)} · {item.action ?? "未填动作"}</strong>
                  <small>{item.source.original_filename}</small>
                </span>
                <em className={pillClass(item.status)}>{STATUS[item.status]}</em>
              </button>
            ))}
          </div>
        </section>
        <Inspector
          media={selected}
          capabilities={capabilities}
          confirmDelete={confirmDelete}
          working={working}
          onRetry={(next) => void onRetry(next)}
          onDelete={() => void onDelete()}
        />
      </main>
    </div>
  );
}

function Inspector(props: {
  media: Media | null;
  capabilities: Capabilities | null;
  confirmDelete: boolean;
  working: boolean;
  onRetry: (file?: File) => void;
  onDelete: () => void;
}) {
  const { media } = props;
  const preview = useMemo(() => versioned(media?.access.preview_url ?? null, media?.updated_at ?? ""), [media]);
  if (!media) {
    return (
      <section className="panel inspector empty-inspector">
        <h2>回看</h2>
        <p>选择左侧一份素材。服务端确认接收之后，原片会留下来；刷新或重启后还能找到。</p>
        <p className="quiet">动作分析尚未实现，不记为完成。</p>
      </section>
    );
  }
  const probe = media.probe;
  return (
    <section className="panel inspector">
      <div className="panel-head">
        <div>
          <h2>{media.source.original_filename}</h2>
          <p className="muted">已于 {formatWhen(media.created_at)} 确认接收 · 第 {media.attempt} 次处理</p>
        </div>
        <em className={pillClass(media.status)}>{STATUS[media.status]}</em>
      </div>
      {media.failure ? (
        <div className="callout warn" role="alert">
          <strong>失败</strong>
          <p>{media.failure.message}</p>
          <div className="row">
            <button type="button" className="primary" disabled={props.working} onClick={() => props.onRetry()}>重新预处理</button>
            <label className="ghost file-button">
              更换文件后再试
              <input type="file" accept="image/*,video/*,.heic,.mov,.mp4" onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) props.onRetry(next);
              }} />
            </label>
          </div>
        </div>
      ) : null}
      <div className="player">
        {preview && media.preview.kind === "image" ? <img src={preview} alt={media.source.original_filename} /> : null}
        {preview && media.preview.kind === "video" ? <video key={preview} src={preview} controls playsInline /> : null}
        {!preview ? <p>还没有可回看的预览。{media.status === "preprocessing" || media.status === "received" ? "预处理还在进行，页面关掉也不会取消。" : ""}</p> : null}
      </div>
      <div className="row">
        <a href={media.access.original_url}>下载原片</a>
        {preview ? <a href={preview}>打开预览</a> : null}
      </div>
      <dl className="facts">
        <div><dt>运动</dt><dd>{sportLabel(media.sport)}</dd></div>
        <div><dt>动作</dt><dd>{media.action ?? "未填写"}</dd></div>
        <div><dt>大小</dt><dd>{formatBytes(media.source.byte_size)}</dd></div>
        <div><dt>类型</dt><dd>{kindLabel(media.source.kind)} · {media.source.content_type}</dd></div>
        <Fact label="设备" value={media.capture.device} />
        <Fact label="视角" value={media.capture.viewpoint} />
        <Fact label="地点" value={media.capture.location} />
        <Fact label="距离" value={media.capture.distance_m === null ? null : `${media.capture.distance_m} 米`} />
        <Fact label="惯用侧" value={sideLabel(media.capture.dominant_side)} />
        <Fact label="标称帧率" value={media.capture.declared_frame_rate === null ? null : String(media.capture.declared_frame_rate)} />
        <Fact label="变速" value={speedLabel(media.capture.speed_altered)} />
        <Fact label="拍摄时间" value={media.capture.taken_at} />
        <Fact label="导入备注" value={media.capture && media.source.client_import_label} />
        <Fact label="备注" value={media.capture.notes} />
      </dl>
      {probe ? (
        <>
          <h3>预处理</h3>
          <dl className="facts">
            <Fact label="容器" value={probe.container} />
            <Fact label="视频编码" value={probe.video_codec} />
            <Fact label="音频编码" value={probe.audio_codec} />
            <Fact label="画面" value={sizeText(probe)} />
            <Fact label="旋转" value={probe.rotation_degrees === null ? null : `${probe.rotation_degrees}°`} />
            <Fact label="时长" value={probe.duration_seconds === null ? null : formatDuration(probe.duration_seconds)} />
            <Fact label="帧率" value={probe.frame_rate === null ? null : String(probe.frame_rate)} />
            <div><dt>时间轴</dt><dd>{timelineLabel(probe.iphone.timeline)}</dd></div>
            <div><dt>iPhone 标记</dt><dd>{probe.iphone.likely ? probe.iphone.model ?? "像是 Apple 设备" : "未发现"}</dd></div>
            <Fact label="帧时间戳" value={stampText(probe.frame_timestamps)} />
          </dl>
          {probe.warnings.length > 0 || probe.iphone.notes.length > 0 ? (
            <ul className="notes">
              {probe.warnings.map((item) => <li key={item}>{item}</li>)}
              {probe.iphone.notes.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </>
      ) : null}
      <div className="callout quiet">
        <strong>{props.capabilities?.analysis.label ?? "动作分析尚未实现，不记为完成。"}</strong>
        <p>对比、练习和复测留在后面的阶段。这里不会把它们显示成已经完成。</p>
        {props.capabilities && !props.capabilities.ffmpeg ? <p>当前没有 ffmpeg。普通照片仍可回看；部分视频需要它生成预览，失败后可以重试。</p> : null}
      </div>
      <p className="ids">素材 {media.media_id}<br />任务 {media.task_id}</p>
      <button type="button" className="danger" disabled={props.working} onClick={props.onDelete}>
        {props.confirmDelete ? "再次点击删除" : "删除这份素材"}
      </button>
    </section>
  );
}

function Fact(props: { label: string; value: string | null }) {
  return <div><dt>{props.label}</dt><dd>{props.value && props.value.trim() ? props.value : "未填写"}</dd></div>;
}

function Sun() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      <path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.5 6.5l2.8 2.8M22.7 22.7l2.8 2.8M25.5 6.5l-2.8 2.8M9.3 22.7l-2.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function versioned(url: string | null, stamp: string): string | null {
  if (!url) return null;
  return `${url}&v=${encodeURIComponent(stamp)}`;
}

function sportLabel(sport: Media["sport"]): string {
  if (sport === "basketball") return "篮球";
  if (sport === "sprint") return "短跑";
  return "未填运动";
}

function kindLabel(kind: Media["source"]["kind"]): string {
  if (kind === "photo") return "照片";
  if (kind === "video") return "视频";
  return "未识别";
}

function sideLabel(side: Media["capture"]["dominant_side"]): string | null {
  if (side === "left") return "左手";
  if (side === "right") return "右手";
  if (side === "unknown") return "未知";
  return null;
}

function speedLabel(value: boolean | null): string | null {
  if (value === true) return "已标明变速或慢放";
  if (value === false) return "未变速";
  return null;
}

function timelineLabel(value: "real" | "unusable" | "unknown"): string {
  if (value === "real") return "可按真实时间使用";
  if (value === "unusable") return "不能恢复真实时间";
  return "时间关系尚未确认";
}

function sizeText(probe: NonNullable<Media["probe"]>): string | null {
  if (probe.display_width === null || probe.display_height === null) return null;
  return `${probe.display_width} × ${probe.display_height}`;
}

function stampText(stamps: NonNullable<Media["probe"]>["frame_timestamps"]): string | null {
  if (!stamps || stamps.sample.length === 0) return null;
  const vary = stamps.variable ? "间隔不稳定" : "间隔稳定";
  const sampled = stamps.truncated ? `抽样 ${stamps.sample.length} 帧` : `${stamps.sample.length} 帧`;
  return `${sampled}，从 ${stamps.first ?? 0} 秒起，${vary}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(2)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} 分 ${String(rest).padStart(2, "0")} 秒`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function pillClass(status: MediaStatus): string {
  if (status === "ready") return "pill ready";
  if (status === "failed") return "pill failed";
  if (status === "received") return "pill received";
  return "pill busy";
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileImage,
  Film,
  FolderOpen,
  ImagePlus,
  Info,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  ACTIONS,
  MAX_UPLOAD_BYTES,
  type Asset,
  type AssetInput,
  type AssetStatus,
  type Health,
  type Sport,
  type TimeBasis,
} from "../shared/contracts";
import { api, uploadAsset } from "./api";

const sportName = (sport: Sport) => (sport === "basketball" ? "篮球" : "短跑");
const statusName: Record<AssetStatus, string> = {
  queued: "等待预处理",
  processing: "正在预处理",
  ready: "可以回看",
  failed: "预处理失败",
};
const bytes = (n: number) =>
  n >= 1024 ** 2
    ? `${(n / 1024 ** 2).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
const duration = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `${Math.floor(n / 60)
        .toString()
        .padStart(2, "0")}:${Math.floor(n % 60)
        .toString()
        .padStart(2, "0")}`;
const date = (value: string) =>
  new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试。";

function Modal({
  title,
  subtitle,
  children,
  onClose,
  large = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  large?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${large ? "dialog-large" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-content">
        <div className="dialog-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="关闭窗口"
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function MetadataFields({
  value,
  setValue,
}: {
  value: AssetInput;
  setValue: (next: AssetInput) => void;
}) {
  return (
    <div className="form-fields">
      <label>
        素材标题<span className="optional">选填</span>
        <input
          maxLength={160}
          value={value.title ?? ""}
          onChange={(e) => setValue({ ...value, title: e.target.value })}
          placeholder="例如：周二的定点投篮"
        />
      </label>
      <div className="form-row">
        <label>
          运动
          <select
            value={value.sport}
            onChange={(e) => {
              const sport = e.target.value as Sport;
              setValue({ ...value, sport, action: ACTIONS[sport][0] });
            }}
          >
            <option value="basketball">篮球</option>
            <option value="sprint">短跑 · 60 / 100 / 200 米</option>
          </select>
        </label>
        <label>
          动作或阶段
          <select
            value={value.action}
            onChange={(e) => setValue({ ...value, action: e.target.value })}
          >
            {ACTIONS[value.sport].map((action) => (
              <option key={action}>{action}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        视频时间来源
        <select
          value={value.timeBasis ?? "unknown"}
          onChange={(e) =>
            setValue({ ...value, timeBasis: e.target.value as TimeBasis })
          }
        >
          <option value="unknown">暂不确定 / 不适用</option>
          <option value="original">原始录制，未做速度调整</option>
          <option value="edited">慢放、变速或经过剪辑</option>
        </select>
      </label>
      <label>
        拍摄与训练说明<span className="optional">选填</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={value.notes ?? ""}
          onChange={(e) => setValue({ ...value, notes: e.target.value })}
          placeholder="记录机位、拍摄距离、训练目标或当时的感受…"
        />
      </label>
    </div>
  );
}

function UploadDialog({
  onClose,
  onUploaded,
}: {
  onClose: (message?: string) => void;
  onUploaded: (asset: Asset) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const key = useRef(crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fields, setFields] = useState<AssetInput>({
    sport: "basketball",
    action: "投篮",
    timeBasis: "unknown",
    title: "",
    notes: "",
  });
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => controller.current?.abort(), []);
  const pick = (next?: File) => {
    if (!next) return;
    setFile(null);
    setProgress(0);
    key.current = crypto.randomUUID();
    if (next.size > MAX_UPLOAD_BYTES) {
      setError("单个文件不能超过 512 MB，请剪选较短片段。");
      return;
    }
    if (!/\.(jpe?g|png|webp|heic|heif|mp4|mov|m4v|webm)$/i.test(next.name)) {
      setError("请选择支持的照片或视频格式。");
      return;
    }
    setFile(next);
    setError("");
    setProgress(0);
    key.current = crypto.randomUUID();
  };
  const dismiss = () =>
    onClose(
      busy
        ? "已停止等待。服务端已接收的素材仍会保存，请先查看素材库再重新上传。"
        : undefined,
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const result = await uploadAsset(
        file,
        fields,
        setProgress,
        controller.current.signal,
        key.current,
      );
      onUploaded(result.asset);
    } catch (err) {
      if (!controller.current.signal.aborted) setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="留下今天的动作"
      subtitle="上传原始照片或视频，为下一次观察保留依据。"
      onClose={dismiss}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <input
            ref={input}
            type="file"
            className="visually-hidden"
            tabIndex={-1}
            accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.m4v,.webm"
            aria-label="素材文件"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <button
            type="button"
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0]);
            }}
          >
            <span className="drop-icon">
              {file ? <Check size={25} /> : <Upload size={26} />}
            </span>
            <strong>{file ? file.name : "选择文件，或拖拽到这里"}</strong>
            <span>
              {file
                ? `${bytes(file.size)} · 点击重新选择`
                : "照片 / 视频 · 单文件最大 512 MB"}
            </span>
          </button>
          <p className="format-hint">
            JPEG、PNG、WebP、MP4、MOV、WebM。HEIC 可保存原片，预览需导出 JPEG。
          </p>
          <MetadataFields
            value={fields}
            setValue={(next) => {
              setFields(next);
              key.current = crypto.randomUUID();
            }}
          />
        </fieldset>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <div className="upload-progress" role="status">
            <div>
              <span>{progress >= 100 ? "正在确认接收…" : "正在上传原片"}</span>
              <b>{progress}%</b>
            </div>
            <progress value={progress} max={100} />
          </div>
        )}
        <div className="dialog-footer">
          <span>
            <Info size={15} /> 原片将保存在本机
          </span>
          <button className="button secondary" type="button" onClick={dismiss}>
            {busy ? (progress >= 100 ? "停止等待" : "停止上传") : "取消"}
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={!file || busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Upload size={17} />
            )}
            {busy ? "上传中" : "保存素材"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetailDialog({
  asset,
  onClose,
  onChange,
  onDeleted,
}: {
  asset: Asset;
  onClose: () => void;
  onChange: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [fields, setFields] = useState<AssetInput>({
    title: asset.title,
    sport: asset.sport,
    action: asset.action,
    notes: asset.notes,
    timeBasis: asset.timeBasis,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (action: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={asset.title}
      subtitle={`${sportName(asset.sport)} / ${asset.action} · ${new Date(asset.createdAt).toLocaleString("zh-CN")}`}
      onClose={onClose}
      large
    >
      <div className="detail-layout">
        <div className="detail-media">
          <div className="preview-stage">
            {asset.status === "ready" && asset.previewUrl ? (
              asset.kind === "video" ? (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={asset.previewUrl}
                  poster={asset.posterUrl ?? undefined}
                  aria-label="素材视频预览"
                />
              ) : (
                <img src={asset.previewUrl} alt={asset.title} />
              )
            ) : (
              <div className="preview-wait">
                {asset.status === "failed" ? (
                  <CircleHelp size={36} />
                ) : (
                  <LoaderCircle size={36} className="spin" />
                )}
                <h3>{statusName[asset.status]}</h3>
                <p>
                  {asset.error ?? "原片已保存。预处理完成后，这里将显示预览。"}
                </p>
                {asset.status === "failed" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(`/api/assets/${asset.id}/retry`, {
                          method: "POST",
                        });
                        await onChange();
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    重新预处理
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="preview-caption">
            <span className={`badge ${asset.status}`}>
              {statusName[asset.status]}
            </span>
            <span>原片独立保存 · 预览适配浏览器</span>
          </div>
          <div className="metadata-grid">
            <div>
              <span>原文件</span>
              <strong title={asset.originalName}>{asset.originalName}</strong>
            </div>
            <div>
              <span>文件大小</span>
              <strong>{bytes(asset.sizeBytes)}</strong>
            </div>
            <div>
              <span>原始尺寸</span>
              <strong>
                {asset.metadata
                  ? `${asset.metadata.width} × ${asset.metadata.height}`
                  : "待读取"}
              </strong>
            </div>
            <div>
              <span>
                {asset.kind === "video" ? "素材时长 / 帧率" : "图像编码"}
              </span>
              <strong>
                {asset.kind === "video"
                  ? `${duration(asset.metadata?.durationSec)} / ${asset.metadata?.fps ? `${Math.round(asset.metadata.fps * 100) / 100} fps` : "未知"}`
                  : (asset.metadata?.codec ?? "待读取")}
              </strong>
            </div>
          </div>
          <div className="info-note">
            <Info size={17} />
            <p>
              这里展示素材与文件信息。动作分析尚未开启；慢动作的播放时间不能直接作为真实运动时间。
            </p>
          </div>
          <a
            className="button secondary download-button"
            href={asset.originalUrl}
            download
          >
            <ArrowDownToLine size={17} />
            下载原始文件
          </a>
        </div>
        <form
          className="detail-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api(`/api/assets/${asset.id}`, {
                method: "PATCH",
                body: JSON.stringify(fields),
              });
              await onChange();
              setSaved(true);
            });
          }}
        >
          <h3>素材说明</h3>
          <fieldset disabled={busy}>
            <MetadataFields
              value={fields}
              setValue={(next) => {
                setFields(next);
                setSaved(false);
              }}
            />
          </fieldset>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <button
            className="button primary full-width"
            disabled={busy}
            type="submit"
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Check size={17} />
            )}
            {saved ? "已保存说明" : "保存说明"}
          </button>
          <div className="delete-area">
            {confirmDelete ? (
              <>
                <p>删除原片、预览和这条记录？此操作无法撤销。</p>
                <div className="delete-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setConfirmDelete(false)}
                    disabled={busy}
                  >
                    保留素材
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api(`/api/assets/${asset.id}`, {
                          method: "DELETE",
                        });
                        onDeleted();
                      })
                    }
                  >
                    确认删除
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="text-button muted"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={15} />
                删除素材
              </button>
            )}
          </div>
        </form>
      </div>
    </Modal>
  );
}

function Guide({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="给下一次分析，留好画面"
      subtitle="清楚、完整、可重复，比复杂的设备更重要。"
      onClose={onClose}
    >
      <div className="guide-list">
        {[
          [
            "01",
            "让动作完整进入画面",
            "保持镜头稳定，让身体、双脚和目标动作始终可见。篮球尽量同时拍到球；短跑按目标区间分段拍摄。",
          ],
          [
            "02",
            "保留原始拍摄文件",
            "优先从相册导出原片，避免社交软件压缩或插帧。使用慢动作拍摄时，在素材说明里注明。",
          ],
          [
            "03",
            "把条件一起记下来",
            "记录侧面或正面机位、距离、动作类别和当次感受。短跑注明 60、100 或 200 米及所在阶段。",
          ],
          [
            "04",
            "给复测留一个相同的起点",
            "前后两次尽量保持同机位、距离与动作任务。不同条件的画面，后续需要分别解释。",
          ],
        ].map(([n, title, text]) => (
          <article key={n}>
            <span>{n}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="info-note">
        <Info size={18} />
        <p>
          照片用于静态观察；动作顺序和节奏需要视频。当前版本先完成素材保存与回看。
        </p>
      </div>
    </Modal>
  );
}

export default function App() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sport, setSport] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<"upload" | "guide" | "progress" | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const fetching = useRef(false);
  const readVersion = useRef(0);
  const reload = useCallback(async (force = true) => {
    if (fetching.current && !force) return;
    const version = ++readVersion.current;
    fetching.current = true;
    try {
      const [list, server] = await Promise.all([
        api<{ assets: Asset[] }>("/api/assets"),
        api<Health>("/api/health"),
      ]);
      if (alive.current && version === readVersion.current) {
        setAssets(list.assets);
        setHealth(server);
        setError("");
      }
    } catch (err) {
      if (alive.current && version === readVersion.current) {
        setError(errorText(err));
        setHealth(null);
      }
    } finally {
      if (version === readVersion.current) {
        fetching.current = false;
        if (alive.current) setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void reload();
    const timer = window.setInterval(() => void reload(false), 2500);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [reload]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const shown = assets.filter(
    (asset) =>
      (sport === "all" || asset.sport === sport) &&
      (status === "all" || asset.status === status) &&
      `${asset.title} ${asset.originalName} ${asset.action} ${asset.notes}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const activeAsset = assets.find((asset) => asset.id === selected);
  const ready = assets.filter((asset) => asset.status === "ready").length;
  const pending = assets.filter(
    (asset) => asset.status === "processing" || asset.status === "queued",
  ).length;
  const uploaded = (asset: Asset) => {
    setAssets((previous) => [
      asset,
      ...previous.filter((item) => item.id !== asset.id),
    ]);
    setPanel(null);
    setSelected(asset.id);
    setNotice("原片已接收，正在准备预览。");
    void reload();
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="KHEPRI 首页">
          <span className="brand-symbol">
            <Sun size={29} strokeWidth={1.5} />
          </span>
          <div>
            <b>KHEPRI</b>
            <span>个人运动实验室</span>
          </div>
        </a>
        <div className="workspace-label">我的工作区</div>
        <nav aria-label="主导航">
          <button
            className="nav-item active"
            onClick={() => {
              setPanel(null);
              setSelected(null);
              setSport("all");
              setStatus("all");
              setSearch("");
            }}
          >
            <FolderOpen size={19} />
            素材台<span>01</span>
          </button>
          <button className="nav-item" onClick={() => setPanel("guide")}>
            <CircleHelp size={19} />
            拍摄指南
            <ArrowUpRight size={16} />
          </button>
          <button className="nav-item" onClick={() => setPanel("progress")}>
            <Layers3 size={19} />
            开发进度
            <ArrowUpRight size={16} />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="growth-note">
            <span className="tiny-sun">✳</span>
            <p>
              向光而生，
              <br />
              在变化中持续生长。
            </p>
            <span>EVERY MOVEMENT MATTERS</span>
          </div>
          <div className="local-status">
            <i className={health ? "online" : ""} />
            <div>
              <b>{health ? "本地工作区" : "等待连接服务"}</b>
              <span>
                {health ? "素材保存在这台电脑" : "请确认服务端已启动"}
              </span>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            我的工作区 <ChevronRight size={13} />
            <b>素材台</b>
          </span>
          <span className="topbar-right">
            <span className="edition">个人自用 · 预览版</span>
            <span className="avatar">我</span>
          </span>
        </header>
        <div className="main-body">
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span /> YOUR MOVEMENT, YOUR GROWTH
              </div>
              <h1>
                把今天的练习，
                <br />
                留给更好的自己。
              </h1>
              <p>
                记录一个动作，观察一点变化。
                <br className="mobile-break" />
                你的运动档案，从这里开始。
              </p>
              <button
                className="button primary"
                onClick={() => setPanel("upload")}
              >
                <Plus size={18} />
                导入新素材
                <ArrowUpRight size={17} />
              </button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="sun-disc" />
              <div className="horizon horizon-one" />
              <div className="horizon horizon-two" />
              <div className="horizon horizon-three" />
              <div className="art-caption">
                RISE. MOVE. GROW.<span>每天，重新生长。</span>
              </div>
            </div>
          </section>
          <section className="stats" aria-label="素材概况">
            <div>
              <span className="stat-icon">
                <FolderOpen size={20} />
              </span>
              <div>
                <b>{assets.length.toString().padStart(2, "0")}</b>
                <span>已保存素材</span>
              </div>
            </div>
            <div>
              <span className="stat-icon">
                <Check size={20} />
              </span>
              <div>
                <b>{ready.toString().padStart(2, "0")}</b>
                <span>可以回看</span>
              </div>
            </div>
            <div>
              <span className="stat-icon">
                <Clock3 size={20} />
              </span>
              <div>
                <b>{pending.toString().padStart(2, "0")}</b>
                <span>预处理中</span>
              </div>
            </div>
            <div className="stats-note">
              <span>从记录开始</span>
              <p>保留原片，也保留每次练习的条件。</p>
            </div>
          </section>
          {error && (
            <div className="connection-error" role="alert">
              <Info size={20} />
              <div>
                <b>暂时无法连接本地服务</b>
                <p>{error} 已显示的记录可能不是最新状态。</p>
              </div>
              <button
                className="button secondary"
                onClick={() => void reload()}
              >
                <RefreshCw size={16} />
                重新连接
              </button>
            </div>
          )}
          <section className="library">
            <div className="section-heading">
              <div>
                <h2>
                  我的素材<span>{assets.length}</span>
                </h2>
                <p>每一份记录，都是下一次进步的起点。</p>
              </div>
              <button className="text-button" onClick={() => setPanel("guide")}>
                怎样拍得更清楚
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="toolbar">
              <div className="tabs" aria-label="运动筛选">
                {[
                  ["all", "全部"],
                  ["basketball", "篮球"],
                  ["sprint", "短跑"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={sport === value}
                    className={sport === value ? "selected" : ""}
                    onClick={() => setSport(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="search-controls">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="搜索素材"
                    placeholder="搜索标题、动作或备注"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  className="status-select"
                  aria-label="预处理状态筛选"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">全部状态</option>
                  {Object.entries(statusName).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {loading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={30} />
                <h3>正在读取你的素材…</h3>
              </div>
            ) : shown.length ? (
              <div className="asset-grid">
                {shown.map((asset) => (
                  <button
                    className="asset-card"
                    key={asset.id}
                    onClick={() => setSelected(asset.id)}
                    aria-label={`查看素材：${asset.title}`}
                  >
                    <div className="asset-image">
                      {asset.posterUrl ? (
                        <img loading="lazy" src={asset.posterUrl} alt="" />
                      ) : (
                        <div className="asset-placeholder">
                          {asset.status === "processing" ||
                          asset.status === "queued" ? (
                            <LoaderCircle size={32} className="spin" />
                          ) : asset.kind === "video" ? (
                            <Film size={35} />
                          ) : (
                            <FileImage size={35} />
                          )}
                        </div>
                      )}
                      <span className={`badge ${asset.status}`}>
                        {statusName[asset.status]}
                      </span>
                      {asset.kind === "video" && (
                        <span className="video-time">
                          <Film size={13} />
                          {duration(asset.metadata?.durationSec)}
                        </span>
                      )}
                    </div>
                    <div className="asset-copy">
                      <div className="asset-category">
                        {sportName(asset.sport)}
                        <i />
                        {asset.action}
                      </div>
                      <h3>{asset.title}</h3>
                      <div className="asset-meta">
                        <span>
                          {date(asset.createdAt)} · {bytes(asset.sizeBytes)}
                        </span>
                        <ArrowUpRight size={17} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-illustration">
                  <div className="empty-sun" />
                  <ImagePlus size={39} strokeWidth={1.2} />
                  <span className="empty-dot" />
                </div>
                <h3>
                  {assets.length
                    ? "这里还没有匹配的素材"
                    : "你的第一份记录，从这里开始"}
                </h3>
                <p>
                  {assets.length
                    ? "换一个运动分类、状态或搜索词试试。"
                    : "一次投篮，一段起跑，或一张动作照片。\n先把真实的练习留下来。"}
                </p>
                {assets.length ? (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setSport("all");
                      setStatus("all");
                      setSearch("");
                    }}
                  >
                    清除筛选
                  </button>
                ) : (
                  <button
                    className="button secondary"
                    onClick={() => setPanel("upload")}
                  >
                    <Plus size={17} />
                    导入第一份素材
                  </button>
                )}
                <span className="empty-footnote">
                  照片与视频 · 原片独立保存
                </span>
              </div>
            )}
          </section>
          <footer className="page-footer">
            <span>
              <Sun size={16} /> KHEPRI · 向光而生
            </span>
            <span>当前支持素材保存与回看，动作分析将在后续加入。</span>
          </footer>
        </div>
      </main>
      {notice && (
        <div role="status" className="toast">
          <Check size={18} />
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {panel === "upload" && (
        <UploadDialog
          onClose={(message) => {
            setPanel(null);
            if (message) setNotice(message);
            void reload();
          }}
          onUploaded={uploaded}
        />
      )}
      {panel === "guide" && <Guide onClose={() => setPanel(null)} />}
      {panel === "progress" && (
        <Modal
          title="一步一步，让训练有依据"
          subtitle="先完成网页与服务端，最后接入 iPhone 客户端。"
          onClose={() => setPanel(null)}
        >
          <ol className="roadmap">
            {[
              "素材保存与回看",
              "篮球与短跑动作分析",
              "个人历史与参考对比",
              "练习建议与复测",
              "个人 Agent 与长期档案",
              "iPhone 17 Pro 客户端",
            ].map((label, i) => (
              <li key={label} className={i === 0 ? "current" : ""}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <b>{label}</b>
                <small>{i === 0 ? "当前试用" : "后续开发"}</small>
              </li>
            ))}
          </ol>
          <div className="info-note">
            <Info size={17} />
            <p>
              预览准备完成只表示可以回看素材。运动分析与训练效果需要另外验证。
            </p>
          </div>
        </Modal>
      )}
      {activeAsset && (
        <DetailDialog
          key={activeAsset.id}
          asset={activeAsset}
          onClose={() => setSelected(null)}
          onChange={reload}
          onDeleted={() => {
            setSelected(null);
            setAssets((items) =>
              items.filter((item) => item.id !== activeAsset.id),
            );
            setNotice("素材与原文件已删除。");
            void reload();
          }}
        />
      )}
    </div>
  );
}

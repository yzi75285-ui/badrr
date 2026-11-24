import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { resolveBinaries } from "./binaries.js";
import { runProcess } from "./process.js";
import { solidPng } from "./png.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const samples = path.join(root, "samples");
const recordDir = path.join(root, "验收记录");
const dataDir = path.join(root, "var", "acceptance");

type Step = {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  media_id?: string;
  task_id?: string;
};

const steps: Step[] = [];

function note(name: string, expected: string, actual: string, passed: boolean, ids?: { media_id?: string; task_id?: string }) {
  steps.push({ name, expected, actual, passed, ...ids });
  if (!passed) throw new Error(`${name}：${actual}`);
}

async function main() {
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(samples, { recursive: true });
  const photoPath = path.join(samples, "basketball-shot.png");
  const videoPath = path.join(samples, "sprint-start.mp4");
  await writeFile(photoPath, solidPng(960, 540, 196, 90, 40));
  const binaries = resolveBinaries();
  if (!binaries.ffmpeg) throw new Error("缺少 ffmpeg，不能生成短跑样本视频。");
  const encoded = await runProcess(binaries.ffmpeg, [
    "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath,
  ], 30000);
  if (encoded.code !== 0) throw new Error(encoded.stderr.slice(-400));

  let app = await createApp({ dataDir });
  let server = createServer((req, res) => void app.handle(req, res));
  let base = await listen(server);
  try {
    const photo = await upload(base, photoPath, "image/png", { sport: "basketball", action: "投篮", viewpoint: "侧面" }, "accept-basketball");
    const video = await upload(base, videoPath, "video/mp4", { sport: "sprint", action: "起跑", speed_altered: "false" }, "accept-sprint");
    const photoDone = await settle(base, photo.media_id);
    const videoDone = await settle(base, video.media_id);
    note("篮球样本上传", "照片进入可回看，分析状态保持未实现", `${photoDone.status} / ${photoDone.analysis.status}`, photoDone.status === "ready" && photoDone.analysis.status === "not_implemented", photoDone);
    note("短跑样本上传", "视频进入可回看，并有帧时间戳", `${videoDone.status} / 时间戳 ${videoDone.probe?.frame_timestamps?.sample?.length ?? 0}`, videoDone.status === "ready" && (videoDone.probe?.frame_timestamps?.sample?.length ?? 0) > 1, videoDone);

    const listed = await json(base, "/api/media");
    const ids = listed.media.map((item: { media_id: string }) => item.media_id).sort();
    note("刷新列表", "两条样本都还在", ids.join(", "), ids.length === 2 && ids.includes(photo.media_id) && ids.includes(video.media_id));

    await app.close();
    await close(server);
    app = await createApp({ dataDir });
    server = createServer((req, res) => void app.handle(req, res));
    base = await listen(server);
    const again = await json(base, "/api/media");
    const againIds = again.media.map((item: { media_id: string; status: string }) => `${item.media_id}:${item.status}`).sort();
    note("重启服务", "同一标识仍可找回，且仍是可回看", againIds.join(", "), again.media.length === 2 && again.media.every((item: { status: string }) => item.status === "ready"));

    const bad = await uploadBytes(base, Buffer.from("not media"), "bad.mp4", "video/mp4", { sport: "sprint", action: "加速" }, "accept-bad");
    const failed = await settle(base, bad.media_id);
    note("失败", "无法识别的文件失败，并给出原因", failed.failure?.message ?? "没有原因", failed.status === "failed" && Boolean(failed.failure?.message), failed);
    const replaced = await uploadRetry(base, bad.media_id, photoPath, "image/png");
    const recovered = await settle(base, bad.media_id);
    note(
      "同一任务重试",
      "素材和任务标识不变，尝试次数变为 2，结果可回看",
      `${recovered.media_id} / ${recovered.task_id} / 第 ${recovered.attempt} 次 / ${recovered.status}`,
      replaced.media_id === bad.media_id && recovered.task_id === bad.task_id && recovered.attempt === 2 && recovered.status === "ready",
      recovered,
    );
    const tasks = await json(base, `/api/tasks?media_id=${bad.media_id}`);
    note("不重复创建任务", "该素材只有一张预处理任务", String(tasks.tasks.length), tasks.tasks.length === 1);
  } finally {
    await app.close();
    await close(server);
    await writeRecord(steps);
  }
}

async function writeRecord(items: Step[]) {
  await mkdir(recordDir, { recursive: true });
  const passed = items.every((item) => item.passed);
  const payload = {
    stage: 1,
    version: "0.1.0",
    recorded_at: new Date().toISOString(),
    personal_acceptance: "待测",
    note: "使用合成样本，不是本人实拍。本人使用验收保持待测。",
    result: passed ? "样本测试通过" : "样本测试不通过",
    steps: items,
  };
  await writeFile(path.join(recordDir, "阶段1-样本测试.json"), JSON.stringify(payload, null, 2));
  const lines = [
    "# 第 1 段样本测试记录",
    "",
    "本人真实素材验收保持待测。这里只记录合成样本。",
    "",
    `| 项 | 内容 |`,
    `| --- | --- |`,
    `| 版本 | 0.1.0 |`,
    `| 时间 | ${payload.recorded_at} |`,
    `| 结果 | ${payload.result} |`,
    "",
    ...items.flatMap((item) => [
      `## ${item.name}`,
      "",
      `- 预期：${item.expected}`,
      `- 实际：${item.actual}`,
      `- 结果：${item.passed ? "通过" : "不通过"}`,
      item.media_id ? `- 素材：\`${item.media_id}\`` : "",
      item.task_id ? `- 任务：\`${item.task_id}\`` : "",
      "",
    ]),
  ];
  await writeFile(path.join(recordDir, "阶段1-样本测试.md"), lines.join("\n"));
}

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const value = server.address();
      if (!value || typeof value === "string") throw new Error("没有拿到端口");
      resolve(`http://127.0.0.1:${value.port}`);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function upload(base: string, file: string, type: string, fields: Record<string, string>, key: string) {
  return uploadBytes(base, await readFile(file), path.basename(file), type, fields, key);
}

async function uploadBytes(base: string, bytes: Buffer, filename: string, type: string, fields: Record<string, string>, key: string) {
  const body = new FormData();
  body.set("file", new Blob([new Uint8Array(bytes)], { type }), filename);
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const response = await fetch(`${base}/api/media`, { method: "POST", body, headers: { "Idempotency-Key": key } });
  const media = await response.json() as { error?: { message?: string }; media_id: string; task_id: string };
  if (!response.ok) throw new Error(media.error?.message ?? "上传失败");
  return media;
}

async function uploadRetry(base: string, id: string, file: string, type: string) {
  const bytes = await readFile(file);
  const body = new FormData();
  body.set("file", new Blob([new Uint8Array(bytes)], { type }), path.basename(file));
  const response = await fetch(`${base}/api/media/${id}/retry`, { method: "POST", body });
  const media = await response.json() as { error?: { message?: string }; media_id: string; task_id: string };
  if (!response.ok) throw new Error(media.error?.message ?? "重试失败");
  return media;
}

async function settle(base: string, id: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const media = await json(base, `/api/media/${id}`);
    if (media.status === "ready" || media.status === "failed") return media;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`素材 ${id} 没有在时限内结束`);
}

async function json(base: string, pathname: string) {
  const response = await fetch(`${base}${pathname}`);
  if (!response.ok) throw new Error(`${pathname} 返回 ${response.status}`);
  return response.json() as Promise<any>;
}

main().catch(async (error) => {
  console.error(error);
  try { await writeRecord(steps); } catch { /* 记录本身失败时保留原始错误 */ }
  process.exit(1);
});

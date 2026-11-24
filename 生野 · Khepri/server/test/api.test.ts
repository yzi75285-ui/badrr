import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApp, type App } from "../src/app.js";
import { resolveBinaries } from "../src/binaries.js";
import { runProcess } from "../src/process.js";
import { solidPng } from "../src/png.js";

test("stage 1 keeps media, survives restart, and retries the same task", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "khepri-api-"));
  const video = path.join(dataDir, "sprint.mp4");
  await makeSprintVideo(video);
  const videoBytes = await (await import("node:fs/promises")).readFile(video);
  const photo = solidPng(960, 540, 196, 90, 40);
  let app = await createApp({ dataDir });
  let server = listenServer(app);
  let base = await address(server);
  try {
    const basketball = await upload(base, {
      filename: "basketball-shot.png",
      type: "image/png",
      bytes: photo,
      fields: { sport: "basketball", action: "投篮", device: "iPhone 17 Pro", viewpoint: "侧面" },
      key: "basketball-shot",
    });
    assert.equal(basketball.status, 201);
    assert.equal(basketball.media.status, "received");
    assert.equal(basketball.media.analysis.status, "not_implemented");
    assert.equal(basketball.media.analysis.report_id, null);
    assert.equal(JSON.stringify(basketball.media).includes(dataDir), false);

    const sprint = await upload(base, {
      filename: "sprint-start.mp4",
      type: "video/mp4",
      bytes: videoBytes,
      fields: { sport: "sprint", action: "起跑", speed_altered: "false" },
      key: "sprint-start",
    });
    assert.equal(sprint.status, 201);

    const photoReady = await settle(base, basketball.media.media_id);
    const videoReady = await settle(base, sprint.media.media_id);
    assert.equal(photoReady.status, "ready");
    assert.equal(photoReady.source.kind, "photo");
    assert.equal(photoReady.probe.width, 960);
    assert.equal(photoReady.probe.height, 540);
    assert.equal(photoReady.probe.iphone.timeline, "unknown");
    assert.ok(photoReady.probe.warnings.some((item: string) => item.includes("照片")));
    assert.equal(videoReady.status, "ready");
    assert.equal(videoReady.source.kind, "video");
    assert.equal(videoReady.preview.content_type, "video/mp4");
    assert.ok(videoReady.probe.duration_seconds > 0.5);
    assert.ok(videoReady.probe.frame_timestamps.sample.length > 1);
    assert.equal(videoReady.capture.device, null);
    assert.equal(videoReady.analysis.status, "not_implemented");

    const preview = await fetch(new URL(photoReady.access.preview_url, base));
    assert.equal(preview.status, 200);
    assert.ok((await preview.arrayBuffer()).byteLength > 32);
    const ranged = await fetch(new URL(videoReady.access.preview_url, base), { headers: { Range: "bytes=0-15" } });
    assert.equal(ranged.status, 206);
    assert.equal(Number(ranged.headers.get("content-length")), 16);
    const denied = await fetch(`${base}/api/media/${photoReady.media_id}/original`);
    assert.equal(denied.status, 403);

    const listed = await (await fetch(`${base}/api/media`)).json();
    assert.deepEqual(listed.media.map((item: { media_id: string }) => item.media_id).sort(), [photoReady.media_id, videoReady.media_id].sort());
    assertNoServerPath(listed, dataDir);

    await app.close();
    await closeServer(server);
    app = await createApp({ dataDir });
    server = listenServer(app);
    base = await address(server);
    const restarted = await (await fetch(`${base}/api/media`)).json();
    assert.deepEqual(restarted.media.map((item: { media_id: string }) => item.media_id).sort(), [photoReady.media_id, videoReady.media_id].sort());
    assert.equal(restarted.media.every((item: { status: string }) => item.status === "ready"), true);

    const replay = await upload(base, {
      filename: "basketball-shot.png",
      type: "image/png",
      bytes: photo,
      fields: { sport: "basketball", action: "投篮" },
      key: "basketball-shot",
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.replay, true);
    assert.equal(replay.media.media_id, photoReady.media_id);
    const afterReplay = await (await fetch(`${base}/api/media`)).json();
    assert.equal(afterReplay.media.length, 2);

    const rejected = await upload(base, {
      filename: "notes.png",
      type: "image/png",
      bytes: photo,
      fields: { sport: "tennis" },
      key: "bad-sport",
    });
    assert.equal(rejected.status, 400);
    assert.equal((await (await fetch(`${base}/api/media`)).json()).media.length, 2);

    const failed = await upload(base, {
      filename: "bad.mp4",
      type: "video/mp4",
      bytes: Buffer.from("this is not a media file"),
      fields: { sport: "sprint", action: "加速" },
      key: "bad-sprint",
    });
    const failedReady = await settle(base, failed.media.media_id);
    assert.equal(failedReady.status, "failed");
    assert.equal(failedReady.failure.code, "unsupported_type");
    assert.match(failedReady.failure.message, /照片或视频/);
    assert.equal(JSON.stringify(failedReady).includes(dataDir), false);
    assert.equal(failedReady.task_id, failed.media.task_id);

    const retried = await retry(base, failed.media.media_id, {
      filename: "retry.png",
      type: "image/png",
      bytes: photo,
    });
    assert.equal(retried.status, 202);
    assert.equal(retried.media.media_id, failed.media.media_id);
    assert.equal(retried.media.task_id, failed.media.task_id);
    assert.equal(retried.media.attempt, 2);
    const recovered = await settle(base, failed.media.media_id);
    assert.equal(recovered.status, "ready");
    assert.equal(recovered.attempt, 2);
    const tasks = await (await fetch(`${base}/api/tasks?media_id=${failed.media.media_id}`)).json();
    assert.equal(tasks.tasks.length, 1);
    assert.equal(tasks.tasks[0].task_id, failed.media.task_id);
    assert.equal(tasks.tasks[0].attempt, 2);
    assert.equal(tasks.tasks[0].status, "succeeded");

    const reports = await (await fetch(`${base}/api/reports`)).json();
    assert.equal(reports.implementation, "not_implemented");
    assert.deepEqual(reports.reports, []);
    assert.equal((await fetch(`${base}/api/reports`, { method: "POST" })).status, 501);
    assert.equal((await fetch(`${base}/api/reports/rep_example`)).status, 501);
    assert.equal((await (await fetch(`${base}/api/training-records`)).json()).implementation, "not_implemented");
    assert.equal((await (await fetch(`${base}/api/memories`)).json()).implementation, "not_implemented");
    const caps = await (await fetch(`${base}/api/capabilities`)).json();
    assert.equal(caps.analysis.status, "not_implemented");

    const removed = await fetch(`${base}/api/media/${recovered.media_id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    assert.equal((await fetch(`${base}/api/media/${recovered.media_id}`)).status, 404);
  } finally {
    await app.close();
    await closeServer(server);
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function makeSprintVideo(file: string): Promise<void> {
  const binaries = resolveBinaries();
  assert.ok(binaries.ffmpeg, "缺少 ffmpeg，无法生成短跑样本视频");
  const result = await runProcess(binaries.ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=size=320x180:rate=30:duration=1",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    file,
  ], 30000);
  assert.equal(result.code, 0, result.stderr.slice(-500));
}

function listenServer(app: App): Server {
  return createServer((req, res) => {
    void app.handle(req, res);
  });
}

function address(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const value = server.address();
      if (!value || typeof value === "string") throw new Error("没有拿到端口");
      resolve(`http://127.0.0.1:${value.port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function upload(base: string, input: {
  filename: string;
  type: string;
  bytes: Buffer;
  fields: Record<string, string>;
  key: string;
}) {
  const body = new FormData();
  body.set("file", new Blob([new Uint8Array(input.bytes)], { type: input.type }), input.filename);
  for (const [key, value] of Object.entries(input.fields)) body.set(key, value);
  const response = await fetch(`${base}/api/media`, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": input.key },
  });
  const media = await response.json();
  return { status: response.status, replay: response.headers.get("x-idempotent-replay") === "true", media };
}

async function retry(base: string, id: string, file: { filename: string; type: string; bytes: Buffer }) {
  const body = new FormData();
  body.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
  const response = await fetch(`${base}/api/media/${id}/retry`, { method: "POST", body });
  return { status: response.status, media: await response.json() };
}

async function settle(base: string, id: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const media = await (await fetch(`${base}/api/media/${id}`)).json();
    if (media.status === "ready" || media.status === "failed") return media;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`素材 ${id} 在 30 秒内没有结束预处理`);
}

function assertNoServerPath(value: unknown, dataDir: string) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(dataDir), false);
  assert.equal(text.includes(dataDir.replaceAll("\\", "/")), false);
}

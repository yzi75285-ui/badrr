import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Asset } from '../src/shared/contracts.ts';
import { createApp } from '../src/server/app.ts';
import { createMediaFixtures, createRotatedHevcFixture, decodeVideoFile, probeVideoFile } from './fixtures.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const scratchRoot = path.resolve(projectRoot, '.tmp');
let runDirectory: string;
let fixtures: Awaited<ReturnType<typeof createMediaFixtures>>;
const apps = new Set<FastifyInstance>();

before(async () => {
  await mkdir(scratchRoot, { recursive: true });
  runDirectory = await mkdtemp(path.join(scratchRoot, 'api-tests-'));
  fixtures = await createMediaFixtures(path.join(runDirectory, 'fixtures'));
});

after(async () => {
  for (const app of apps) await app.close();
  if (!runDirectory) return;
  // Only remove the directory created by this test run, inside the known workspace.
  const relative = path.relative(scratchRoot, path.resolve(runDirectory));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.ok(path.basename(runDirectory).startsWith('api-tests-'));
  await rm(runDirectory, { recursive: true, force: true });
});

async function openApp(name: string, options: Parameters<typeof createApp>[0] = {}) {
  const dataDir = path.join(runDirectory, name);
  const app = await createApp({ dataDir, logger: false, ...options });
  apps.add(app);
  await app.ready();
  return app;
}

async function closeApp(app: FastifyInstance) {
  await app.close();
  apps.delete(app);
}

function multipart(
  bytes: Buffer,
  filename: string,
  fields: Record<string, string> = { sport: 'basketball', action: '投篮' },
) {
  const boundary = `khepri-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  chunks.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}

async function upload(
  app: FastifyInstance,
  bytes: Buffer,
  filename: string,
  fields?: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const request = multipart(bytes, filename, fields);
  return app.inject({
    method: 'POST', url: '/api/assets', payload: request.payload,
    headers: { ...request.headers, ...headers },
  });
}

async function assetDetail(app: FastifyInstance, id: string): Promise<Asset> {
  const response = await app.inject({ method: 'GET', url: `/api/assets/${id}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().asset;
}

async function waitForStatus(app: FastifyInstance, id: string, expected: 'ready' | 'failed') {
  const deadline = Date.now() + 30_000;
  let latest: Asset | undefined;
  while (Date.now() < deadline) {
    latest = await assetDetail(app, id);
    if (latest.status === expected) return latest;
    if (latest.status === 'failed' && expected === 'ready') {
      assert.fail(`Preprocessing failed: ${latest.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Expected ${expected}; last state was ${latest?.status}: ${latest?.error}`);
}

test('a photo survives upload, preview, metadata edits, server restart, and deletion', { timeout: 45_000 }, async () => {
  let app = await openApp('photo-lifecycle');
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json().tools, { ffmpeg: true, ffprobe: true });

  const uploaded = await upload(app, fixtures.image, 'synthetic-grid.jpg', {
    sport: 'basketball', action: '投篮', title: '合成图片测试',
    notes: '仅用于验证素材流程，不是运动分析样本。', timeBasis: 'unknown',
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const id = uploaded.json().asset.id as string;
  const ready = await waitForStatus(app, id, 'ready');
  assert.equal(ready.kind, 'image');
  assert.equal(ready.timeBasis, 'unknown');
  assert.equal(ready.metadata?.width, 320);
  assert.equal(ready.metadata?.height, 180);
  assert.equal(ready.sizeBytes, fixtures.image.length);
  assert.equal(ready.sha256, createHash('sha256').update(fixtures.image).digest('hex'));
  assert.ok(ready.previewUrl && ready.posterUrl);

  const preview = await app.inject({ method: 'GET', url: ready.previewUrl! });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.match(String(preview.headers['content-type']), /^image\//);
  assert.ok(preview.rawPayload.length > 100);
  const original = await app.inject({ method: 'GET', url: ready.originalUrl });
  assert.equal(original.statusCode, 200);
  assert.match(String(original.headers['content-disposition']), /attachment/);
  assert.deepEqual(original.rawPayload, fixtures.image, 'Original bytes must not be replaced by a preview.');

  const edited = await app.inject({
    method: 'PATCH', url: `/api/assets/${id}`,
    payload: { title: '修改后的素材标题', notes: '训练条件待补充。', timeBasis: 'edited' },
  });
  assert.equal(edited.statusCode, 200, edited.body);
  await closeApp(app);
  app = await openApp('photo-lifecycle');
  const restored = await assetDetail(app, id);
  assert.equal(restored.title, '修改后的素材标题');
  assert.equal(restored.notes, '训练条件待补充。');
  assert.equal(restored.timeBasis, 'edited');
  assert.equal(restored.status, 'ready');
  const list = await app.inject({ method: 'GET', url: '/api/assets' });
  assert.equal(list.json().assets.length, 1);

  const deletion = await app.inject({ method: 'DELETE', url: `/api/assets/${id}` });
  assert.equal(deletion.statusCode, 204, deletion.body);
  for (const url of [`/api/assets/${id}`, ready.originalUrl, ready.previewUrl!]) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/assets' })).json().assets.length, 0);
  await closeApp(app);
});

test('a queued video resumes after restart and supports browser byte-range playback', { timeout: 45_000 }, async () => {
  let app = await openApp('video-recovery', { startWorker: false });
  const response = await upload(app, fixtures.video, 'synthetic-motion.mp4', {
    sport: 'sprint', action: '加速', title: '合成视频测试', timeBasis: 'original',
  });
  assert.equal(response.statusCode, 201, response.body);
  const id = response.json().asset.id as string;
  assert.equal((await assetDetail(app, id)).status, 'queued');
  await closeApp(app);

  app = await openApp('video-recovery');
  const ready = await waitForStatus(app, id, 'ready');
  assert.equal(ready.kind, 'video');
  assert.ok(ready.metadata && ready.metadata.durationSec !== null && ready.metadata.fps !== null);
  assert.ok(Math.abs(ready.metadata.durationSec - 2) < 0.1);
  assert.ok(Math.abs(ready.metadata.fps - 24) < 0.01);
  assert.equal(ready.metadata.width, 320);
  assert.equal(ready.metadata.height, 180);
  assert.equal(ready.timeBasis, 'original');
  const original = await app.inject({ method: 'GET', url: ready.originalUrl });
  assert.deepEqual(original.rawPayload, fixtures.video);
  const range = await app.inject({
    method: 'GET', url: ready.previewUrl!, headers: { range: 'bytes=0-31' },
  });
  assert.equal(range.statusCode, 206, range.body);
  assert.match(String(range.headers['content-type']), /^video\/mp4/);
  assert.match(String(range.headers['content-range']), /^bytes 0-31\/[0-9]+$/);
  assert.equal(range.rawPayload.length, 32);
  assert.ok(range.rawPayload.includes(Buffer.from('ftyp')));
  const poster = await app.inject({ method: 'GET', url: ready.posterUrl! });
  assert.equal(poster.statusCode, 200);
  assert.match(String(poster.headers['content-type']), /^image\//);
  await closeApp(app);
});

test('a rotated HEVC MOV preserves its original and produces an upright decodable H.264 preview', { timeout: 60_000 }, async (context) => {
  const fixtureDirectory = path.join(runDirectory, 'hevc-fixtures');
  const fixture = await createRotatedHevcFixture(fixtureDirectory);
  if (!fixture) {
    context.skip('The installed FFmpeg has no libx265 encoder; HEVC compatibility is not verified on this host.');
    return;
  }
  const sourceStream = await probeVideoFile(fixture.path);
  const sourceRotation = sourceStream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation
    ?? Number(sourceStream.tags?.rotate ?? 0);
  assert.equal(sourceStream.codec_name, 'hevc');
  assert.equal(sourceStream.width, 640);
  assert.equal(sourceStream.height, 360);
  assert.equal(sourceRotation, 90, 'The fixture must actually carry a 90-degree display rotation.');

  const app = await openApp('hevc-rotation');
  const response = await upload(app, fixture.bytes, 'synthetic-hevc-rotated.mov', {
    sport: 'sprint', action: '加速', title: 'HEVC MOV 旋转兼容性测试', timeBasis: 'unknown',
  });
  assert.equal(response.statusCode, 201, response.body);
  const ready = await waitForStatus(app, response.json().asset.id, 'ready');
  assert.equal(ready.kind, 'video');
  assert.equal(ready.metadata?.codec, 'hevc');
  assert.equal(ready.metadata?.rotation, 90);
  assert.equal(ready.metadata?.width, 640, 'Source dimensions must remain separate from preview dimensions.');
  assert.equal(ready.metadata?.height, 360);
  assert.equal(ready.timeBasis, 'unknown', 'A codec conversion cannot establish the real motion time base.');
  assert.equal(ready.sha256, createHash('sha256').update(fixture.bytes).digest('hex'));
  const original = await app.inject({ method: 'GET', url: ready.originalUrl });
  assert.equal(original.statusCode, 200);
  assert.deepEqual(original.rawPayload, fixture.bytes);

  const preview = await app.inject({ method: 'GET', url: ready.previewUrl! });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.match(String(preview.headers['content-type']), /^video\/mp4/);
  const downloadedPreview = path.join(fixtureDirectory, 'downloaded-preview.mp4');
  await writeFile(downloadedPreview, preview.rawPayload);
  const previewStream = await probeVideoFile(downloadedPreview);
  assert.equal(previewStream.codec_name, 'h264');
  assert.equal(previewStream.width, 360, 'Portrait orientation must be applied to preview pixels.');
  assert.equal(previewStream.height, 640);
  const previewRotation = previewStream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation
    ?? Number(previewStream.tags?.rotate ?? 0);
  assert.equal(previewRotation, 0, 'Already-rotated preview pixels must not retain a second display rotation.');
  await decodeVideoFile(downloadedPreview);
  await closeApp(app);
});

test('repeating an upload safely reuses its task and rejects a conflicting idempotency key', { timeout: 45_000 }, async () => {
  const app = await openApp('idempotency');
  const headers = { 'idempotency-key': randomUUID() };
  const first = await upload(app, fixtures.image, 'synthetic-grid.jpg', undefined, headers);
  assert.equal(first.statusCode, 201, first.body);
  const second = await upload(app, fixtures.image, 'synthetic-grid.jpg', undefined, headers);
  assert.equal(second.statusCode, 201, second.body);
  assert.equal(second.json().asset.id, first.json().asset.id);
  assert.equal(second.json().reused, true);
  const conflict = await upload(app, fixtures.image, 'synthetic-grid.jpg', {
    sport: 'sprint', action: '起跑',
  }, headers);
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal((await app.inject({ method: 'GET', url: '/api/assets' })).json().assets.length, 1);
  await waitForStatus(app, first.json().asset.id, 'ready');
  await closeApp(app);
});

test('corrupt video remains downloadable and reports a failure again after an explicit retry', { timeout: 45_000 }, async () => {
  const app = await openApp('failure-retry');
  const badBytes = Buffer.from('This file is intentionally not a video.');
  const response = await upload(app, badBytes, 'corrupt.mp4', { sport: 'sprint', action: '起跑' });
  assert.equal(response.statusCode, 201, response.body);
  const id = response.json().asset.id as string;
  const failed = await waitForStatus(app, id, 'failed');
  assert.ok(failed.error && failed.error.length > 0);
  assert.equal(failed.previewUrl, null);
  assert.equal(failed.posterUrl, null);
  const original = await app.inject({ method: 'GET', url: failed.originalUrl });
  assert.deepEqual(original.rawPayload, badBytes);
  const retry = await app.inject({ method: 'POST', url: `/api/assets/${id}/retry` });
  assert.equal(retry.statusCode, 200, retry.body);
  const failedAgain = await waitForStatus(app, id, 'failed');
  assert.ok(failedAgain.error);
  assert.equal(failedAgain.id, id);
  assert.equal((await app.inject({ method: 'GET', url: '/api/assets' })).json().assets.length, 1);
  await closeApp(app);
});

test('invalid metadata, unsupported files, and cross-site mutation are rejected without creating records', { timeout: 30_000 }, async () => {
  const app = await openApp('validation');
  const invalidCases: Record<string, string>[] = [
    { sport: 'swimming', action: '其他' },
    { sport: 'basketball', action: 'invented-action' },
    { sport: 'sprint', action: '起跑', timeBasis: 'invented-clock' },
  ];
  for (const fields of invalidCases) {
    const invalid = await upload(app, fixtures.image, 'synthetic-grid.jpg', fields);
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(typeof invalid.json().error, 'string');
  }
  const unsupported = await upload(app, Buffer.from('<html>test</html>'), 'document.html');
  assert.equal(unsupported.statusCode, 415, unsupported.body);
  const crossSite = await upload(app, fixtures.image, 'synthetic-grid.jpg', undefined, {
    origin: 'https://untrusted.example',
  });
  assert.equal(crossSite.statusCode, 403, crossSite.body);
  assert.equal((await app.inject({ method: 'GET', url: '/api/assets' })).json().assets.length, 0);
  await closeApp(app);
});

test('an upload beyond the configured size limit is rejected and leaves no asset', { timeout: 30_000 }, async () => {
  const app = await openApp('size-limit', { maxUploadBytes: 1024 });
  assert.ok(fixtures.image.length > 1024);
  const response = await upload(app, fixtures.image, 'oversized.jpg');
  assert.equal(response.statusCode, 413, response.body);
  assert.equal(typeof response.json().error, 'string');
  assert.equal((await app.inject({ method: 'GET', url: '/api/assets' })).json().assets.length, 0);
  await closeApp(app);
});

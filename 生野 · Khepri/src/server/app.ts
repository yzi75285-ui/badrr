import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, MAX_UPLOAD_BYTES, type Asset, type AssetInput, type Sport, type TimeBasis } from '../shared/contracts.js';
import { AssetStore } from './store.js';
import { defaultTools, isAvailable, preprocess, type MediaTools } from './media.js';

export interface AppOptions {
  dataDir?: string; logger?: boolean; startWorker?: boolean; maxUploadBytes?: number;
  ffmpegPath?: string; ffprobePath?: string;
}

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SUPPORTED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mp4', '.mov', '.m4v', '.webm']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class HttpError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

function inputData(body: Record<string, unknown>, existing?: Asset): AssetInput {
  const sport = body.sport ?? existing?.sport;
  if (sport !== 'basketball' && sport !== 'sprint') throw new HttpError(400, '请选择篮球或短跑。');
  const action = body.action ?? existing?.action;
  if (typeof action !== 'string' || !ACTIONS[sport].includes(action)) throw new HttpError(400, '请选择该运动对应的动作类型。');
  const timeBasis = body.timeBasis ?? existing?.timeBasis ?? 'unknown';
  if (!['unknown', 'original', 'edited'].includes(String(timeBasis))) throw new HttpError(400, '视频时间来源无效。');
  const text = (name: 'title' | 'notes', max: number): string => {
    const value = body[name] ?? existing?.[name] ?? '';
    if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `${name === 'title' ? '标题' : '备注'}长度超出限制。`);
    return value.trim();
  };
  return { sport, action, title: text('title', 160), notes: text('notes', 4000), timeBasis: timeBasis as TimeBasis };
}

export async function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 32_000, requestTimeout: 300_000 });
  const dataDir = resolve(options.dataDir ?? process.env.KHEPRI_DATA_DIR ?? join(PROJECT_DIR, 'data'));
  const assetRoot = join(dataDir, 'assets');
  await mkdir(assetRoot, { recursive: true });
  const store = new AssetStore(dataDir);
  const tools: MediaTools = { ffmpeg: options.ffmpegPath ?? defaultTools.ffmpeg, ffprobe: options.ffprobePath ?? defaultTools.ffprobe };
  const maxUploadBytes = options.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const toolsReady = { ffmpeg: await isAvailable(tools.ffmpeg), ffprobe: await isAvailable(tools.ffprobe) };
  let closing = false;
  let loop: Promise<void> | null = null;
  let active: { id: string; controller: AbortController; promise: Promise<void> } | null = null;

  const folder = (id: string) => {
    if (!UUID.test(id)) throw new HttpError(404, '素材不存在。');
    const directory = resolve(assetRoot, id);
    if (!directory.startsWith(assetRoot + sep)) throw new HttpError(400, '无效的素材路径。');
    return directory;
  };
  const originalPath = (asset: Asset) => join(folder(asset.id), `original${extname(asset.originalName).toLowerCase()}`);
  const requireAsset = (id: string) => {
    folder(id);
    const asset = store.get(id);
    if (!asset) throw new HttpError(404, '素材不存在或已删除。');
    return asset;
  };
  const processOne = async (asset: Asset, signal: AbortSignal) => {
    store.save({ ...asset, status: 'processing', error: null, updatedAt: new Date().toISOString() });
    try {
      if (!toolsReady.ffmpeg || !toolsReady.ffprobe) throw new Error('媒体处理组件未就绪，请安装依赖后重启服务再重试。');
      const result = await preprocess(asset, folder(asset.id), originalPath(asset), tools, signal);
      const current = store.get(asset.id);
      if (current && !closing) store.save({ ...current, ...result, status: 'ready', error: null, updatedAt: new Date().toISOString() });
    } catch (error) {
      const current = store.get(asset.id);
      if (current && !closing) store.save({ ...current, status: 'failed', error: error instanceof Error ? error.message : '预处理失败，请重试。', updatedAt: new Date().toISOString() });
    }
  };
  const kick = () => {
    if (loop || closing || options.startWorker === false) return;
    loop = (async () => {
      while (!closing) {
        const asset = store.list().reverse().find((item) => item.status === 'queued');
        if (!asset) break;
        const controller = new AbortController();
        const promise = processOne(asset, controller.signal);
        active = { id: asset.id, controller, promise };
        await promise;
        active = null;
      }
    })().finally(() => { loop = null; });
  };
  for (const asset of store.list()) {
    if (asset.status === 'processing') store.save({ ...asset, status: 'queued', error: null, updatedAt: new Date().toISOString() });
  }

  await app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1, fields: 8, fieldSize: 16_000, parts: 9 } });

  app.addHook('onRequest', async (request) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '此本地服务不接受跨站写入。');
    const origin = request.headers.origin;
    if (origin) {
      try {
        const host = new URL(origin).hostname;
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('origin');
      } catch { throw new HttpError(403, '此本地服务只接受本机网页请求。'); }
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const problem = error as { statusCode?: number; code?: string; message?: string };
    const status = Number(problem.statusCode) || 500;
    const oversized = status === 413 || problem.code === 'FST_REQ_FILE_TOO_LARGE';
    if (status >= 500) app.log.error(error);
    reply.code(oversized ? 413 : status).send({
      error: oversized ? `文件过大，单个文件上限为 ${Math.round(maxUploadBytes / 1024 / 1024)} MB。` : status < 500 ? (problem.message ?? '请求无效。') : '服务处理失败，请稍后重试。',
    });
  });

  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0', localOnly: true, maxUploadBytes, tools: toolsReady }));
  app.get<{ Querystring: { sport?: string; search?: string; status?: string } }>('/api/assets', async (request) => {
    let assets = store.list();
    if (request.query.sport) assets = assets.filter((asset) => asset.sport === request.query.sport);
    if (request.query.status) assets = assets.filter((asset) => asset.status === request.query.status);
    if (request.query.search) {
      const search = request.query.search.toLocaleLowerCase();
      assets = assets.filter((asset) => `${asset.title} ${asset.originalName} ${asset.action} ${asset.notes}`.toLocaleLowerCase().includes(search));
    }
    return { assets };
  });
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request) => ({ asset: requireAsset(request.params.id) }));

  app.post('/api/assets', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || key.length < 1 || key.length > 160)) throw new HttpError(400, '无效的上传请求标识。');
    const id = randomUUID();
    const directory = folder(id);
    await mkdir(directory, { recursive: true });
    let keep = false;
    try {
      const fields: Record<string, unknown> = {};
      let originalName = '';
      let sizeBytes = 0;
      let sha256 = '';
      let fileFound = false;
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (!['title', 'sport', 'action', 'notes', 'timeBasis'].includes(part.fieldname)) throw new HttpError(400, '包含不支持的素材字段。');
          if (part.valueTruncated) throw new HttpError(400, '素材说明过长。');
          fields[part.fieldname] = part.value;
          continue;
        }
        if (part.fieldname !== 'file' || fileFound) throw new HttpError(400, '每次请选择一个素材文件。');
        fileFound = true;
        originalName = basename(part.filename.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240);
        const extension = extname(originalName).toLowerCase();
        if (!SUPPORTED.has(extension)) {
          part.file.resume();
          throw new HttpError(415, '请选择 JPEG、PNG、WebP、HEIC 图片或 MP4、MOV、M4V、WebM 视频。');
        }
        const hash = createHash('sha256');
        const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length; hash.update(chunk); callback(null, chunk);
        } });
        await pipeline(part.file, meter, createWriteStream(join(directory, `original${extension}`), { flags: 'wx' }));
        if (part.file.truncated) throw new HttpError(413, '文件过大。');
        sha256 = hash.digest('hex');
      }
      if (!fileFound || sizeBytes === 0) throw new HttpError(400, '请选择一个非空的照片或视频文件。');
      const input = inputData(fields);
      const title = input.title || originalName.slice(0, 160);
      if (typeof key === 'string') {
        const previous = store.byKey(key);
        if (previous) {
          const matches = previous.sha256 === sha256 && previous.title === title && previous.sport === input.sport && previous.action === input.action && previous.notes === input.notes && previous.timeBasis === input.timeBasis;
          if (!matches) throw new HttpError(409, '该上传标识已用于另一份素材，请重新提交。');
          return reply.code(201).send({ asset: previous, reused: true });
        }
      }
      const now = new Date().toISOString();
      const asset: Asset = {
        id, originalName, title, sport: input.sport, action: input.action, notes: input.notes ?? '', timeBasis: input.timeBasis ?? 'unknown',
        kind: /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(originalName) ? 'image' : 'video', status: 'queued', error: null,
        sizeBytes, sha256, createdAt: now, updatedAt: now, metadata: null,
        previewUrl: null, posterUrl: null, originalUrl: `/api/assets/${id}/original`,
      };
      store.insert(asset, typeof key === 'string' ? key : undefined);
      keep = true;
      setImmediate(kick);
      return reply.code(201).send({ asset });
    } finally {
      if (!keep) await rm(directory, { recursive: true, force: true });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/assets/:id', async (request) => {
    const asset = requireAsset(request.params.id);
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new HttpError(400, '素材说明格式无效。');
    if (Object.keys(request.body).some((field) => !['title', 'sport', 'action', 'notes', 'timeBasis'].includes(field))) throw new HttpError(400, '只能修改标题、运动、动作、备注和时间来源。');
    const input = inputData(request.body, asset);
    const updated: Asset = { ...asset, ...input, title: input.title || asset.originalName.slice(0, 160), updatedAt: new Date().toISOString() };
    store.save(updated);
    return { asset: updated };
  });
  app.post<{ Params: { id: string } }>('/api/assets/:id/retry', async (request) => {
    const asset = requireAsset(request.params.id);
    if (asset.status !== 'failed') throw new HttpError(409, '只有预处理失败的素材需要重试。');
    const updated: Asset = { ...asset, status: 'queued', error: null, previewUrl: null, posterUrl: null, updatedAt: new Date().toISOString() };
    store.save(updated);
    setImmediate(kick);
    return { asset: updated };
  });
  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const asset = requireAsset(request.params.id);
    store.delete(asset.id);
    if (active?.id === asset.id) {
      const job = active;
      job.controller.abort();
      await job.promise;
    }
    await rm(folder(asset.id), { recursive: true, force: true });
    return reply.code(204).send();
  });

  async function sendMedia(request: FastifyRequest<{ Params: { id: string; media: string } }>, reply: FastifyReply) {
    const asset = requireAsset(request.params.id);
    const media = request.params.media;
    if (!['original', 'preview', 'poster'].includes(media)) throw new HttpError(404, '文件不存在。');
    if (media !== 'original' && asset.status !== 'ready') throw new HttpError(409, '素材预览尚未就绪。');
    const filePath = media === 'original' ? originalPath(asset) : join(folder(asset.id), media === 'preview' && asset.kind === 'video' ? 'preview.mp4' : 'poster.jpg');
    let size: number;
    try { size = (await stat(filePath)).size; } catch { throw new HttpError(404, '素材文件不存在，请重新上传。'); }
    const contentType = media === 'original' ? 'application/octet-stream' : media === 'preview' && asset.kind === 'video' ? 'video/mp4' : 'image/jpeg';
    reply.header('Content-Type', contentType).header('X-Content-Type-Options', 'nosniff').header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, no-cache');
    if (media === 'original') reply.header('Content-Disposition', `attachment; filename="original${extname(asset.originalName).toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`);
    const range = request.headers.range;
    let start = 0;
    let end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
      else { start = Math.max(0, size - Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || start < 0) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    reply.header('Content-Length', end - start + 1);
    return reply.send(createReadStream(filePath, { start, end }));
  }
  app.get<{ Params: { id: string; media: string } }>('/api/assets/:id/:media', sendMedia);

  const dist = join(PROJECT_DIR, 'dist');
  if (existsSync(join(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist, prefix: '/', wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在。' });
    if (existsSync(join(dist, 'index.html')) && request.method === 'GET') return reply.type('text/html').send(createReadStream(join(dist, 'index.html')));
    return reply.code(404).send({ error: '网页尚未构建。开发时运行 npm run dev，或先运行 npm run build。' });
  });
  app.addHook('onClose', async () => {
    closing = true;
    active?.controller.abort();
    if (loop) await loop;
    store.close();
  });
  kick();
  return app;
}

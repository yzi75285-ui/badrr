import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import type { Asset, MediaMetadata } from '../shared/contracts.js';

export interface MediaTools { ffmpeg: string; ffprobe: string }
export const defaultTools: MediaTools = {
  ffmpeg: typeof ffmpegStatic === 'string' ? ffmpegStatic : '',
  ffprobe: ffprobeStatic.path,
};

// Restrict demuxers before probing headers: a file protocol allowlist alone still
// permits local playlists to dereference other files. Keep these input options
// on both ffprobe and every ffmpeg invocation, before the input path.
const INPUT_FORMAT_WHITELIST = 'image2,jpeg_pipe,png_pipe,webp_pipe,mov,matroska';
const inputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', INPUT_FORMAT_WHITELIST];

export async function isAvailable(path: string): Promise<boolean> {
  if (!path) return false;
  try { await access(path); return true; } catch { return false; }
}

export async function runMediaCommand(binary: string, args: string[], signal?: AbortSignal, timeout = 180_000): Promise<string> {
  if (signal?.aborted) throw new Error('预处理已取消。');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let output = '';
    let errorOutput = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.length > 4_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (data: Buffer) => { errorOutput = (errorOutput + data.toString()).slice(-16_000); });
    child.on('error', (error) => { cleanup(); reject(new Error(`媒体处理工具无法启动：${error.message}`)); });
    child.on('close', (code) => {
      cleanup();
      if (signal?.aborted) reject(new Error('预处理已取消。'));
      else if (timedOut) reject(new Error('预处理超时，请剪选较短的原始片段后重试。'));
      else if (code !== 0 && /not on whitelist/i.test(errorOutput)) reject(new Error('素材格式不受支持，已拒绝播放列表或间接媒体引用。'));
      else if (code !== 0) reject(new Error(`媒体内容无法解码或格式暂不支持。${errorOutput.includes('Invalid data') ? '请检查文件是否完整。' : ''}`));
      else resolve(output);
    });
  });
}

interface ProbeStream {
  codec_type?: string; codec_name?: string; width?: number; height?: number;
  avg_frame_rate?: string; r_frame_rate?: string; duration?: string;
  tags?: { rotate?: string }; side_data_list?: { rotation?: number }[];
}
interface Probe { streams?: ProbeStream[]; format?: { format_name?: string; duration?: string } }

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function frameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [n, d = '1'] = value.split('/');
  return positiveNumber(Number(n) / Number(d));
}

export async function preprocess(asset: Asset, directory: string, originalPath: string, tools: MediaTools, signal: AbortSignal): Promise<Pick<Asset, 'kind' | 'metadata' | 'previewUrl' | 'posterUrl'>> {
  if (/\.(heic|heif)$/i.test(asset.originalName)) {
    throw new Error('HEIC／HEIF 原片已保存，当前预览暂不支持。请导出 JPEG 后重新上传；原片仍可下载。');
  }
  const json = await runMediaCommand(tools.ffprobe, [
    '-v', 'error', ...inputOptions, '-show_format', '-show_streams', '-of', 'json', originalPath,
  ], signal, 20_000);
  const probe = JSON.parse(json) as Probe;
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('素材中没有可解码的图像或视频画面。');
  const container = probe.format?.format_name ?? 'unknown';
  const imageContainer = /image2|png_pipe|jpeg_pipe|webp_pipe/.test(container);
  const videoContainer = /mov|mp4|matroska|webm/.test(container);
  if (!imageContainer && !videoContainer) throw new Error('当前支持 JPEG、PNG、WebP 图片，以及 MP4、MOV、M4V、WebM 视频。');
  const kind: 'image' | 'video' = imageContainer ? 'image' : 'video';
  if (kind === 'video' && /\.(jpe?g|png|webp)$/i.test(asset.originalName)) throw new Error('文件扩展名与实际视频内容不一致，请使用原始文件名重新上传。');
  const duration = positiveNumber(probe.format?.duration ?? video.duration);
  if (kind === 'video' && duration && duration > 1200) throw new Error('当前单段视频上限为 20 分钟，请剪选目标动作片段后上传。');
  const rotation = Number(video.side_data_list?.find((item) => typeof item.rotation === 'number')?.rotation ?? video.tags?.rotate ?? 0);
  const metadata: MediaMetadata = {
    width: video.width, height: video.height,
    durationSec: kind === 'video' ? duration : null,
    fps: kind === 'video' ? frameRate(video.avg_frame_rate ?? video.r_frame_rate) : null,
    codec: video.codec_name ?? 'unknown', container,
    rotation: Number.isFinite(rotation) ? rotation : 0,
    hasAudio: Boolean(probe.streams?.some((stream) => stream.codec_type === 'audio')),
  };
  const base = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputOptions, '-i', originalPath];
  const scale = 'scale=w=min(1280\\,iw):h=min(1280\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1';
  await runMediaCommand(tools.ffmpeg, [...base, '-map', '0:v:0', '-frames:v', '1', '-vf', scale, '-q:v', '3', join(directory, 'poster.jpg')], signal);
  if (kind === 'image') {
    return { kind, metadata, previewUrl: `/api/assets/${asset.id}/preview`, posterUrl: `/api/assets/${asset.id}/poster` };
  }
  await runMediaCommand(tools.ffmpeg, [...base,
    '-map', '0:v:0', '-map', '0:a?', '-vf', scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-map_metadata', '-1', join(directory, 'preview.mp4'),
  ], signal);
  return { kind, metadata, previewUrl: `/api/assets/${asset.id}/preview`, posterUrl: `/api/assets/${asset.id}/poster` };
}

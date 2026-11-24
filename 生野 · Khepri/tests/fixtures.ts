import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/** Synthetic codec fixtures only: these are not athletes or motion-analysis evidence. */
export async function createMediaFixtures(directory: string) {
  await mkdir(directory, { recursive: true });
  const ffmpeg = require('ffmpeg-static') as string | null;
  if (!ffmpeg) throw new Error('The test host has no packaged FFmpeg binary.');

  const imagePath = path.join(directory, 'synthetic-grid.jpg');
  const videoPath = path.join(directory, 'synthetic-motion.mp4');
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-frames:v', '1', '-q:v', '3', imagePath,
  ], { timeout: 30_000, windowsHide: true });
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
  ], { timeout: 30_000, windowsHide: true });

  return {
    imagePath,
    videoPath,
    image: await readFile(imagePath),
    video: await readFile(videoPath),
  };
}

export interface FixtureVideoStream {
  codec_name: string;
  width: number;
  height: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

/** Read the encoded file itself; no application metadata is used as the oracle. */
export async function probeVideoFile(filename: string): Promise<FixtureVideoStream> {
  const ffprobe = (require('ffprobe-static') as { path: string }).path;
  const { stdout } = await execute(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', filename,
  ], { timeout: 30_000, windowsHide: true });
  const parsed = JSON.parse(stdout) as { streams?: FixtureVideoStream[] };
  if (!parsed.streams?.[0]) throw new Error('The generated media has no video stream.');
  return parsed.streams[0];
}

export async function decodeVideoFile(filename: string): Promise<void> {
  const ffmpeg = require('ffmpeg-static') as string | null;
  if (!ffmpeg) throw new Error('The test host has no packaged FFmpeg binary.');
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-xerror', '-i', filename,
    '-map', '0:v:0', '-f', 'null', '-',
  ], { timeout: 30_000, windowsHide: true });
}

/** Exercises the HEVC/MOV container and display matrix used by rotated phone video. */
export async function createRotatedHevcFixture(directory: string) {
  await mkdir(directory, { recursive: true });
  const ffmpeg = require('ffmpeg-static') as string | null;
  if (!ffmpeg) throw new Error('The test host has no packaged FFmpeg binary.');
  const { stdout } = await execute(ffmpeg, ['-hide_banner', '-encoders'], {
    timeout: 30_000, windowsHide: true,
  });
  if (!/\blibx265\b/.test(stdout)) return null;

  const basePath = path.join(directory, 'synthetic-hevc-base.mov');
  const rotatedPath = path.join(directory, 'synthetic-hevc-rotated.mov');
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '1',
    '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-x265-params', 'pools=1:frame-threads=1:log-level=error',
    '-tag:v', 'hvc1', '-movflags', '+faststart', basePath,
  ], { timeout: 30_000, windowsHide: true });
  // Add a display matrix without physically rotating or re-encoding the source.
  await execute(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', basePath,
    '-c', 'copy', rotatedPath,
  ], { timeout: 30_000, windowsHide: true });
  return { path: rotatedPath, bytes: await readFile(rotatedPath) };
}

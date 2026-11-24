import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { preprocess, defaultTools } from '../src/server/media.ts';
import type { Asset } from '../src/shared/contracts.ts';
import { createMediaFixtures } from './fixtures.ts';

test('a playlist disguised as MP4 is rejected by the input demuxer whitelist', { timeout: 30_000 }, async () => {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const scratchRoot = path.join(projectRoot, '.tmp');
  await mkdir(scratchRoot, { recursive: true });
  const runDirectory = await mkdtemp(path.join(scratchRoot, 'media-safety-'));
  try {
    const fixtures = await createMediaFixtures(runDirectory);
    // The referenced file belongs only to this test; no real user files are read.
    // Without a demuxer whitelist ffprobe accepts this relative concat reference
    // and reads the target before our later container validation can reject it.
    const disguisedPath = path.join(runDirectory, 'disguised.mp4');
    await writeFile(disguisedPath, "ffconcat version 1.0\nfile 'synthetic-motion.mp4'\n");
    const asset: Asset = {
      id: '00000000-0000-4000-8000-000000000001', title: 'Playlist regression',
      originalName: 'disguised.mp4', sport: 'sprint', action: '加速', notes: '',
      timeBasis: 'unknown', kind: 'video', status: 'queued', error: null,
      sizeBytes: (await readFile(disguisedPath)).length, sha256: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      metadata: null, previewUrl: null, posterUrl: null, originalUrl: '',
    };
    await assert.rejects(
      preprocess(asset, runDirectory, disguisedPath, defaultTools, new AbortController().signal),
      /已拒绝播放列表或间接媒体引用/,
      'The native whitelist rejection must happen before container/stream inspection.',
    );
    await assert.rejects(readFile(path.join(runDirectory, 'poster.jpg')), { code: 'ENOENT' });
    assert.deepEqual(await readFile(fixtures.videoPath), fixtures.video);
  } finally {
    const relative = path.relative(scratchRoot, path.resolve(runDirectory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(path.basename(runDirectory).startsWith('media-safety-'));
    await rm(runDirectory, { recursive: true, force: true });
  }
});

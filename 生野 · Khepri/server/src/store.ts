import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredMedia, TaskRecord } from "./types.js";

export class Store {
  constructor(readonly root: string) {}

  async init(): Promise<void> {
    await mkdir(this.mediaRoot, { recursive: true });
    await mkdir(this.taskRoot, { recursive: true });
    const folders = await readdir(this.mediaRoot);
    for (const name of folders) {
      const record = path.join(this.mediaRoot, name, "record.json");
      if (!existsSync(record)) await rm(path.join(this.mediaRoot, name), { recursive: true, force: true });
    }
    await rm(this.incomingRoot, { recursive: true, force: true });
    await mkdir(this.incomingRoot, { recursive: true });
    await this.loadKeys();
  }

  get mediaRoot(): string {
    return path.join(this.root, "media");
  }

  get taskRoot(): string {
    return path.join(this.root, "tasks");
  }

  get incomingRoot(): string {
    return path.join(this.root, "incoming");
  }

  private get keyFile(): string {
    return path.join(this.root, "idempotency.json");
  }

  private keys = new Map<string, string>();

  async tempFile(): Promise<string> {
    const name = `${randomBytes(16).toString("hex")}.part`;
    return path.join(this.incomingRoot, name);
  }

  mediaDir(id: string): string {
    return path.join(this.mediaRoot, id);
  }

  originalPath(media: StoredMedia): string {
    return path.join(this.mediaDir(media.media_id), `original.${media.extension}`);
  }

  previewPath(media: StoredMedia): string | null {
    if (!media.preview_extension) return null;
    return path.join(this.mediaDir(media.media_id), `preview.${media.preview_extension}`);
  }

  async listMedia(): Promise<StoredMedia[]> {
    const names = await readdir(this.mediaRoot).catch(() => []);
    const records = await Promise.all(names.map(async (name) => this.readMedia(name)));
    return records
      .filter((record): record is StoredMedia => record !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async readMedia(id: string): Promise<StoredMedia | null> {
    return readJson<StoredMedia>(path.join(this.mediaDir(id), "record.json"));
  }

  async saveMedia(media: StoredMedia): Promise<void> {
    const dir = this.mediaDir(media.media_id);
    await mkdir(dir, { recursive: true });
    await writeJson(path.join(dir, "record.json"), media);
  }

  async deleteMedia(id: string): Promise<void> {
    await rm(this.mediaDir(id), { recursive: true, force: true });
  }

  async listTasks(): Promise<TaskRecord[]> {
    const names = await readdir(this.taskRoot).catch(() => []);
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => readJson<TaskRecord>(path.join(this.taskRoot, name))),
    );
    return records
      .filter((record): record is TaskRecord => record !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async readTask(id: string): Promise<TaskRecord | null> {
    return readJson<TaskRecord>(path.join(this.taskRoot, `${id}.json`));
  }

  async saveTask(task: TaskRecord): Promise<void> {
    await mkdir(this.taskRoot, { recursive: true });
    await writeJson(path.join(this.taskRoot, `${task.task_id}.json`), task);
  }

  async deleteTask(id: string): Promise<void> {
    await rm(path.join(this.taskRoot, `${id}.json`), { force: true });
  }

  findIdempotency(key: string): string | null {
    return this.keys.get(key) ?? null;
  }

  async rememberIdempotency(key: string, mediaId: string): Promise<void> {
    this.keys.set(key, mediaId);
    await writeJson(this.keyFile, Object.fromEntries(this.keys));
  }

  async forgetIdempotency(mediaId: string): Promise<void> {
    let changed = false;
    for (const [key, id] of this.keys) {
      if (id === mediaId) {
        this.keys.delete(key);
        changed = true;
      }
    }
    if (changed) await writeJson(this.keyFile, Object.fromEntries(this.keys));
  }

  private async loadKeys(): Promise<void> {
    const raw = await readJson<Record<string, string>>(this.keyFile);
    this.keys = new Map(Object.entries(raw ?? {}));
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

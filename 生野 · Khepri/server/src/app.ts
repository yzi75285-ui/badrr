import { existsSync } from "node:fs";
import path from "node:path";
import { resolveBinaries, type Binaries } from "./binaries.js";
import { handleRequest, type AppContext } from "./http.js";
import { ingestMedia } from "./ingest.js";
import { IngestQueue } from "./queue.js";
import { failure } from "./scrub.js";
import { Store } from "./store.js";
import { emptyPreview } from "./types.js";
import type { IncomingMessage, ServerResponse } from "node:http";

export type App = {
  dataDir: string;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
};

export async function createApp(options: { dataDir: string; publicDir?: string; binaries?: Binaries }): Promise<App> {
  const store = new Store(path.resolve(options.dataDir));
  await store.init();
  const binaries = options.binaries ?? resolveBinaries();
  const queue = new IngestQueue((id) => ingestMedia(store, id, binaries));
  await recover(store, queue);
  const ctx: AppContext = {
    store,
    queue,
    binaries,
    publicDir: options.publicDir,
    inflight: new Set<string>(),
  };
  return {
    dataDir: store.root,
    handle(req, res) {
      return handleRequest(req, res, ctx);
    },
    close() {
      return queue.idle();
    },
  };
}

async function recover(store: Store, queue: IngestQueue): Promise<void> {
  const media = await store.listMedia();
  for (const item of [...media].reverse()) {
    if (item.status === "ready") {
      const preview = store.previewPath(item);
      if (item.preview.available && (!preview || !existsSync(preview))) {
        item.status = "failed";
        item.failure = failure("preview_missing", "预览文件不在了。原片仍在，可以重试预处理。", []);
        item.preview = emptyPreview();
        item.preview_extension = null;
        item.updated_at = new Date().toISOString();
        await store.saveMedia(item);
        const task = await store.readTask(item.task_id);
        if (task) {
          task.status = "failed";
          task.error = item.failure;
          task.updated_at = item.updated_at;
          await store.saveTask(task);
        }
      }
      continue;
    }
    if (item.status === "received" || item.status === "preprocessing") queue.enqueue(item.media_id);
  }
}

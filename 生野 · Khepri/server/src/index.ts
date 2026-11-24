import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dataDir = process.env.KHEPRI_DATA ? path.resolve(process.env.KHEPRI_DATA) : path.join(root, "var");
const publicDir = path.join(root, "web", "dist");
const host = process.env.KHEPRI_HOST ?? "127.0.0.1";
const port = Number(process.env.KHEPRI_PORT ?? 4780);

const app = await createApp({
  dataDir,
  publicDir: existsSync(path.join(publicDir, "index.html")) ? publicDir : undefined,
});
const server = createServer((req, res) => {
  void app.handle(req, res);
});

server.listen(port, host, () => {
  const page = existsSync(path.join(publicDir, "index.html")) ? `http://${host}:${port}` : "网页开发地址 http://127.0.0.1:5173";
  console.log(`KHEPRI 第 1 段已启动。页面：${page} 。接口：http://${host}:${port}/api/health`);
});

function shutdown() {
  server.close(() => {
    void app.close().then(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

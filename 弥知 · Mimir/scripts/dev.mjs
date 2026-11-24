import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const [name, args] of [
  ["server", ["--import", "tsx", "server/index.ts"]],
  ["web", ["node_modules/vite/bin/vite.js"]],
]) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
  children.push(child);
  child.on("error", (error) => {
    console.error(`[${name}] ${error.message}`);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

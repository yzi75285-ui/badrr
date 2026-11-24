import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效的端口号。');
const app = await createApp({ logger: true });
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`KHEPRI 本地服务：http://127.0.0.1:${port}`);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void app.close().then(() => process.exit(0));
  });
}

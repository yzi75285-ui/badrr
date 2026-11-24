import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.MIMIR_WEB_PORT ?? 5178),
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.MIMIR_PORT || 4317}`,
        changeOrigin: true,
      },
    },
  },
});

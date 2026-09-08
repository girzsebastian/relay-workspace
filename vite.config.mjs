import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("@codemirror") ||
            id.includes("@lezer") ||
            id.includes("node_modules/codemirror")
          )
            return "editor";
          if (id.includes("@xterm")) return "terminal";
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/scheduler")
          )
            return "react";
        },
      },
    },
  },
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
});

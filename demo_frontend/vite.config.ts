import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      "/agent": "http://127.0.0.1:3000",
      "/session": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000"
    }
  }
});

import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  fmt: {
    ignorePatterns: ["dist/**", "drizzle/meta/**"],
  },
  lint: {
    ignorePatterns: ["dist/**"],
  },
});

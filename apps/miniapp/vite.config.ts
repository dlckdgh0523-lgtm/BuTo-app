import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@apps-in-toss/web-framework")) {
            return "tossFramework";
          }

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("react/jsx-runtime")
          ) {
            return "react-vendor";
          }
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 3000
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  }
});

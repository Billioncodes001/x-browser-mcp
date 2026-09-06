import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  root: "dashboard",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dashboard-dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/")) {
            if (/\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id))
              return "motion";
            if (/\/(react|react-dom|scheduler)\//.test(id)) return "react";
          }
        },
      },
    },
  },
});

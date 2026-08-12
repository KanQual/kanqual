import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), nodePolyfills()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("vite/preload-helper")) {
            return "preload-helper";
          }

          if (
            id.includes("cytoscape")
            || id.includes("elkjs")
            || id.includes("src/lib/postgresCanvasGraph.ts")
            || id.includes("src/views/Postgres_Explore_Canvas_View.tsx")
            || id.includes("src/components/CanvasRichTextEditor.tsx")
          ) {
            return "canvas-graph";
          }

          if (!id.includes("node_modules")) return;

          if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("/orderedmap/")) {
            return "editor";
          }

          if (id.includes("/jspdf/")) {
            return "export-pdf";
          }

          if (id.includes("/docx/")) {
            return "export-docx";
          }

          if (id.includes("/write-excel-file/") || id.includes("/read-excel-file/")) {
            return "export-excel";
          }

          if (id.includes("/html2canvas/")) {
            return "export-html";
          }

          if (id.includes("/pdfjs-dist/")) {
            return "pdf";
          }

          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "react-vendor";
          }

          if (id.includes("/pocketbase/")) {
            return "pocketbase";
          }

          if (id.includes("/@tauri-apps/")) {
            return "tauri";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

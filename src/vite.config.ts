import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tsconfigPaths from 'vite-tsconfig-paths';
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths({ root: path.resolve(import.meta.dirname, "..") }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
      ? [
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer(),
        ),
        await import("@replit/vite-plugin-dev-banner").then((m) =>
          m.devBanner(),
        ),
      ]
      : []),
  ],
  root: path.resolve(import.meta.dirname, "client"),
  resolve: {
    alias: {
      // Manual fallback to ensure Vite resolves aliased paths correctly
      "#": path.resolve(import.meta.dirname, "client/src"),
      "#shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../dist/server/public"),
    emptyOutDir: true,
    sourcemap: true, // production debugging
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: [ "react", "react-dom", "wouter" ],
          ui: [ "@radix-ui/react-slot", "lucide-react", "clsx", "tailwind-merge" ],
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: [ "**/.*" ],
    },
    sourcemapIgnoreList: false, // Ensure source maps are not ignored
  },
});

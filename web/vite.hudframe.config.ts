import { defineConfig } from 'vite';

// Builds the sandboxed HUD frame (src/frame/hudFrame.tsx) as one classic
// IIFE script into public/, where the main dev server and build pick it up
// as a static asset (predev/prebuild in package.json).
//
// Why not a second module entry in the main build: the frame iframe runs in
// an opaque origin (sandbox without allow-same-origin), and module scripts
// are CORS-fetched without credentials, which the deployment's basic-auth
// rejects with 401. Classic scripts load no-cors with credentials.
export default defineConfig({
  // public/ is this build's output target, not an asset source.
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/frame/hudFrame.tsx',
      output: {
        format: 'iife',
        entryFileNames: 'hud-frame.js',
        assetFileNames: 'hud-frame.[ext]',
      },
    },
  },
});

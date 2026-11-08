import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev too: the browser talks to Vite, Vite forwards /api to Nest.
    // This keeps the session cookie first-party and avoids CORS entirely.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: app deploys don't invalidate cached React/KaTeX/mathjs.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](katex|mathjs|fraction\.js|complex\.js|decimal\.js)[\\/]/.test(id))
            return 'math';
          if (/[\\/](react|react-dom|react-router|scheduler|@tanstack)[\\/]/.test(id))
            return 'react';
          return 'vendor';
        },
      },
    },
  },
});

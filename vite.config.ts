import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SPA talks to the Render backend with absolute URLs (VITE_API_URL), so no
// dev proxy is needed: the same build works locally and on Vercel.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});

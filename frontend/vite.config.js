import { defineConfig } from 'vite';

// En développement, /api est relayé vers le back-end local (npm run dev dans backend/).
export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: { sourcemap: false, assetsInlineLimit: 0 },
});

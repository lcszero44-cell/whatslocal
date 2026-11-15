import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const apiTarget = 'http://127.0.0.1:3333';
const localProxy = () => ({
  target: apiTarget,
  changeOrigin: true,
  headers: { Origin: apiTarget }
});

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/client'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/local-config': localProxy(),
      '/instance': localProxy(),
      '/message': localProxy(),
      '/settings': localProxy(),
      '/socket.io': {
        ...localProxy(),
        ws: true,
        configure(proxy) {
          proxy.on('proxyReqWs', (proxyRequest) => proxyRequest.setHeader('Origin', apiTarget));
        }
      }
    }
  }
});

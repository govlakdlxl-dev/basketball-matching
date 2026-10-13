import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {rolldownOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),map:fileURLToPath(new URL('./map.html',import.meta.url))}}},
});

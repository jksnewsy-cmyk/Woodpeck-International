import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/Woodpeck-International/' : '/',
  build: {
    rollupOptions: {
      input: {
        home: resolve(process.cwd(), 'index.html'),
        store: resolve(process.cwd(), 'store.html'),
      },
    },
  },
});

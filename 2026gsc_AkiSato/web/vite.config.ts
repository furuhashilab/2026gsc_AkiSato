import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : works both at https://<user>.github.io/<repo>/ and locally
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});

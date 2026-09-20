import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Charts are a third of the bundle but only the dashboard draws them,
         * and React itself never changes between deploys. Splitting both out
         * keeps the first paint small and lets the browser cache them.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Keeps the browser on one origin, so no CORS in development.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});

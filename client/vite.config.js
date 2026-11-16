import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// In development the React app runs on :5173 and forwards /api calls to the Express server.
// The API port is read from the project-root .env file (PORT), defaulting to 5000.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '..', ''), ...process.env };
  const apiPort = env.PORT || 5000;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});

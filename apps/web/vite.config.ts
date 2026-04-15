import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useHttps = env.VITE_DEV_HTTPS === 'true';

  return {
    plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
    server: {
      host: '127.0.0.1',
      port: 5173,
      https: useHttps ? {} : undefined,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});

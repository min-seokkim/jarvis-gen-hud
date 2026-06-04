import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 모든 env(접두사 없는 것 포함)를 Node 쪽에서만 읽는다.
  // API_SERVER_KEY 는 VITE_ 접두사가 없으므로 클라이언트 번들에 절대 들어가지 않는다.
  const env = loadEnv(mode, process.cwd(), '');
  const hermesTarget = env.HERMES_TARGET || 'http://localhost:8642';
  const apiKey = env.API_SERVER_KEY || '';

  return {
    plugins: [react()],
    server: {
      proxy: {
        // dev에서 같은 출처 /v1/* 를 Hermes로 넘기며 Authorization을 프록시 단(서버측)에서 주입.
        // 배포에선 Caddy가 동일 역할을 한다(deploy/Caddyfile).
        '/v1': {
          target: hermesTarget,
          changeOrigin: true,
          // 프록시가 타깃으로 보내는 요청에 Authorization을 정적으로 붙인다.
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        },
      },
    },
  };
});

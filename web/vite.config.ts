import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(process.cwd(), '..');

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 모든 env(접두사 없는 것 포함)를 Node 쪽에서만 읽는다.
  // API_SERVER_KEY 는 VITE_ 접두사가 없으므로 클라이언트 번들에 절대 들어가지 않는다.
  const env = loadEnv(mode, process.cwd(), '');
  const hermesTarget = env.HERMES_TARGET || 'http://127.0.0.1:8642';
  const apiKey = env.API_SERVER_KEY || '';

  return {
    define: {
      __JARVIS_PROJECT_ROOT__: JSON.stringify(projectRoot),
    },
    plugins: [
      react(),
      {
        name: 'jarvis-project-status',
        configureServer(server) {
          server.middlewares.use('/__jarvis/project-status', async (_req, res) => {
            try {
              const status = await readProjectStatus();
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(status));
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: message }));
            }
          });
        },
      },
      {
        // Hermes(aiohttp)는 브라우저 Origin 헤더가 붙은 요청을 403으로 거절한다.
        // 프록시로 넘기기 전에 /v1 요청의 Origin을 제거(서버↔서버 요청처럼 보이게).
        // 배포에선 Caddy가 동일 처리해야 한다: reverse_proxy 블록에 `header_up -Origin`.
        name: 'hermes-strip-origin',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url?.startsWith('/v1')) delete req.headers.origin;
            next();
          });
        },
      },
    ],
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
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  };
});

async function readProjectStatus() {
  const [gitStatus, branch, commit, packageJson] = await Promise.all([
    runGit(['status', '--short']),
    runGit(['branch', '--show-current']),
    runGit(['rev-parse', '--short', 'HEAD']),
    readPackageJson(),
  ]);
  const changes = parseGitStatus(gitStatus);

  return {
    root: projectRoot,
    branch: branch.trim() || 'detached',
    commit: commit.trim(),
    changedFiles: changes.changedFiles,
    stagedFiles: changes.stagedFiles,
    unstagedFiles: changes.unstagedFiles,
    untrackedFiles: changes.untrackedFiles,
    files: changes.files.slice(0, 8),
    packageName: packageJson.name ?? 'web',
    scripts: Object.keys(packageJson.scripts ?? {}),
    generatedAt: new Date().toISOString(),
  };
}

async function runGit(args: string[]) {
  const { stdout } = await execFileAsync('git', ['-C', projectRoot, ...args], {
    windowsHide: true,
  });
  return stdout;
}

async function readPackageJson(): Promise<{
  name?: string;
  scripts?: Record<string, string>;
}> {
  const source = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  return JSON.parse(source) as { name?: string; scripts?: Record<string, string> };
}

function parseGitStatus(source: string) {
  const files = source
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const indexStatus = line[0] ?? ' ';
      const worktreeStatus = line[1] ?? ' ';

      return {
        status: line.slice(0, 2).trim() || 'modified',
        path: line.slice(3),
        indexStatus,
        worktreeStatus,
      };
    });

  return {
    changedFiles: files.length,
    stagedFiles: files.filter(
      (file) => file.indexStatus !== ' ' && file.indexStatus !== '?',
    ).length,
    unstagedFiles: files.filter(
      (file) => file.worktreeStatus !== ' ' && file.worktreeStatus !== '?',
    ).length,
    untrackedFiles: files.filter(
      (file) => file.indexStatus === '?' && file.worktreeStatus === '?',
    )
      .length,
    files: files.map((file) => ({
      status: file.status,
      path: file.path,
    })),
  };
}

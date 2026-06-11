/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Hermes에 보낼 모델명 (비밀 아님). */
  readonly VITE_HERMES_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __JARVIS_PROJECT_ROOT__: string;

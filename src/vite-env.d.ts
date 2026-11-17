/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_JURY_TOKEN?: string;
  readonly VITE_AUDITOR_TOKEN?: string;
  readonly VITE_DEFAULT_TOPIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

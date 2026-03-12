/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUTO_API_BASE_URL?: string;
  readonly VITE_BUTO_SUPPORT_KAKAOTALK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

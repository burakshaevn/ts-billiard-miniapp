/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_GAME_SERVER?: string;
  readonly VITE_BOT_APP_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

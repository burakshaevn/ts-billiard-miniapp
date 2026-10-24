/**
 * Build-time configuration.
 *
 * GitHub Pages serves static files only: it cannot answer a WebSocket upgrade,
 * so the authoritative game server has to live on another host and its address
 * is baked in at build time (`VITE_GAME_SERVER`). Without it the client still
 * works, but only as an offline practice table.
 */
const env = import.meta.env;
const SERVER = (env.VITE_GAME_SERVER ?? "").trim();
/** Direct link to the Mini App, e.g. https://t.me/my_bot/pool — used for invites. */
export const BOT_APP_URL = (env.VITE_BOT_APP_URL ?? "").trim();
/** Hosts that are known to be static-only, where guessing a same-origin /ws is pointless. */
const STATIC_HOSTS = /(^|\.)(github\.io|pages\.dev)$/i;

/** Address of the authoritative server, or null when online play is unavailable. */
export function gameSocketUrl(): string | null {
  if (SERVER) {
    try {
      const url = new URL(SERVER, location.href);
      url.protocol =
        url.protocol === "http:"
          ? "ws:"
          : url.protocol === "https:"
            ? "wss:"
            : url.protocol;
      if (!/\/ws\/?$/.test(url.pathname))
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }
  if (STATIC_HOSTS.test(location.hostname)) return null;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export const ONLINE_AVAILABLE = gameSocketUrl() !== null;

function normalizeCode(value: string | null | undefined) {
  const code = (value || "")
    .toUpperCase()
    .replace(/[^A-F0-9]/g, "")
    .slice(0, 6);
  return code.length === 6 ? code : "";
}

/**
 * Room code the app was opened with: `?room=` in the browser or the Telegram
 * start parameter (`https://t.me/bot/app?startapp=CODE`).
 */
export function startRoomCode(): string {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return (
    normalizeCode(query.get("room")) ||
    normalizeCode(query.get("tgWebAppStartParam")) ||
    normalizeCode(hash.get("tgWebAppStartParam")) ||
    normalizeCode(window.Telegram?.WebApp?.initDataUnsafe?.start_param)
  );
}

/** Invitation that opens the room: inside Telegram when the Mini App link is known. */
export function inviteLink(code: string): string {
  if (BOT_APP_URL)
    return `${BOT_APP_URL}${BOT_APP_URL.includes("?") ? "&" : "?"}startapp=${code}`;
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

export type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  viewportStableHeight?: number;
  contentSafeAreaInset?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  openTelegramLink?: (url: string) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy") => void;
  };
  initDataUnsafe?: {
    start_param?: string;
    user?: { first_name: string; last_name?: string };
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** True inside the Telegram WebView, where the UI must be a single game screen. */
export function isTelegramClient(): boolean {
  return (
    !!window.Telegram?.WebApp ||
    location.hash.includes("tgWebApp") ||
    location.search.includes("tgWebApp")
  );
}

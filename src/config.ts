/**
 * Build-time configuration and the single place where the online server is
 * wired in.
 *
 * Right now the app is meant to run as a static build (GitHub Pages), where
 * practice works offline and online play is a placeholder: GitHub Pages serves
 * files only and cannot answer a WebSocket upgrade.
 *
 * To switch online on later, nothing in the UI has to change — just give the
 * build an address:
 *
 *   VITE_GAME_SERVER=wss://your-server.example.com npm run build
 *
 * or, for a quick test of an existing deployment, open the page with
 * `?server=wss://your-server.example.com`. The choice is remembered in
 * localStorage: `?server=off` forces the practice-only mode, `?server=auto`
 * goes back to the build defaults.
 */
const env = import.meta.env;
const SERVER = (env.VITE_GAME_SERVER ?? "").trim();
/** Direct link to the Mini App, e.g. https://t.me/my_bot/pool — used for invites. */
export const BOT_APP_URL = (env.VITE_BOT_APP_URL ?? "").trim();
/** Hosts that are known to be static-only, where guessing a same-origin /ws is pointless. */
const STATIC_HOSTS = /(^|\.)(github\.io|pages\.dev|netlify\.app|vercel\.app)$/i;
const OVERRIDE_KEY = "luza-server";

function toSocketUrl(value: string): string | null {
  try {
    const url = new URL(value, location.href);
    url.protocol =
      url.protocol === "http:"
        ? "ws:"
        : url.protocol === "https:"
          ? "wss:"
          : url.protocol;
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (!/\/ws\/?$/.test(url.pathname))
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function sameOriginSocket() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

/** Manual override for testing a server before it is baked into the build. */
function overrideSocket(): string | "off" | null {
  let stored: string | null = null;
  try {
    const asked = new URLSearchParams(location.search).get("server");
    if (asked === "auto") localStorage.removeItem(OVERRIDE_KEY);
    else if (asked) localStorage.setItem(OVERRIDE_KEY, asked);
    stored = localStorage.getItem(OVERRIDE_KEY);
  } catch {
    /* Private browsing can disable storage. */
  }
  if (!stored) return null;
  return stored === "off" ? "off" : toSocketUrl(stored);
}

/**
 * Address of the authoritative server, or null when only practice is available.
 * Without a configured address the client never guesses blindly: it asks the
 * current origin once, so a static deployment stays silent instead of looping
 * over failed WebSocket connections.
 */
export async function resolveGameServer(): Promise<string | null> {
  const override = overrideSocket();
  if (override === "off") return null;
  if (override) return override;
  if (SERVER) return toSocketUrl(SERVER);
  if (env.DEV) return sameOriginSocket();
  if (STATIC_HOSTS.test(location.hostname)) return null;
  try {
    const probe = AbortSignal.timeout(2500);
    const response = await fetch(new URL("api/health", document.baseURI), {
      signal: probe,
    });
    return response.ok ? sameOriginSocket() : null;
  } catch {
    return null;
  }
}

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
    impactOccurred?: (
      style: "light" | "medium" | "heavy" | "rigid" | "soft",
    ) => void;
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

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Flag,
  Gamepad2,
  History,
  Link,
  LoaderCircle,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Star,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Berry from "./Berry";
import Table from "./Table";
import Avatar from "./Avatar";
import BallIcon from "./BallIcon";
import MiniApp from "./MiniApp";
import {
  LOGO_URL,
  inviteLink,
  isTelegramClient,
  playerKey,
  resolveGameServer,
  startRoomCode,
} from "./config";
import {
  PACKS,
  STAKES,
  berries,
  canAfford,
  stakeLabel,
  type Stake,
} from "../shared/wallet";
import {
  createGame,
  shoot,
  step,
  shotSpeedMps,
  type Game,
} from "../shared/game";
import { STROKE_MS, type CueStroke } from "../shared/rendering";
import { BOT_NAMES, BOT_SKILL, planShot } from "../shared/bot";

type Player = { id: string; name: string; avatar?: string; bot?: boolean };
type Match = { date: string; result: string; shots: number; opponent: string };
/** A table in the lobby list: someone is sitting there, waiting for a rival. */
export type OpenTable = {
  code: string;
  host: string;
  avatar?: string;
  stake: number;
  created: number;
};
type Modal =
  | "rules"
  | "friends"
  | "history"
  | "profile"
  | "leave"
  | "tables"
  | "wallet"
  | null;
/** Phones in both orientations get the Mini App layout; wide desktops keep the club page. */
const COMPACT_QUERY =
  "(max-width:760px),(max-height:520px) and (max-width:1100px)";
/** Russian plural: 1 удар, 2 удара, 5 ударов. */
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10,
    mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsing can disable storage. */
  }
}
function App() {
  const [name, setName] = useState(() => load("luza-name", "Гость"));
  const [draftName, setDraftName] = useState(name);
  // "bot" is a full match against the computer, played in this browser: it
  // is what makes the game playable with no game server at all.
  const [mode, setMode] = useState<"practice" | "searching" | "online" | "bot">(
    "practice",
  );
  const [page, setPage] = useState("play"),
    [modal, setModal] = useState<Modal>(null),
    [mobileMenu, setMobileMenu] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const strokeRef = useRef<CueStroke | null>(null);
  const strokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [power, setPower] = useState(0.65),
    [sound, setSound] = useState(() => load("luza-sound", true)),
    // Straight down by default: that is how a pool game on a phone looks,
    // and the whole table fits the screen without perspective squash.
    [view, setView] = useState<"angled" | "top">(() =>
      load<string>("luza-view", "top") === "angled" ? "angled" : "top",
    );
  // null = still resolving the server address, false = practice-only build.
  const [onlineAvailable, setOnlineAvailable] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false),
    [population, setPopulation] = useState(0),
    [players, setPlayers] = useState<Player[]>([]),
    [myIndex, setMyIndex] = useState(0),
    [code, setCode] = useState(""),
    [joinCode, setJoinCode] = useState("");
  // My own Telegram photo: drawn next to my name over the table.
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  // Telegram and phones get the single-screen Mini App layout: menu, then table.
  const [compact, setCompact] = useState(
    () => isTelegramClient() || window.matchMedia(COMPACT_QUERY).matches,
  );
  const [screen, setScreen] = useState<"lobby" | "game">("lobby");
  const compactRef = useRef(compact),
    screenRef = useRef(screen);
  compactRef.current = compact;
  screenRef.current = screen;
  const [toast, setToast] = useState(""),
    [resetKey, setResetKey] = useState(0),
    [tick, setTick] = useState(0),
    [searchSeconds, setSearchSeconds] = useState(0),
    [records, setRecords] = useState<Match[]>(() => load("luza-matches", []));
  const [inviteCopied, setInviteCopied] = useState(false),
    [busy, setBusy] = useState(false);
  // Berries: the balance and the open tables come from the server, which is
  // the only authority. Until it answers we show nothing rather than a guess.
  const [balance, setBalance] = useState<number | null>(null),
    [tables, setTables] = useState<OpenTable[]>([]),
    [stake, setStake] = useState<Stake>(() => {
      const saved = load<number>("luza-stake", 0);
      return (STAKES as readonly number[]).includes(saved)
        ? (saved as Stake)
        : 0;
    }),
    // Stake of the table being played right now, and the last payout.
    [matchStake, setMatchStake] = useState(0),
    [prize, setPrize] = useState(0),
    [topupPack, setTopupPack] = useState("");
  const stakeRef = useRef(stake);
  stakeRef.current = stake;
  // Another game with the same opponent: "sent" = we asked, "offered" = they did.
  const [rematch, setRematch] = useState<"none" | "sent" | "offered">("none");
  const gameRef = useRef<Game>(createGame(true)),
    angleRef = useRef(-0.24),
    socket = useRef<WebSocket | null>(null),
    modeRef = useRef(mode),
    nameRef = useRef(name),
    avatarRef = useRef<string | undefined>(undefined),
    savedWinner = useRef(false),
    closedRoomsRef = useRef(new Set<string>()),
    currentRoomRef = useRef(""),
    roomSizeRef = useRef(0),
    audioRef = useRef<AudioContext | null>(null),
    botTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    soundRef = useRef(sound);
  modeRef.current = mode;
  nameRef.current = name;
  soundRef.current = sound;
  const g = gameRef.current;
  const canAim =
    mode === "practice" ||
    (mode === "bot" && g.turn === myIndex) ||
    (mode === "online" && players.length === 2 && g.turn === myIndex);
  const isWaiting =
    mode === "searching" || (mode === "online" && players.length === 1);
  const notify = (message: string) => setToast(message);
  function haptic(kind: "shot" | "pocket" | "tap") {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(
        kind === "shot" ? "medium" : kind === "pocket" ? "light" : "soft",
      );
    } catch {
      /* Haptics are optional. */
    }
  }
  function audio(kind: "shot" | "pocket") {
    if (!soundRef.current) return;
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      void ctx.resume();
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(
        kind === "shot" ? 270 : 450,
        ctx.currentTime,
      );
      osc.frequency.exponentialRampToValueAtTime(65, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      /* Audio is optional. */
    }
  }
  const send = (data: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(data));
      return true;
    }
    notify("Нет связи с сервером. Тренировка доступна офлайн.");
    return false;
  };
  /** Stop a bot shot that has been scheduled but not played yet. */
  function cancelBot() {
    if (botTimer.current !== null) clearTimeout(botTimer.current);
    botTimer.current = null;
  }
  /**
   * The computer opponent of a local match. It uses the same planner as the
   * server bot and the same `shoot()` as the player — it simply gets its
   * turn here instead of over the wire.
   */
  function botTurn() {
    const game = gameRef.current;
    if (modeRef.current !== "bot" || game.moving || game.winner !== null)
      return;
    const plan = planShot(game, 1, BOT_SKILL);
    if (!plan) return;
    audio("shot");
    shoot(game, plan.angle, plan.power);
    setTick((t) => t + 1);
  }
  /** A whole rack against the computer, with no server involved. */
  function startBotMatch() {
    cancelStroke();
    cancelBot();
    closeCurrentRoom();
    gameRef.current = createGame();
    angleRef.current = -0.24;
    setMode("bot");
    setMyIndex(0);
    setPlayers([
      { id: "me", name: nameRef.current, avatar: avatarRef.current },
      {
        id: "bot",
        name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
        bot: true,
      },
    ]);
    setCode("");
    setRematch("none");
    setResetKey((k) => k + 1);
    savedWinner.current = false;
    setBusy(false);
    setModal(null);
    setScreen("game");
    setTick((t) => t + 1);
  }
  function cancelStroke() {
    if (strokeTimer.current !== null) clearTimeout(strokeTimer.current);
    strokeRef.current = null;
    setPreparing(false);
  }
  /** Forget the online room we were in, so its late updates are ignored. */
  function closeCurrentRoom() {
    if (currentRoomRef.current)
      closedRoomsRef.current.add(currentRoomRef.current);
    if (closedRoomsRef.current.size > 100)
      closedRoomsRef.current.delete(
        closedRoomsRef.current.values().next().value!,
      );
    currentRoomRef.current = "";
    roomSizeRef.current = 0;
  }
  function resetPractice(backToLobby = false) {
    cancelStroke();
    cancelBot();
    if (backToLobby) setScreen("lobby");
    closeCurrentRoom();
    gameRef.current = createGame(true);
    angleRef.current = -0.24;
    setRematch("none");
    setMode("practice");
    setPlayers([]);
    setCode("");
    setResetKey((k) => k + 1);
    savedWinner.current = false;
    setBusy(false);
    setTick((t) => t + 1);
  }
  /** Compact layout: leave the table and go back to the Mini App menu. */
  function leaveTable() {
    if (
      modeRef.current === "online" &&
      roomSizeRef.current === 2 &&
      gameRef.current.winner === null
    )
      return setModal("leave");
    if (modeRef.current === "practice" || modeRef.current === "bot") {
      cancelStroke();
      cancelBot();
      if (modeRef.current === "bot") resetPractice(true);
      else setScreen("lobby");
      return;
    }
    exitToPractice();
  }
  function startPractice() {
    if (mode === "bot") {
      resetPractice();
      setScreen("game");
      return;
    }
    if (mode !== "practice") return setModal("leave");
    resetPractice();
    setScreen("game");
  }
  function exitToPractice() {
    send({ type: "leave" });
    resetPractice(true);
    setModal(null);
  }
  /** Online is a placeholder until a game server address is configured. */
  function requireServer() {
    if (onlineAvailable === false) {
      notify("Онлайн подключим позже — сейчас работает тренировка.");
      return false;
    }
    return true;
  }
  function openFriends() {
    if (!requireServer()) return;
    setModal("friends");
  }
  /** The lobby with open tables: pick a stake, sit down or open your own. */
  function openTables() {
    if (!requireServer()) return;
    setModal("tables");
  }
  function openWallet() {
    setModal("wallet");
  }
  function chooseStake(next: Stake) {
    setStake(next);
    save("luza-stake", next);
    haptic("tap");
  }
  /** Can I afford the stake I have selected? */
  const affordable = balance === null || canAfford(balance, stake);
  function readyToPlay() {
    if (!requireServer()) return false;
    if (!connected) {
      notify("Подключаемся к серверу. Попробуй ещё раз через пару секунд.");
      return false;
    }
    if (mode === "online") {
      setModal("leave");
      return false;
    }
    return true;
  }
  /** Quick game: the oldest open table with this stake, or a new one of mine. */
  function startSearch() {
    if (!readyToPlay()) return;
    cancelBot();
    if (!affordable) {
      notify(`Не хватает ягодок: нужно ${stake}, а у тебя ${balance}.`);
      return;
    }
    cancelStroke();
    setBusy(true);
    setModal(null);
    send({ type: "queue", stake: stakeRef.current });
    setSearchSeconds(0);
  }
  /** Sit down at a table someone is already waiting at. */
  function sitAt(table: OpenTable) {
    if (!readyToPlay()) return;
    cancelBot();
    if (balance !== null && !canAfford(balance, table.stake)) {
      notify(`Не хватает ягодок: за этот стол нужно ${table.stake}.`);
      return;
    }
    cancelStroke();
    setBusy(true);
    setModal(null);
    send({ type: "join", code: table.code });
  }
  /**
   * Play a computer opponent right now. With a game server the bot sits at
   * a real table and the stake is real; without one the whole match runs
   * here in the browser, which is what keeps the game playable on a static
   * deployment.
   */
  function playBot() {
    if (onlineAvailable === false || !connected) {
      startBotMatch();
      return;
    }
    if (mode === "online") return setModal("leave");
    if (!affordable) {
      notify(`Не хватает ягодок: нужно ${stake}, а у тебя ${balance}.`);
      return;
    }
    cancelStroke();
    cancelBot();
    setBusy(true);
    setModal(null);
    send({ type: "bot", stake: stakeRef.current });
    setSearchSeconds(0);
  }
  /** Buy berries for Telegram Stars. */
  function buyBerries(packId: string) {
    if (!connected) {
      notify("Нет связи с сервером — пополнение временно недоступно.");
      return;
    }
    setTopupPack(packId);
    send({ type: "topup", pack: packId });
  }
  function askRematch() {
    if (!send({ type: "rematch" })) return;
    setRematch("sent");
  }
  function toggleView() {
    setView((v) => {
      const next = v === "top" ? "angled" : "top";
      save("luza-view", next);
      return next;
    });
    haptic("tap");
  }
  function hit(shotPower: number = power) {
    if (!canAim || g.moving || g.winner !== null || strokeRef.current) return;
    // Unlock audio during the user gesture; play the click at tip contact, not on button press.
    if (soundRef.current)
      try {
        audioRef.current ??= new AudioContext();
        void audioRef.current.resume();
      } catch {
        /* Optional. */
      }
    const stroke = {
      startedAt: performance.now(),
      angle: angleRef.current,
      power: shotPower,
    };
    strokeRef.current = stroke;
    setPreparing(true);
    strokeTimer.current = setTimeout(() => {
      if (
        strokeRef.current !== stroke ||
        gameRef.current !== g ||
        modeRef.current !== mode
      ) {
        cancelStroke();
        return;
      }
      audio("shot");
      haptic("shot");
      if (mode === "online") {
        send({ type: "shoot", angle: stroke.angle, power: stroke.power });
        // Hold at contact until the authoritative server acknowledges the impulse.
        strokeTimer.current = setTimeout(() => {
          cancelStroke();
          notify("Сервер не подтвердил удар. Проверь соединение.");
        }, 2500);
      } else {
        shoot(g, stroke.angle, stroke.power);
        cancelStroke();
        setTick((t) => t + 1);
      }
    }, STROKE_MS);
  }
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) cancelStroke();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      if (strokeTimer.current !== null) clearTimeout(strokeTimer.current);
    };
  }, []);
  // The phone screen has no message line, so the one thing a player cannot
  // guess — why the turn went away — is announced once, briefly.
  const lastShot = useRef(0);
  useEffect(() => {
    const game = gameRef.current;
    if (game.moving || game.shots === lastShot.current) return;
    const first = lastShot.current === 0;
    lastShot.current = game.shots;
    if (first || !game.foul || game.winner !== null) return;
    if (modeRef.current !== "practice" || game.shotPocketed.includes(0))
      notify(game.message);
  }, [tick]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    save("luza-sound", sound);
  }, [sound]);
  useEffect(() => {
    if (!modal && !expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const scope = () =>
      document.querySelector(modal ? ".modal" : ".table-card.is-expanded");
    const focusable = () =>
      Array.from(
        scope()?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modal) setModal(null);
        else setExpanded(false);
      }
      if (e.key === "Tab") {
        const list = focusable();
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [modal, expanded]);

  useEffect(() => {
    let alive = true,
      retry: ReturnType<typeof setTimeout>;
    const connect = (address: string) => {
      const ws = new WebSocket(address);
      socket.current = ws;
      ws.onopen = () => {
        if (!alive) return;
        setConnected(true);
        ws.send(
          JSON.stringify({
            type: "hello",
            name: nameRef.current,
            avatar: avatarRef.current,
            // Which wallet is mine; see playerKey() for what it does not prove.
            key: playerKey(),
            tgId: window.Telegram?.WebApp?.initDataUnsafe?.user?.id,
          }),
        );
        const room = startRoomCode();
        if (room) {
          ws.send(JSON.stringify({ type: "join", code: room }));
          window.history.replaceState({}, "", location.pathname);
        }
      };
      ws.onmessage = (event) => {
        if (!alive || socket.current !== ws) return;
        let m;
        try {
          m = JSON.parse(event.data);
        } catch {
          return;
        }
        if (m.type === "population") setPopulation(m.count);
        if (m.type === "wallet" && typeof m.balance === "number")
          setBalance(m.balance);
        if (m.type === "tables" && Array.isArray(m.tables))
          setTables(m.tables as OpenTable[]);
        if (m.type === "topup_link" && typeof m.url === "string") {
          setTopupPack("");
          const tg = window.Telegram?.WebApp;
          if (tg?.openInvoice)
            tg.openInvoice(m.url, (status) => {
              // Status is a hint for the UI only: berries are credited by the
              // payment webhook, which arrives as a `wallet` message.
              if (status === "paid") notify("Оплата прошла, ягодки зачисляем.");
              else if (status === "failed")
                notify("Платёж не прошёл. Ягодки не списаны.");
            });
          else window.open(m.url, "_blank", "noopener");
        }
        if (m.type === "topup_unavailable") {
          setTopupPack("");
          notify(m.reason || "Пополнение сейчас недоступно.");
        }
        if (m.type === "topup_done") {
          setTopupPack("");
          notify("Ягодки зачислены.");
        }
        if (m.type === "rematch_sent") setRematch("sent");
        if (m.type === "rematch_offer") setRematch("offered");
        if (m.type === "waiting") {
          setMode("searching");
          setBusy(false);
        }
        if (m.type === "state") {
          if (closedRoomsRef.current.has(m.code)) return;
          const wasSolo = gameRef.current.solo;
          // A rematch keeps the room but rewinds the shot counter.
          const restarted =
            m.game.shots === 0 && gameRef.current.shots > 0 && !wasSolo;
          const newRoom = currentRoomRef.current !== m.code;
          const joined = roomSizeRef.current !== m.players.length;
          currentRoomRef.current = m.code;
          roomSizeRef.current = m.players.length;
          setMatchStake(typeof m.stake === "number" ? m.stake : 0);
          if (typeof m.prize === "number" && m.prize > 0) setPrize(m.prize);
          if (restarted || newRoom) setPrize(0);
          if (m.game.moving || newRoom) cancelStroke();
          gameRef.current = m.game;
          setPlayers(m.players);
          setMyIndex(m.yourIndex);
          setCode(m.private ? m.code : "");
          setMode("online");
          setBusy(false);
          if (newRoom || joined) {
            setModal(null);
            if (m.players.length === 2) {
              if (compactRef.current) setScreen("game");
              else if (window.matchMedia("(max-width:760px)").matches)
                setExpanded(true);
            }
          }
          if (wasSolo || newRoom || restarted) {
            setResetKey((k) => k + 1);
            savedWinner.current = false;
            setRematch("none");
            cancelStroke();
          }
          setTick((t) => t + 1);
        }
        if (m.type === "opponent_left") {
          notify(
            "Соперник вышел из комнаты. Ты снова за тренировочным столом.",
          );
          resetPractice(true);
        }
        if (m.type === "error") {
          cancelStroke();
          notify(m.message);
          setBusy(false);
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        setPopulation(0);
        setBusy(false);
        if (modeRef.current !== "practice") {
          resetPractice(true);
          notify("Связь прервалась. Матч завершён, доступна тренировка.");
        }
        retry = setTimeout(() => connect(address), 2500);
      };
      ws.onerror = () => ws.close();
    };
    void resolveGameServer().then((address) => {
      if (!alive) return;
      setOnlineAvailable(address !== null);
      if (address) connect(address);
    });
    return () => {
      alive = false;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, []);
  function syncTelegramControls() {
    const tg = window.Telegram?.WebApp;
    const playing =
      expandedRef.current ||
      (compactRef.current && screenRef.current === "game");
    if (tg?.isVersionAtLeast?.("7.7")) {
      if (playing) tg.disableVerticalSwipes?.();
      else tg.enableVerticalSwipes?.();
    }
    if (tg?.isVersionAtLeast?.("6.2")) {
      if (modeRef.current === "online") tg.enableClosingConfirmation?.();
      else tg.disableClosingConfirmation?.();
    }
  }
  useEffect(() => {
    syncTelegramControls();
  }, [mode, expanded, compact, screen]);
  useEffect(() => {
    const phone = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(isTelegramClient() || phone.matches);
    phone.addEventListener("change", sync);
    return () => phone.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("mini-mode", compact);
    if (compact) setExpanded(false);
    return () => document.body.classList.remove("mini-mode");
  }, [compact]);
  // Telegram's own back button leaves the table instead of closing the app.
  useEffect(() => {
    const back = window.Telegram?.WebApp?.BackButton;
    if (!back) return;
    if (!compact || screen !== "game") {
      back.hide();
      return;
    }
    const handler = () => leaveTable();
    back.onClick(handler);
    back.show();
    return () => {
      back.offClick(handler);
      back.hide();
    };
  }, [compact, screen, mode, players.length]);
  useEffect(() => {
    let dispose = () => {};
    const setup = () => {
      const tg = window.Telegram?.WebApp;
      if (!tg) return;
      tg.ready();
      tg.expand();
      setCompact(true);
      tg.setHeaderColor?.("#0d1210");
      tg.setBackgroundColor?.("#0d1210");
      syncTelegramControls();
      const syncViewport = () => {
        const style = document.documentElement.style;
        if (tg.viewportStableHeight && tg.viewportStableHeight > 0)
          style.setProperty(
            "--app-viewport-height",
            `${tg.viewportStableHeight}px`,
          );
        for (const edge of ["top", "bottom", "left", "right"] as const)
          style.setProperty(
            `--app-safe-${edge}`,
            `${tg.contentSafeAreaInset?.[edge] ?? 0}px`,
          );
      };
      syncViewport();
      const events = [
        "viewportChanged",
        "safeAreaChanged",
        "contentSafeAreaChanged",
      ];
      events.forEach((event) => tg.onEvent?.(event, syncViewport));
      dispose = () => {
        events.forEach((event) => tg.offEvent?.(event, syncViewport));
      };
      const user = tg.initDataUnsafe?.user;
      if (user) {
        const n = user.first_name;
        setName(n);
        nameRef.current = n;
        save("luza-name", n);
        // Telegram hands out the profile photo of the player; the opponent
        // sees it over the table, so only a plain https link is forwarded.
        const photo = user.photo_url;
        avatarRef.current =
          typeof photo === "string" && /^https:\/\//.test(photo)
            ? photo.slice(0, 300)
            : undefined;
        setAvatar(avatarRef.current);
        if (socket.current?.readyState === WebSocket.OPEN)
          socket.current.send(
            JSON.stringify({
              type: "hello",
              name: n,
              avatar: avatarRef.current,
            }),
          );
      }
    };
    let script: HTMLScriptElement | undefined;
    if (window.Telegram?.WebApp) setup();
    else if (location.hash.includes("tgWebAppData")) {
      script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-web-app.js";
      script.onload = setup;
      script.onerror = () =>
        notify("Telegram SDK не загрузился. Доступен гостевой режим.");
      document.head.appendChild(script);
    }
    return () => {
      dispose();
      if (script) {
        script.onload = null;
        script.onerror = null;
        script.remove();
      }
    };
  }, []);
  useEffect(() => {
    let frame: number,
      last = performance.now(),
      acc = 0,
      ui = 0;
    const run = (now: number) => {
      // Catch up to 0.25 s per frame: on a slow device the table must not
      // drift into slow motion, it should still run in real time.
      const elapsed = Math.min((now - last) / 1000, 0.25);
      last = now;
      const game = gameRef.current;
      const local = modeRef.current === "practice" || modeRef.current === "bot";
      if (local && game.moving) {
        acc += elapsed;
        const pockets = game.shotPocketed.length;
        while (acc >= 1 / 120) {
          step(game, 1 / 120);
          acc -= 1 / 120;
        }
        if (game.shotPocketed.length > pockets) {
          audio("pocket");
          haptic("pocket");
        }
        ui += elapsed;
        if (ui > 0.075 || !game.moving) {
          setTick((t) => t + 1);
          ui = 0;
        }
        // The balls have just stopped and the table belongs to the bot:
        // give it a moment to "think", the way the server bot does.
        if (
          !game.moving &&
          modeRef.current === "bot" &&
          game.winner === null &&
          game.turn === 1 &&
          botTimer.current === null
        )
          botTimer.current = setTimeout(
            () => {
              botTimer.current = null;
              botTurn();
            },
            900 + Math.random() * 700,
          );
      } else acc = 0;
      frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, []);
  // A queue/create/join request can be ignored by the server (throttling, a
  // lost frame). Never leave the button spinning forever because of that.
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      setBusy(false);
      notify("Сервер не ответил на действие. Попробуй ещё раз.");
    }, 5000);
    return () => clearTimeout(timer);
  }, [busy]);
  useEffect(() => {
    if (!isWaiting) return;
    const t = setInterval(() => setSearchSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isWaiting]);
  useEffect(() => {
    if (g.winner === null || savedWinner.current) return;
    savedWinner.current = true;
    const result =
      g.winner === (mode === "practice" ? 0 : myIndex) ? "Победа" : "Поражение";
    const record = {
      date: new Date().toISOString(),
      result,
      shots: g.shots,
      opponent:
        mode === "practice"
          ? "Тренировка"
          : `${players[1 - myIndex]?.name || "Соперник"}${
              players[1 - myIndex]?.bot ? " (бот)" : ""
            }`,
    };
    setRecords((prev) => {
      const next = [record, ...prev].slice(0, 30);
      save("luza-matches", next);
      return next;
    });
  }, [tick]);
  async function copyInvite() {
    const link = inviteLink(code);
    try {
      await navigator.clipboard.writeText(link);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2500);
    } catch {
      notify(`Код комнаты: ${code}. Отправь его другу.`);
    }
  }
  function changePage(next: string) {
    setMobileMenu(false);
    if (next === "history") {
      setModal("history");
      return;
    }
    if (next === "rules") {
      setModal("rules");
      return;
    }
    setPage(next);
  }
  const pocketed = g.balls.filter((b) => b.pocketed && b.id !== 0);
  // On the rotated game screen the toast is drawn inside the frame instead:
  // floating over the physical bottom edge, it covered the cue.
  const gameToast = compact && screen === "game";
  /** Stake chips: the bet both players put on the table. */
  const stakePicker = (
    <div className="stake-row" role="group" aria-label="Ставка">
      {STAKES.map((value) => (
        <button
          key={value}
          type="button"
          className={"stake-chip" + (value === stake ? " is-active" : "")}
          aria-pressed={value === stake}
          // The chips show bare numbers so all five fit a phone in one row;
          // the currency is in the heading, the button and the screen reader.
          aria-label={value === 0 ? "Без ставки" : stakeLabel(value)}
          disabled={balance !== null && !canAfford(balance, value)}
          onClick={() => chooseStake(value)}
        >
          {value === 0 ? "Без ставки" : value}
        </button>
      ))}
    </div>
  );
  /** The open tables themselves: tap one to sit down against its host. */
  const tableList = (
    <ul className="table-list">
      {tables.length === 0 && (
        <li className="table-empty">
          Свободных столов нет. Открой свой — соперник подсядет.
        </li>
      )}
      {tables.map((t) => (
        <li key={t.code}>
          <button
            type="button"
            className="table-row"
            disabled={
              busy || (balance !== null && !canAfford(balance, t.stake))
            }
            onClick={() => sitAt(t)}
          >
            <Avatar name={t.host} src={t.avatar} />
            <span className="table-host">
              {t.host}
              <em>ждёт соперника</em>
            </span>
            <span
              className={"table-stake" + (t.stake > 0 ? " is-paid" : "")}
              title={stakeLabel(t.stake)}
            >
              {t.stake > 0 ? (
                <>
                  {t.stake}
                  <Berry size={12} />
                </>
              ) : (
                "без ставки"
              )}
            </span>
            <ArrowRight size={17} />
          </button>
        </li>
      ))}
    </ul>
  );
  /** Balance chip: shows the berries and opens the wallet. */
  const balanceChip = (className: string) => (
    <button
      type="button"
      className={className}
      onClick={openWallet}
      aria-label="Кошелёк: ягодки и пополнение"
      title="Кошелёк: ягодки и пополнение"
    >
      <Berry size={14} />
      <strong>{balance === null ? "—" : balance}</strong>
    </button>
  );
  const overlays = (
    <>
      {toast && !gameToast && (
        <div className="toast" role="status">
          <span>
            <Check size={16} />
          </span>
          {toast}
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Закрыть"
              onClick={() => setModal(null)}
            >
              <X size={21} />
            </button>
            {modal === "rules" && (
              <>
                <span className="modal-kicker">ПРАВИЛА ЗА МИНУТУ</span>
                <h2 id="modal-title">
                  Просто начни играть<span>.</span>
                </h2>
                <p className="modal-intro">
                  Пул «восьмёрка» с упрощёнными правилами.
                </p>
                <div className="rule-item">
                  <span>01</span>
                  <div>
                    <h3>Прицелься и ударь</h3>
                    <p>
                      {compact
                        ? "Проведи пальцем по сукну — кий повернётся. Белый кружок показывает, где биток встретит шар. Потом оттяни кий сбоку и отпусти: чем дальше оттянул, тем сильнее удар."
                        : "Проведи мышью по столу — кий повернётся. Белый кружок показывает, где биток встретит шар. Выбери силу и нажми «Ударить»."}
                    </p>
                  </div>
                </div>
                <div className="rule-item">
                  <span>02</span>
                  <div>
                    <h3>Собери свою группу</h3>
                    <p>
                      Первый забитый шар определяет группу: сплошные 1–7 или
                      полосатые 9–15. Забиваешь свой — ходишь ещё. Промах или
                      неправильное первое касание — ход соперника.
                    </p>
                  </div>
                </div>
                <div className="rule-item">
                  <span>03</span>
                  <div>
                    <h3>Восьмёрка — на десерт</h3>
                    <p>
                      Сначала забей все свои шары, затем чёрный. Ранняя
                      восьмёрка или восьмёрка вместе с битком — поражение. В
                      тренировке убери все цветные шары перед чёрным.
                    </p>
                  </div>
                </div>
                <div className="rule-note">
                  <CircleHelp size={17} />
                  <span>
                    Биток после лузы возвращается на свободное место. Заказ луз,
                    правило борта и свободное размещение битка пока не
                    используются.
                  </span>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setModal(null)}
                >
                  Всё понятно, к столу <ArrowRight size={18} />
                </button>
              </>
            )}
            {modal === "friends" && (
              <>
                <span className="modal-kicker">ХОРОШАЯ КОМПАНИЯ</span>
                <h2 id="modal-title">
                  Твой друг. Ваш матч<span>.</span>
                </h2>
                <p className="modal-intro">
                  Создай комнату и отправь другу ссылку. Или введи код, который
                  прислали тебе.
                </p>
                {code ? (
                  <div className="existing-room">
                    <span>Код твоей комнаты</span>
                    <button className="room-code" onClick={copyInvite}>
                      {code}
                      {inviteCopied ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                    <button className="primary-button" onClick={copyInvite}>
                      <Link size={18} />
                      {inviteCopied
                        ? "Ссылка скопирована"
                        : "Скопировать приглашение"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="primary-button"
                    disabled={!connected || busy}
                    onClick={() => {
                      if (mode === "online" && players.length === 2)
                        return setModal("leave");
                      setBusy(true);
                      send({ type: "create", stake: stakeRef.current });
                      setSearchSeconds(0);
                    }}
                  >
                    <Plus size={18} />
                    {busy ? "Создаём комнату…" : "Создать свой стол"}
                  </button>
                )}
                <div className="panel-separator labelled">
                  <span>есть приглашение?</span>
                </div>
                <form
                  className="join-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (mode === "online" && players.length === 2)
                      return setModal("leave");
                    send({ type: "join", code: joinCode });
                  }}
                >
                  <label htmlFor="room-code">Код комнаты</label>
                  <div>
                    <input
                      id="room-code"
                      value={joinCode}
                      onChange={(e) =>
                        setJoinCode(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-F0-9]/g, "")
                            .slice(0, 6),
                        )
                      }
                      placeholder="Например, A3F8D2"
                      autoComplete="off"
                      maxLength={6}
                    />
                    <button
                      className="primary-button"
                      disabled={joinCode.length !== 6 || !connected}
                    >
                      Войти <ArrowRight size={17} />
                    </button>
                  </div>
                </form>
                <p className="subtle-text">
                  <ShieldCheck size={14} />В комнате только двое. Никаких
                  случайных гостей.
                </p>
              </>
            )}
            {modal === "history" && (
              <>
                <span className="modal-kicker">ТВОЯ ИСТОРИЯ</span>
                <h2 id="modal-title">
                  Красивые партии<span>.</span>
                </h2>
                {records.length === 0 ? (
                  <div className="empty-state">
                    <History size={38} />
                    <h3>Первый матч ещё впереди</h3>
                    <p>
                      Заверши тренировку или онлайн-матч —<br />
                      результат останется здесь, в этом браузере.
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setModal(null);
                        if (compact) startPractice();
                      }}
                    >
                      Пора играть <ArrowRight size={18} />
                    </button>
                  </div>
                ) : (
                  <div className="history-list">
                    {records.map((r, i) => (
                      <div className="history-row" key={i}>
                        <span
                          className={`history-result ${r.result === "Победа" ? "won" : ""}`}
                        >
                          <Trophy size={18} />
                        </span>
                        <div>
                          <strong>{r.result}</strong>
                          <span>
                            {r.opponent} · {r.shots}{" "}
                            {plural(r.shots, "удар", "удара", "ударов")}
                          </span>
                        </div>
                        <time>
                          {new Date(r.date).toLocaleDateString("ru-RU", {
                            day: "numeric",
                            month: "short",
                          })}
                        </time>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {modal === "profile" && (
              <>
                <span className="modal-kicker">ТВОЙ ПРОФИЛЬ</span>
                <h2 id="modal-title">
                  Как тебя представить<span>?</span>
                </h2>
                <p className="modal-intro">
                  Это имя увидит твой соперник за столом.
                </p>
                <form
                  className="profile-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const next = draftName.trim() || "Гость";
                    setName(next);
                    save("luza-name", next);
                    if (socket.current?.readyState === WebSocket.OPEN)
                      send({ type: "hello", name: next });
                    setModal(null);
                    notify("Имя сохранено. Приятной игры!");
                  }}
                >
                  <label htmlFor="name">Имя игрока</label>
                  <input
                    id="name"
                    autoFocus
                    maxLength={24}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Твоё имя"
                  />
                  <button className="primary-button" type="submit">
                    Сохранить <Check size={18} />
                  </button>
                </form>
                <button
                  className="setting-toggle"
                  type="button"
                  aria-pressed={sound}
                  onClick={() => setSound((v) => !v)}
                >
                  {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
                  Звук игры <strong>{sound ? "Включён" : "Выключен"}</strong>
                </button>
                <p className="subtle-text">
                  Пока это гостевой профиль, без рейтинга и ставок.
                </p>
              </>
            )}
            {modal === "tables" && (
              <>
                <span className="modal-kicker">ОТКРЫТЫЕ СТОЛЫ</span>
                <h2 id="modal-title">
                  Выбери стол<span>.</span>
                </h2>
                <p className="modal-intro">
                  За этими столами ждут соперника. Ставка — ягодки, которые
                  кладут оба: победитель забирает обе.
                </p>
                {stakePicker}
                {tableList}
                <button
                  className="primary-button"
                  disabled={busy || !affordable}
                  onClick={startSearch}
                >
                  <Plus size={18} />
                  {busy ? (
                    "Садимся за стол…"
                  ) : stake > 0 ? (
                    <>
                      Открыть свой стол · {stake}
                      <Berry size={13} />
                    </>
                  ) : (
                    "Открыть свой стол"
                  )}
                </button>
                <button
                  className="friend-button bot-button"
                  disabled={busy || !affordable}
                  onClick={playBot}
                >
                  <Bot size={17} />
                  Сыграть с ботом
                  <ArrowRight size={17} />
                </button>
                <p className="subtle-text">
                  {balance === null
                    ? "Баланс подгружается…"
                    : `У тебя ${berries(balance)}.`}{" "}
                  <button className="link-button" onClick={openWallet}>
                    Пополнить
                  </button>
                </p>
              </>
            )}
            {modal === "wallet" && (
              <>
                <span className="modal-kicker">КОШЕЛЁК</span>
                <h2 id="modal-title">
                  {balance === null ? "Ягодки" : berries(balance)}
                  <span>.</span>
                </h2>
                <p className="modal-intro">
                  Ягодки — валюта стола: оба игрока ставят поровну, победитель
                  забирает банк. Пополняются звёздами Telegram.
                </p>
                <div className="pack-list">
                  {PACKS.map((pack) => (
                    <button
                      key={pack.id}
                      type="button"
                      className="pack-row"
                      disabled={!!topupPack || !connected}
                      onClick={() => buyBerries(pack.id)}
                    >
                      <span className="pack-berries">
                        <Berry size={16} />
                        <span>{pack.berries}</span>
                        <em>ягодок</em>
                      </span>
                      <span className="pack-price">
                        {topupPack === pack.id ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <>
                            {pack.stars}
                            <Star
                              size={13}
                              fill="currentColor"
                              strokeWidth={0}
                            />
                          </>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="subtle-text">
                  {onlineAvailable === false
                    ? "Кошелёк и ставки живут на игровом сервере, а в этой сборке его нет: доступна только тренировка."
                    : "Оплата идёт звёздами Telegram (XTR) внутри приложения. Ягодки зачисляются, когда Telegram подтвердит платёж. Без подключённого бота пополнение недоступно — играй на стартовые."}
                </p>
              </>
            )}
            {modal === "leave" && (
              <>
                <span className="modal-kicker">СМЕНИТЬ СТОЛ</span>
                <h2 id="modal-title">
                  Закончим этот матч<span>?</span>
                </h2>
                <p className="modal-intro">
                  Текущая комната закроется для обоих игроков. Ты вернёшься к
                  свободной тренировке.
                  {matchStake > 0 && players.length === 2
                    ? ` Ставка ${stakeLabel(matchStake)} останется сопернику.`
                    : ""}
                </p>
                <div className="modal-actions">
                  <button
                    className="friend-button"
                    onClick={() => setModal(null)}
                  >
                    Остаться
                  </button>
                  <button className="primary-button" onClick={exitToPractice}>
                    Выйти из матча <ArrowRight size={18} />
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
  if (compact)
    return (
      <>
        <MiniApp
          screen={screen}
          game={g}
          gameRef={gameRef}
          angleRef={angleRef}
          strokeRef={strokeRef}
          resetKey={resetKey}
          onAim={(a) => (angleRef.current = a)}
          onShoot={(p: number) => hit(p)}
          telegram={
            isTelegramClient() && !!window.Telegram?.WebApp?.BackButton?.show
          }
          toast={gameToast ? toast : ""}
          view={view}
          onToggleView={toggleView}
          canAim={canAim}
          live={mode !== "online"}
          isWaiting={isWaiting}
          mode={mode}
          players={players}
          myIndex={myIndex}
          code={code}
          connected={connected}
          onlineAvailable={onlineAvailable}
          population={population}
          power={power}
          preparing={preparing}
          busy={busy}
          searchSeconds={searchSeconds}
          inviteCopied={inviteCopied}
          name={name}
          sound={sound}
          matches={records.length}
          balance={balance}
          matchStake={matchStake}
          prize={prize}
          openTables={tables.length}
          onPractice={startPractice}
          onFindOpponent={openTables}
          onPlayBot={playBot}
          onWallet={openWallet}
          onFriends={openFriends}
          onRules={() => setModal("rules")}
          onHistory={() => setModal("history")}
          onProfile={() => {
            setDraftName(name);
            setModal("profile");
          }}
          onToggleSound={() => setSound((v) => !v)}
          onBack={leaveTable}
          rematch={rematch}
          onRematch={askRematch}
          onRestart={() => resetPractice()}
          onCancelSearch={exitToPractice}
          onCopyInvite={copyInvite}
        />
        {overlays}
      </>
    );
  return (
    <div className="app-shell">
      {mobileMenu && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changePage("play");
          }}
        >
          <img className="brand-symbol" src={LOGO_URL} alt="" />
          <span>Amazing Pool</span>
        </a>
        <nav>
          <button
            className={page === "play" ? "nav-item active" : "nav-item"}
            onClick={() => changePage("play")}
          >
            <Gamepad2 size={19} />
            Играть
            <ChevronRight size={15} />
          </button>
          <button className="nav-item" onClick={() => changePage("history")}>
            <History size={19} />
            Мои матчи
            {records.length > 0 && (
              <span className="nav-count">{records.length}</span>
            )}
          </button>
          <button className="nav-item" onClick={() => changePage("rules")}>
            <CircleHelp size={19} />
            Как играть
            <ArrowUpRight size={14} />
          </button>
        </nav>
        <div className="sidebar-invite">
          <div className="invite-icon">
            <Users size={20} />
            <span>+</span>
          </div>
          <h3>Вдвоём интереснее</h3>
          <p>
            Свой стол для тебя
            <br />и твоих друзей.
          </p>
          <button onClick={openFriends}>
            Пригласить друга <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="server-status">
            <i className={connected ? "live" : ""} />
            {connected ? "Сервер на связи" : "Подключаемся…"}
            <span>v 0.1</span>
          </div>
          <button
            className="sidebar-profile"
            onClick={() => {
              setDraftName(name);
              setModal("profile");
            }}
          >
            <Avatar name={name} src={avatar} />
            <strong>{name}</strong>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle icon-button"
              aria-label="Открыть меню"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={22} />
            </button>
            <strong>Игровая</strong>
          </div>
          <div className="top-actions">
            <span className="online-badge">
              <i />
              {connected
                ? `${population} ${plural(population, "игрок", "игрока", "игроков")} онлайн`
                : "Офлайн-тренировка"}
            </span>
            {onlineAvailable !== false && balanceChip("balance-chip")}
            <span className="top-divider" />
            <button
              className="icon-button sound-top"
              title={sound ? "Выключить звук" : "Включить звук"}
              onClick={() => setSound((s) => !s)}
            >
              {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            <button
              className="top-avatar"
              title="Профиль"
              onClick={() => {
                setDraftName(name);
                setModal("profile");
              }}
            >
              <Avatar name={name} src={avatar} />
            </button>
          </div>
        </header>
        <main>
          <div className="game-layout">
            <section className={`table-card ${expanded ? "is-expanded" : ""}`}>
              <div className="table-card-heading">
                <div className="versus">
                  <span
                    className={`versus-side${mode !== "practice" && canAim && !isWaiting ? " is-turn" : ""}`}
                  >
                    <Avatar
                      name={players[myIndex]?.name || name}
                      src={players[myIndex]?.avatar || avatar}
                    />
                    <b>{players[myIndex]?.name || name}</b>
                  </span>
                  {mode !== "practice" && (
                    <>
                      <span className="versus-mark">VS</span>
                      <span
                        className={`versus-side${!canAim && !isWaiting ? " is-turn" : ""}`}
                      >
                        <Avatar
                          name={players[1 - myIndex]?.name || "Соперник"}
                          src={players[1 - myIndex]?.avatar}
                          bot={players[1 - myIndex]?.bot}
                        />
                        <b>{players[1 - myIndex]?.name || "Соперник"}</b>
                        {players[1 - myIndex]?.bot && (
                          <em className="bot-tag">бот</em>
                        )}
                      </span>
                    </>
                  )}
                </div>
                <span className="mode-tag">
                  {mode === "practice"
                    ? "ТРЕНИРОВКА"
                    : code
                      ? "С ДРУГОМ"
                      : "ОНЛАЙН"}
                </span>
              </div>
              <div className="table-stage">
                <div className="stage-topline">
                  <button
                    className="view-help"
                    title={expanded ? "Свернуть стол" : "Развернуть стол"}
                    aria-label={expanded ? "Свернуть стол" : "Развернуть стол"}
                    onClick={() => setExpanded((v) => !v)}
                  >
                    {expanded ? (
                      <Minimize2 size={17} />
                    ) : (
                      <Maximize2 size={17} />
                    )}
                  </button>
                </div>
                <Table
                  gameRef={gameRef}
                  angleRef={angleRef}
                  onAim={(a) => (angleRef.current = a)}
                  view={view}
                  canAim={canAim && !isWaiting}
                  power={power}
                  live={mode !== "online"}
                  resetKey={resetKey}
                  strokeRef={strokeRef}
                />
                {isWaiting && (
                  <div className="table-overlay">
                    <div className="waiting-card">
                      <span className="waiting-orbit">
                        <BallIcon />
                        <LoaderCircle size={70} />
                      </span>
                      <h3>{code ? "Ждём твоего друга" : "Ищем соперника"}</h3>
                      <p>
                        {code
                          ? "Отправь ссылку или код комнаты"
                          : `Можно немного выдохнуть. ${Math.floor(searchSeconds / 60)}:${String(searchSeconds % 60).padStart(2, "0")}`}
                      </p>
                      {code && (
                        <button className="room-code" onClick={copyInvite}>
                          {code}
                          {inviteCopied ? (
                            <Check size={17} />
                          ) : (
                            <Copy size={17} />
                          )}
                        </button>
                      )}
                      <button className="text-button" onClick={exitToPractice}>
                        Вернуться к тренировке
                      </button>
                    </div>
                  </div>
                )}
                {g.winner !== null && (
                  <div className="table-overlay">
                    <div className="waiting-card">
                      <Trophy className="winner-icon" size={38} />
                      <h3>
                        {g.winner === (mode === "practice" ? 0 : myIndex)
                          ? "Красивая победа!"
                          : "Ещё один раунд?"}
                      </h3>
                      <p>
                        {g.message}
                        {mode !== "practice" && rematch === "offered"
                          ? " Соперник предлагает сыграть ещё."
                          : ""}
                      </p>
                      <button
                        className="primary-button"
                        disabled={rematch === "sent"}
                        onClick={() =>
                          mode === "practice" ? resetPractice() : askRematch()
                        }
                      >
                        {mode === "practice"
                          ? "Вернуться за стол"
                          : rematch === "sent"
                            ? "Ждём соперника…"
                            : "Сыграть ещё"}
                        <ArrowRight size={18} />
                      </button>
                      {mode !== "practice" && (
                        <button
                          className="text-button"
                          onClick={exitToPractice}
                        >
                          Выйти из матча
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="game-status">
                <div className="turn-label">
                  <span className={`turn-light ${g.moving ? "moving" : ""}`} />
                  <span>
                    {isWaiting
                      ? "Стол готов к игре"
                      : g.moving
                        ? "Шары в движении"
                        : mode === "practice"
                          ? "Твой ход"
                          : canAim
                            ? "Твой ход"
                            : `Ход: ${players[g.turn]?.name || "соперник"}`}
                  </span>
                  {!isWaiting && (
                    <small>
                      {mode === "practice"
                        ? "Свободная игра"
                        : g.groups[myIndex] === "solids"
                          ? "Твои — сплошные"
                          : g.groups[myIndex] === "stripes"
                            ? "Твои — полосатые"
                            : "Открытый стол"}
                    </small>
                  )}
                </div>
                <div className="pocketed-balls">
                  {pocketed.slice(-7).map((b) => (
                    <BallIcon key={b.id} n={b.id} small />
                  ))}
                  {pocketed.length === 0 && <span>Все шары на столе</span>}
                </div>
              </div>
              <div className="shot-controls">
                <div className="power-control">
                  <label htmlFor="power">
                    Сила удара{" "}
                    <span>
                      {Math.round(power * 100)}
                      <small>%</small>
                      <small className="speed-value">
                        {shotSpeedMps(power).toFixed(1)} м/с
                      </small>
                    </span>
                  </label>
                  <div className="power-slider">
                    <Minus size={12} />
                    <input
                      id="power"
                      disabled={preparing}
                      title="Начальная скорость битка. После контакта кий больше не разгоняет шар."
                      aria-label="Сила удара"
                      type="range"
                      min="5"
                      max="100"
                      value={Math.round(power * 100)}
                      onChange={(e) => setPower(Number(e.target.value) / 100)}
                      style={
                        {
                          "--progress": `${power * 100}%`,
                        } as React.CSSProperties
                      }
                    />
                    <Plus size={12} />
                  </div>
                </div>
                <button
                  className="reset-button icon-button"
                  aria-label={
                    mode === "practice"
                      ? "Расставить шары заново"
                      : "Выйти из матча"
                  }
                  title={
                    mode === "practice"
                      ? "Расставить шары заново"
                      : "Выйти из матча"
                  }
                  onClick={() =>
                    mode === "practice" ? resetPractice() : setModal("leave")
                  }
                >
                  {mode === "practice" ? (
                    <RotateCcw size={18} />
                  ) : (
                    <Flag size={18} />
                  )}
                </button>
                <button
                  className="hit-button"
                  onClick={() => hit()}
                  disabled={
                    !canAim ||
                    isWaiting ||
                    g.moving ||
                    preparing ||
                    g.winner !== null
                  }
                >
                  {g.moving ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <ArrowUpRight size={20} />
                  )}
                  Ударить
                </button>
              </div>
            </section>
            <aside className="match-panel">
              <div className="game-choice">
                <div className="game-choice-icon">
                  <BallIcon />
                </div>
                <div>
                  <strong>Пул «Восьмёрка»</strong>
                  <span>Классика · 1 на 1</span>
                </div>
                <button
                  title="Правила восьмёрки"
                  className="icon-button"
                  onClick={() => setModal("rules")}
                >
                  <ChevronDown size={17} />
                </button>
              </div>
              {stakePicker}
              <button
                className="primary-button find-button"
                onClick={isWaiting ? exitToPractice : startSearch}
                disabled={busy || (!isWaiting && !affordable)}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : isWaiting ? (
                  <X size={18} />
                ) : (
                  <Gamepad2 size={19} />
                )}
                <span>
                  {isWaiting ? (
                    "Отменить поиск"
                  ) : mode === "online" ? (
                    "Новая игра"
                  ) : stake > 0 ? (
                    <>
                      Сесть за стол · {stake}
                      <Berry size={13} />
                    </>
                  ) : (
                    "Найти соперника"
                  )}
                </span>
                {!isWaiting && <ArrowRight size={18} />}
              </button>
              <div className="match-note">
                <i />
                {onlineAvailable === false
                  ? "Онлайн подключим позже. Сейчас — тренировка."
                  : !affordable
                    ? `Для этой ставки нужно ${stake} ягодок.`
                    : connected
                      ? "Сервер готов. Можно играть."
                      : "Тренируйся, пока подключаемся"}
              </div>
              <button
                className="friend-button bot-button"
                disabled={busy || !affordable}
                onClick={playBot}
              >
                <Bot size={17} />
                Сыграть с ботом
                <ArrowRight size={17} />
              </button>
              <div className="panel-separator labelled">
                <span>кто ждёт соперника</span>
              </div>
              {tableList}
              <div className="panel-separator" />
              <button className="friend-button" onClick={openFriends}>
                <Users size={17} />
                Пригласить друга
                <ArrowUpRight size={17} />
              </button>
            </aside>
          </div>
        </main>
      </div>
      {overlays}
    </div>
  );
}
export default App;

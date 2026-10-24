import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Crosshair,
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
  Sparkles,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Table from "./Table";
import BallIcon from "./BallIcon";
import MiniApp from "./MiniApp";
import {
  inviteLink,
  isTelegramClient,
  resolveGameServer,
  startRoomCode,
} from "./config";
import {
  createGame,
  shoot,
  step,
  shotSpeedMps,
  type Game,
} from "../shared/game";
import { STROKE_MS, type CueStroke } from "../shared/rendering";

type Player = { id: string; name: string };
type Match = { date: string; result: string; shots: number; opponent: string };
type Modal = "rules" | "friends" | "history" | "profile" | "leave" | null;
/** Phones in both orientations get the Mini App layout; wide desktops keep the club page. */
const COMPACT_QUERY =
  "(max-width:760px),(max-height:520px) and (max-width:1100px)";
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
  const [mode, setMode] = useState<"practice" | "searching" | "online">(
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
    [view, setView] = useState<"angled" | "top">(() =>
      load<string>("luza-view", "angled") === "top" ? "top" : "angled",
    );
  // null = still resolving the server address, false = practice-only build.
  const [onlineAvailable, setOnlineAvailable] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false),
    [population, setPopulation] = useState(0),
    [players, setPlayers] = useState<Player[]>([]),
    [myIndex, setMyIndex] = useState(0),
    [code, setCode] = useState(""),
    [joinCode, setJoinCode] = useState("");
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
  const gameRef = useRef<Game>(createGame(true)),
    angleRef = useRef(-0.24),
    socket = useRef<WebSocket | null>(null),
    modeRef = useRef(mode),
    nameRef = useRef(name),
    savedWinner = useRef(false),
    closedRoomsRef = useRef(new Set<string>()),
    currentRoomRef = useRef(""),
    roomSizeRef = useRef(0),
    audioRef = useRef<AudioContext | null>(null),
    soundRef = useRef(sound);
  modeRef.current = mode;
  nameRef.current = name;
  soundRef.current = sound;
  const g = gameRef.current;
  const canAim =
    mode === "practice" ||
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
  function cancelStroke() {
    if (strokeTimer.current !== null) clearTimeout(strokeTimer.current);
    strokeRef.current = null;
    setPreparing(false);
  }
  function resetPractice(backToLobby = false) {
    cancelStroke();
    if (backToLobby) setScreen("lobby");
    if (currentRoomRef.current)
      closedRoomsRef.current.add(currentRoomRef.current);
    if (closedRoomsRef.current.size > 100)
      closedRoomsRef.current.delete(
        closedRoomsRef.current.values().next().value!,
      );
    currentRoomRef.current = "";
    roomSizeRef.current = 0;
    gameRef.current = createGame(true);
    angleRef.current = -0.24;
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
    if (modeRef.current === "online" && roomSizeRef.current === 2)
      return setModal("leave");
    if (modeRef.current === "practice") {
      cancelStroke();
      setScreen("lobby");
      return;
    }
    exitToPractice();
  }
  function startPractice() {
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
  function startSearch() {
    if (!requireServer()) return;
    if (!connected)
      return notify(
        "Подключаемся к серверу. Попробуй ещё раз через пару секунд.",
      );
    if (mode === "online") return setModal("leave");
    cancelStroke();
    setBusy(true);
    send({ type: "queue" });
    setSearchSeconds(0);
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
        ws.send(JSON.stringify({ type: "hello", name: nameRef.current }));
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
        if (m.type === "waiting") {
          setMode("searching");
          setBusy(false);
        }
        if (m.type === "state") {
          if (closedRoomsRef.current.has(m.code)) return;
          const wasSolo = gameRef.current.solo;
          const newRoom = currentRoomRef.current !== m.code;
          const joined = roomSizeRef.current !== m.players.length;
          currentRoomRef.current = m.code;
          roomSizeRef.current = m.players.length;
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
          if (wasSolo || newRoom) {
            setResetKey((k) => k + 1);
            savedWinner.current = false;
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
      tg.setHeaderColor?.("#101715");
      tg.setBackgroundColor?.("#101715");
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
        if (socket.current?.readyState === WebSocket.OPEN)
          socket.current.send(JSON.stringify({ type: "hello", name: n }));
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
      if (modeRef.current === "practice" && game.moving) {
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
          : players[1 - myIndex]?.name || "Соперник",
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
  const overlays = (
    <>
      {toast && (
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
                      Наведи курсор или проведи пальцем по столу. Пунктир
                      покажет направление битка. Выбери силу и нажми «Ударить».
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
                      send({ type: "create" });
                      setSearchSeconds(0);
                    }}
                  >
                    <Plus size={18} />
                    {busy ? "Создаём комнату…" : "Создать свой стол"}
                  </button>
                )}
                <div className="panel-separator">
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
                      onClick={() => setModal(null)}
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
                            {r.opponent} · {r.shots} ударов
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
            {modal === "leave" && (
              <>
                <span className="modal-kicker">СМЕНИТЬ СТОЛ</span>
                <h2 id="modal-title">
                  Закончим этот матч<span>?</span>
                </h2>
                <p className="modal-intro">
                  Текущая комната закроется для обоих игроков. Ты вернёшься к
                  свободной тренировке.
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
          view={view}
          onToggleView={toggleView}
          canAim={canAim}
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
          onPractice={startPractice}
          onFindOpponent={startSearch}
          onFriends={openFriends}
          onRules={() => setModal("rules")}
          onHistory={() => setModal("history")}
          onProfile={() => {
            setDraftName(name);
            setModal("profile");
          }}
          onToggleSound={() => setSound((v) => !v)}
          onBack={leaveTable}
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
          <span className="brand-symbol">
            <span>8</span>
          </span>
          <span>
            луза<span className="brand-dot">.</span>
            <small>БИЛЬЯРДНЫЙ КЛУБ</small>
          </span>
        </a>
        <div className="nav-caption">ТВОЁ ПРОСТРАНСТВО</div>
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
            {connected ? "Клуб открыт" : "Подключаемся…"}
            <span>v 0.1</span>
          </div>
          <button
            className="sidebar-profile"
            onClick={() => {
              setDraftName(name);
              setModal("profile");
            }}
          >
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{name}</strong>
              <small>Любитель красивой игры</small>
            </span>
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
            <span>Клуб</span>
            <ChevronRight size={13} />
            <strong>Игровая</strong>
          </div>
          <div className="top-actions">
            <span className="online-badge">
              <i />
              {connected
                ? `${population} ${population % 10 === 1 && population % 100 !== 11 ? "игрок" : population % 10 >= 2 && population % 10 <= 4 && (population % 100 < 12 || population % 100 > 14) ? "игрока" : "игроков"} в клубе`
                : "Офлайн-тренировка"}
            </span>
            <span className="top-divider" />
            <button
              className="icon-button sound-top"
              title={sound ? "Выключить звук" : "Включить звук"}
              onClick={() => setSound((s) => !s)}
            >
              {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            <button
              className="avatar top-avatar"
              title="Профиль"
              onClick={() => {
                setDraftName(name);
                setModal("profile");
              }}
            >
              {name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                ВРЕМЯ ХОРОШЕЙ ИГРЫ
              </div>
              <h1>
                Встретимся у стола<span>.</span>
              </h1>
              <p>Точный удар. Приятная компания. Всё остальное подождёт.</p>
            </div>
            <button className="quiet-link" onClick={() => setModal("rules")}>
              Впервые здесь? <ArrowUpRight size={17} />
            </button>
          </section>
          <div className="game-layout">
            <section className={`table-card ${expanded ? "is-expanded" : ""}`}>
              <div className="table-card-heading">
                <div className="table-title">
                  <span className="table-dot" />
                  <h2>
                    {mode === "practice"
                      ? "Твой тренировочный стол"
                      : mode === "searching"
                        ? "Ищем хорошую компанию"
                        : players.length < 2
                          ? "Стол для своих"
                          : "Игра началась"}
                  </h2>
                </div>
                <span className="mode-tag">
                  {mode === "practice"
                    ? "ПРАКТИКА"
                    : code
                      ? "С ДРУГОМ"
                      : "ОНЛАЙН"}
                </span>
              </div>
              <div className="table-subheading">
                <span>
                  {mode === "practice"
                    ? "Никакой спешки. Только ты и следующий удар."
                    : players.length === 2
                      ? `${players[0].name}  ·  ${players[1].name}`
                      : "Твой следующий соперник уже где-то рядом."}
                </span>
                <span className="table-number">СТОЛ № 01</span>
              </div>
              <div className="table-stage">
                <div className="stage-topline">
                  <span className="view-label">
                    <span className="tiny-square" />
                    3D · ЖИВАЯ ФИЗИКА
                  </span>
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
                  resetKey={resetKey}
                  strokeRef={strokeRef}
                />
                {!isWaiting && g.winner === null && (
                  <div className="table-hint">
                    <Crosshair size={13} />
                    {g.moving
                      ? "Хороший удар начинается с точности"
                      : g.shots > 0
                        ? g.message
                        : mode === "online" && !canAim
                          ? "Соперник выбирает направление"
                          : "Проведи по столу — повернёшь кий, затем «Ударить»"}
                  </div>
                )}
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
                      <p>{g.message}</p>
                      <button
                        className="primary-button"
                        onClick={() =>
                          mode === "practice"
                            ? resetPractice()
                            : exitToPractice()
                        }
                      >
                        Вернуться за стол <ArrowRight size={18} />
                      </button>
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
              <div className="panel-eyebrow">
                <span className="live-dot" />
                ОНЛАЙН-БИЛЬЯРД
              </div>
              <h2>
                Хорошая игра
                <br />
                начинается здесь.
              </h2>
              <p className="panel-description">
                Знакомый бильярд.
                <br />
                Новые соперники. Твой ритм.
              </p>
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
              <div className="match-details">
                <div>
                  <span>
                    <Users size={15} />
                    Соперник
                  </span>
                  <strong>Случайный игрок</strong>
                </div>
                <div>
                  <span>
                    <ShieldCheck size={15} />
                    Ставки
                  </span>
                  <strong>Только интерес</strong>
                </div>
              </div>
              <button
                className="primary-button find-button"
                onClick={isWaiting ? exitToPractice : startSearch}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : isWaiting ? (
                  <X size={18} />
                ) : (
                  <Gamepad2 size={19} />
                )}
                <span>
                  {isWaiting
                    ? "Отменить поиск"
                    : mode === "online"
                      ? "Новая игра"
                      : "Найти соперника"}
                </span>
                {!isWaiting && <ArrowRight size={18} />}
              </button>
              <div className="match-note">
                <i />
                {onlineAvailable === false
                  ? "Онлайн подключим позже. Сейчас — тренировка."
                  : connected
                    ? "Сервер готов. Можно играть."
                    : "Тренируйся, пока подключаемся"}
              </div>
              <div className="panel-separator">
                <span>или играй со своими</span>
              </div>
              <button className="friend-button" onClick={openFriends}>
                <Users size={17} />
                Пригласить друга
                <ArrowUpRight size={17} />
              </button>
              <div className="fair-play">
                <ShieldCheck size={20} />
                <p>
                  Без ставок и лишнего шума.
                  <br />
                  <strong>Только удовольствие от игры.</strong>
                </p>
              </div>
            </aside>
          </div>
          <section className="next-section">
            <div className="section-heading">
              <h2>У каждого свой стиль игры</h2>
              <span>
                Найди свой <ArrowDownLeft size={15} />
              </span>
            </div>
            <div className="feature-grid">
              <button
                className="feature-card training-card"
                onClick={() => {
                  if (mode !== "practice") setModal("leave");
                  else {
                    resetPractice();
                    notify("Свежая расстановка готова. Попробуй новый удар!");
                  }
                }}
              >
                <div className="feature-icon">
                  <Crosshair size={23} />
                </div>
                <span className="feature-content">
                  <strong>Наедине со столом</strong>
                  <span>Отточи удар. Почувствуй игру.</span>
                </span>
                <ArrowUpRight className="feature-arrow" size={20} />
                <span className="feature-label">ТРЕНИРОВКА</span>
              </button>
              <button
                className="feature-card friends-card"
                onClick={openFriends}
              >
                <div className="feature-icon">
                  <Users size={23} />
                </div>
                <span className="feature-content">
                  <strong>Свои люди. Свой стол.</strong>
                  <span>Пригласи друга — остальное готово.</span>
                </span>
                <ArrowUpRight className="feature-arrow" size={20} />
                <span className="feature-label">ИГРА С ДРУГОМ</span>
              </button>
              <button
                className="feature-card rules-card"
                onClick={() => setModal("rules")}
              >
                <div className="feature-icon">
                  <Sparkles size={22} />
                </div>
                <span className="feature-content">
                  <strong>От первого удара</strong>
                  <span>Всё, что нужно знать для начала.</span>
                </span>
                <ArrowUpRight className="feature-arrow" size={20} />
                <span className="feature-label">ПРАВИЛА ЗА МИНУТУ</span>
              </button>
            </div>
          </section>
          <footer>
            <span className="footer-brand">луза.</span>
            <span>Хорошая компания. Точная игра.</span>
            <span className="footer-right">
              <span />
              Создано для красивых партий
            </span>
          </footer>
        </main>
      </div>
      {overlays}
    </div>
  );
}
export default App;

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Copy,
  Crosshair,
  Eye,
  Flag,
  Gamepad2,
  History,
  Orbit,
  LoaderCircle,
  RotateCcw,
  Trophy,
  User,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Table from "./Table";
import Avatar from "./Avatar";
import Berry from "./Berry";
import { BALL_COLORS } from "./balls";
import { LOGO_LARGE_URL } from "./config";
import { type Game } from "../shared/game";
import type { CueStroke } from "../shared/rendering";

export type MiniProps = {
  screen: "lobby" | "game";
  game: Game;
  gameRef: React.RefObject<Game>;
  angleRef: React.RefObject<number>;
  strokeRef: React.RefObject<CueStroke | null>;
  resetKey: number;
  onAim: (angle: number) => void;
  /** Power the player charged on the side cue, 0..1. */
  onShoot: (power: number) => void;
  /** Inside Telegram the client draws its own back button over ours. */
  telegram: boolean;
  /** Short message shown over the table; empty most of the time. */
  toast: string;
  /** Camera: raking three-quarter view or straight down on the cloth. */
  view: "angled" | "top";
  onToggleView: () => void;
  canAim: boolean;
  isWaiting: boolean;
  mode: "practice" | "searching" | "online";
  players: { id: string; name: string; avatar?: string }[];
  myIndex: number;
  code: string;
  connected: boolean;
  /** null while the server address is being resolved, false = practice-only build. */
  onlineAvailable: boolean | null;
  population: number;
  power: number;
  /** True between the release and the moment the tip reaches the ball. */
  preparing: boolean;
  busy: boolean;
  searchSeconds: number;
  inviteCopied: boolean;
  name: string;
  sound: boolean;
  matches: number;
  /** Berries in the wallet; null until the server says. */
  balance: number | null;
  /** Stake of the table being played right now, 0 = дружеская партия. */
  matchStake: number;
  /** Berries just won in this match, shown in the result overlay. */
  prize: number;
  /** How many tables are waiting for an opponent right now. */
  openTables: number;
  onPractice: () => void;
  onFindOpponent: () => void;
  onWallet: () => void;
  onFriends: () => void;
  onRules: () => void;
  onHistory: () => void;
  onProfile: () => void;
  onToggleSound: () => void;
  onBack: () => void;
  /** Another game with the same opponent: who has asked so far. */
  rematch: "none" | "sent" | "offered";
  onRematch: () => void;
  onRestart: () => void;
  onCancelSearch: () => void;
  onCopyInvite: () => void;
};

export default function MiniApp(p: MiniProps) {
  const g = p.game;
  // A pool table is wide: on a portrait phone the whole game screen is turned
  // sideways so the table fills the display instead of being squeezed.
  const rotated = useLandscapeFrame(p.screen === "game");
  // Online is a placeholder until a game server is connected to the build.
  const soon = p.onlineAvailable === false;
  const myTurn = p.mode === "practice" || (p.canAim && !p.isWaiting);
  // Screen readers get the scoreboard as one sentence instead of 15 shapes.
  const scoreLabel =
    p.mode === "practice"
      ? `На столе ${left([...SOLIDS, 8, ...STRIPES], g)} из 15 шаров`
      : g.groups[p.myIndex]
        ? `Твои — ${g.groups[p.myIndex] === "solids" ? "сплошные" : "полосатые"}, осталось ${left(groupBalls(g.groups[p.myIndex]), g)}; у соперника ${left(groupBalls(g.groups[1 - p.myIndex]), g)}`
        : "Стол открыт: группы ещё не определены";
  const status = g.moving
    ? "Шары в движении"
    : p.mode === "practice"
      ? "Тренировка"
      : myTurn
        ? "Твой ход"
        : `Ход: ${p.players[g.turn]?.name || "соперник"}`;

  if (p.screen === "game")
    return (
      <div className={`mini-app mini-app-game${rotated ? " is-rotated" : ""}`}>
        <div className="mini-stage">
          <Table
            gameRef={p.gameRef}
            angleRef={p.angleRef}
            onAim={p.onAim}
            view={p.view}
            canAim={p.canAim && !p.isWaiting}
            power={p.power}
            resetKey={p.resetKey}
            strokeRef={p.strokeRef}
          />
          <div className="mini-score" role="img" aria-label={scoreLabel}>
            {p.mode === "practice" ? (
              <div className="mini-team">
                <Balls ids={SOLIDS} game={g} />
                <Balls ids={[8]} game={g} />
                <Balls ids={STRIPES} game={g} />
              </div>
            ) : (
              <>
                <div
                  className={`mini-team${myTurn && !g.moving ? " is-active" : ""}`}
                >
                  <Avatar
                    className="mini-avatar"
                    name={p.players[p.myIndex]?.name || "Ты"}
                    src={p.players[p.myIndex]?.avatar}
                  />
                  <span className="mini-team-name">
                    {p.players[p.myIndex]?.name || "Ты"}
                  </span>
                  <Balls
                    ids={groupBalls(g.groups[p.myIndex])}
                    game={g}
                    unknown={!g.groups[p.myIndex]}
                  />
                </div>
                <Balls ids={[8]} game={g} />
                <div
                  className={`mini-team is-right${!myTurn && !g.moving ? " is-active" : ""}`}
                >
                  <Balls
                    ids={groupBalls(g.groups[1 - p.myIndex])}
                    game={g}
                    unknown={!g.groups[1 - p.myIndex]}
                  />
                  <span className="mini-team-name">
                    {p.players[1 - p.myIndex]?.name || "Соперник"}
                  </span>
                  <Avatar
                    className="mini-avatar"
                    name={p.players[1 - p.myIndex]?.name || "Соперник"}
                    src={p.players[1 - p.myIndex]?.avatar}
                  />
                </div>
              </>
            )}
          </div>
          {g.winner === null && !p.isWaiting && (
            <CueControl
              key={g.shots}
              enabled={myTurn && !g.moving && !p.preparing}
              onShoot={p.onShoot}
            />
          )}
          {p.toast && (
            <div className="mini-toast" role="status">
              {p.toast}
            </div>
          )}
          {/* Telegram floats its own ⋯ and ✕ over the top corner of the
              WebView, so every control of ours lives along the bottom. */}
          <footer className="mini-bar">
            {/* Telegram shows its own back button in the same corner. */}
            {!p.telegram && (
              <button
                className="mini-icon-button"
                aria-label="Назад в меню"
                onClick={p.onBack}
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="mini-status">
              <strong className={myTurn && !g.moving ? "is-turn" : ""}>
                {status}
              </strong>
              {p.matchStake > 0 && (
                <em className="mini-stake" title="Ставка стола">
                  <Berry size={11} />
                  {p.matchStake}
                </em>
              )}
            </div>
            <button
              className="mini-icon-button"
              aria-label={p.view === "top" ? "Вид сбоку" : "Вид сверху"}
              onClick={p.onToggleView}
            >
              {p.view === "top" ? <Orbit size={19} /> : <Eye size={19} />}
            </button>
            <button
              className="mini-icon-button"
              aria-label={
                p.mode === "practice" ? "Расставить заново" : "Выйти из матча"
              }
              onClick={p.mode === "practice" ? p.onRestart : p.onBack}
            >
              {p.mode === "practice" ? (
                <RotateCcw size={19} />
              ) : (
                <Flag size={19} />
              )}
            </button>
          </footer>
          {p.isWaiting && (
            <div className="mini-overlay">
              <LoaderCircle className="spin" size={34} />
              <h3>{p.code ? "Ждём друга" : "Ищем соперника"}</h3>
              {p.code && <p className="mini-room-code">{p.code}</p>}
            </div>
          )}
          {g.winner !== null && (
            <div className="mini-overlay">
              <Trophy size={34} className="winner-icon" />
              <h3>
                {g.winner === (p.mode === "practice" ? 0 : p.myIndex)
                  ? "Победа!"
                  : "Поражение"}
              </h3>
              <p>
                {g.message}
                {p.mode !== "practice" && p.rematch === "offered"
                  ? " Соперник предлагает сыграть ещё."
                  : ""}
              </p>
              {p.matchStake > 0 && (
                <p className="mini-payout">
                  {p.prize > 0
                    ? `Банк твой: +${p.prize}`
                    : `Ставка ушла сопернику: −${p.matchStake}`}
                  <Berry size={13} />
                </p>
              )}
              <button
                className="mini-primary"
                disabled={p.rematch === "sent"}
                onClick={p.mode === "practice" ? p.onRestart : p.onRematch}
              >
                {p.mode === "practice"
                  ? "Ещё партию"
                  : p.rematch === "sent"
                    ? "Ждём соперника…"
                    : "Сыграть ещё"}
                <ArrowRight size={17} />
              </button>
              {p.mode !== "practice" && (
                <button className="mini-text-button" onClick={p.onBack}>
                  В меню
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="mini-app mini-app-lobby">
      <header className="mini-bar">
        <button
          className="mini-balance"
          onClick={p.onWallet}
          aria-label="Кошелёк: ягодки и пополнение"
          title="Кошелёк: ягодки и пополнение"
        >
          <Berry size={13} />
          <strong>{p.balance === null ? "—" : p.balance}</strong>
        </button>
        <span className={`mini-online ${p.connected ? "live" : ""}`}>
          <i />
          {soon
            ? "Онлайн позже"
            : p.connected
              ? `${p.population} онлайн`
              : "Подключаемся…"}
        </span>
        <button
          className="mini-icon-button"
          aria-label={p.sound ? "Выключить звук" : "Включить звук"}
          onClick={p.onToggleSound}
        >
          {p.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </header>
      <div className="mini-hero">
        <img className="mini-logo" src={LOGO_LARGE_URL} alt="" />
        <h1>Amazing Pool</h1>
      </div>
      {p.isWaiting ? (
        <div className="mini-searching">
          <LoaderCircle className="spin" size={30} />
          <strong>{p.code ? "Ждём друга" : "Ищем соперника"}</strong>
          {p.matchStake > 0 && (
            <span className="mini-stake-note">
              Ставка стола{" "}
              <b>
                <Berry size={12} />
                {p.matchStake}
              </b>
            </span>
          )}
          {p.code ? (
            <>
              <button className="mini-code" onClick={p.onCopyInvite}>
                {p.code}
                {p.inviteCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <span>Отправь другу ссылку или код</span>
            </>
          ) : (
            <span>
              {Math.floor(p.searchSeconds / 60)}:
              {String(p.searchSeconds % 60).padStart(2, "0")} в очереди
            </span>
          )}
          <button className="mini-text-button" onClick={p.onCancelSearch}>
            <X size={15} />
            Отменить
          </button>
        </div>
      ) : (
        <div className="mini-menu">
          <button
            className={`mini-choice ${soon ? "muted" : "primary"}`}
            onClick={p.onFindOpponent}
            disabled={p.busy}
          >
            <Gamepad2 size={22} />
            <span>
              <strong>Играть онлайн</strong>
              <small>
                {soon
                  ? "Нужен игровой сервер"
                  : p.openTables > 0
                    ? `Открытых столов: ${p.openTables}`
                    : "Столы и ставки"}
              </small>
            </span>
            {soon ? (
              <em className="mini-soon">скоро</em>
            ) : (
              <ArrowRight size={18} />
            )}
          </button>
          <button
            className={`mini-choice ${soon ? "muted" : ""}`}
            onClick={p.onFriends}
          >
            <Users size={22} />
            <span>
              <strong>Играть с другом</strong>
              <small>Комната по коду или ссылке</small>
            </span>
            {soon ? (
              <em className="mini-soon">скоро</em>
            ) : (
              <ArrowRight size={18} />
            )}
          </button>
          <button
            className={`mini-choice ${soon ? "primary" : ""}`}
            onClick={p.onPractice}
          >
            <Crosshair size={22} />
            <span>
              <strong>Тренировка</strong>
              <small>Одному, без соперника</small>
            </span>
            <ArrowRight size={18} />
          </button>
          {soon && (
            <p className="mini-note">
              Тренировка работает полностью. Онлайн включится, когда к сборке
              добавят адрес игрового сервера.
            </p>
          )}
        </div>
      )}
      <nav className="mini-tabs">
        <button onClick={p.onRules}>
          <CircleHelp size={17} />
          Правила
        </button>
        <button onClick={p.onHistory}>
          <History size={17} />
          Матчи{p.matches > 0 ? ` · ${p.matches}` : ""}
        </button>
        <button onClick={p.onProfile}>
          <User size={17} />
          {p.name}
        </button>
      </nav>
    </div>
  );
}

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];
/** The balls a player still has to clear. The 8 is shown separately. */
function groupBalls(group: "solids" | "stripes" | null) {
  return group === "stripes" ? STRIPES : SOLIDS;
}
const left = (ids: number[], game: Game) =>
  ids.filter((id) => !game.balls.find((b) => b.id === id)?.pocketed).length;
/**
 * The scoreboard every pool app has: the balls themselves, in their own
 * colours and numbers, hollow once they drop. No words needed.
 */
function Balls({
  ids,
  game,
  unknown = false,
}: {
  ids: number[];
  game: Game;
  /** Groups are not decided yet: show blanks instead of guessing a side. */
  unknown?: boolean;
}) {
  return (
    <span className="mini-balls">
      {ids.map((id, i) => {
        const gone = !!game.balls.find((b) => b.id === id)?.pocketed;
        if (unknown) return <span key={i} className="mini-ball is-unknown" />;
        return (
          <span
            key={id}
            className={`mini-ball${gone ? " is-gone" : ""}${
              id > 8 ? " is-striped" : ""
            }`}
            style={{ "--ball": BALL_COLORS[id] } as React.CSSProperties}
          >
            {!gone && <b>{id}</b>}
          </span>
        );
      })}
    </span>
  );
}

/** True while a landscape-only screen has to be rotated inside a portrait phone. */
function useLandscapeFrame(active: boolean) {
  const [rotated, setRotated] = useState(false);
  useEffect(() => {
    if (!active) {
      setRotated(false);
      return;
    }
    const sync = () =>
      setRotated(window.innerHeight > window.innerWidth * 1.08);
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, [active]);
  return rotated;
}

/** How far the side cue travels, in CSS pixels, from rest to full power. */
const CUE_TRAVEL = 150;

/**
 * The cue the player actually handles: a second stick drawn beside the table.
 * Dragging it back charges the shot one to one with the finger, letting go
 * plays it. The cue on the cloth only shows the direction.
 */
function CueControl({
  enabled,
  onShoot,
}: {
  enabled: boolean;
  onShoot: (power: number) => void;
}) {
  const [pull, setPull] = useState(0);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  // The release reads the ref, never the state: on a slow frame React has not
  // re-rendered yet, and a shot charged to 60 % went off as a zero-power tap.
  const held = useRef(0);
  const power = Math.min(1, pull / CUE_TRAVEL);
  const down = (e: React.PointerEvent) => {
    if (!enabled || drag.current) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    // The frame is turned 90°: pulling the cue "down" the screen the player
    // sees is a drag towards the physical left edge of the phone.
    const travel = e.currentTarget.closest(".is-rotated")
      ? drag.current.x - e.clientX
      : e.clientY - drag.current.y;
    held.current = Math.max(0, Math.min(CUE_TRAVEL * 1.12, travel));
    setPull(held.current);
  };
  const up = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    const charged = Math.min(1, held.current / CUE_TRAVEL);
    held.current = 0;
    setPull(0);
    if (enabled && charged > 0.07) onShoot(Math.max(0.08, charged));
  };
  // Without a pointer the cue is charged with the arrow keys and fired with
  // Enter, so the shot is not locked behind a drag gesture.
  const key = (e: React.KeyboardEvent) => {
    if (!enabled) return;
    const step = e.shiftKey ? CUE_TRAVEL / 20 : CUE_TRAVEL / 5;
    const set = (v: number) => {
      held.current = v;
      setPull(v);
    };
    if (e.key === "ArrowDown" || e.key === "ArrowRight")
      set(Math.min(CUE_TRAVEL, held.current + step));
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      set(Math.max(0, held.current - step));
    else if (e.key === "Enter" || e.key === " ") {
      const charged = Math.min(1, held.current / CUE_TRAVEL);
      set(0);
      if (charged > 0.07) onShoot(Math.max(0.08, charged));
    } else return;
    e.preventDefault();
  };
  return (
    <div
      className={`mini-cue${enabled ? "" : " is-off"}${pull > 0 ? " is-pulled" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      tabIndex={enabled ? 0 : -1}
      role="slider"
      aria-label="Кий: оттяни назад и отпусти"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(power * 100)}
    >
      <div className="mini-cue-rail">
        <div
          className="mini-cue-stick"
          style={{ transform: `translateY(${pull}px)` }}
        >
          <i className="mini-cue-tip" />
          <i className="mini-cue-shaft" />
          <i className="mini-cue-butt" />
        </div>
      </div>
      <span className="mini-cue-power">
        {pull > 0 ? `${Math.round(power * 100)}%` : ""}
      </span>
    </div>
  );
}

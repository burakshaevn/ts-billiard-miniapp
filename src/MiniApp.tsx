import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Copy,
  Crosshair,
  Flag,
  Gamepad2,
  History,
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
import BallIcon from "./BallIcon";
import { shotSpeedMps, type Game } from "../shared/game";
import type { CueStroke } from "../shared/rendering";

export type MiniProps = {
  screen: "lobby" | "game";
  game: Game;
  gameRef: React.RefObject<Game>;
  angleRef: React.RefObject<number>;
  strokeRef: React.RefObject<CueStroke | null>;
  resetKey: number;
  onAim: (angle: number) => void;
  /** Power the player charged by pulling the cue back, 0..1. */
  onShoot: (power: number) => void;
  canAim: boolean;
  isWaiting: boolean;
  mode: "practice" | "searching" | "online";
  players: { id: string; name: string }[];
  myIndex: number;
  code: string;
  connected: boolean;
  /** null while the server address is being resolved, false = practice-only build. */
  onlineAvailable: boolean | null;
  population: number;
  power: number;
  busy: boolean;
  searchSeconds: number;
  inviteCopied: boolean;
  name: string;
  sound: boolean;
  matches: number;
  onPractice: () => void;
  onFindOpponent: () => void;
  onFriends: () => void;
  onRules: () => void;
  onHistory: () => void;
  onProfile: () => void;
  onToggleSound: () => void;
  onBack: () => void;
  onRestart: () => void;
  onCancelSearch: () => void;
  onCopyInvite: () => void;
};

export default function MiniApp(p: MiniProps) {
  const g = p.game;
  // A pool table is wide: on a portrait phone the whole game screen is turned
  // sideways so the table fills the display instead of being squeezed.
  const rotated = useLandscapeFrame(p.screen === "game");
  // Power is whatever the cue was pulled back to; nothing to show at rest.
  const [charge, setCharge] = useState<number | null>(null);
  // Online is a placeholder until a game server is connected to the build.
  const soon = p.onlineAvailable === false;
  const pocketed = g.balls.filter((b) => b.pocketed && b.id !== 0);
  const myTurn = p.mode === "practice" || (p.canAim && !p.isWaiting);
  const group =
    p.mode === "practice"
      ? "Свободная игра"
      : g.groups[p.myIndex] === "solids"
        ? "Твои — сплошные"
        : g.groups[p.myIndex] === "stripes"
          ? "Твои — полосатые"
          : "Стол открыт";
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
            onCharge={setCharge}
            onShoot={p.onShoot}
            canAim={p.canAim && !p.isWaiting}
            power={p.power}
            resetKey={p.resetKey}
            strokeRef={p.strokeRef}
          />
          <header className="mini-bar">
            <button
              className="mini-icon-button"
              aria-label="Назад в меню"
              onClick={p.onBack}
            >
              <ArrowLeft size={20} />
            </button>
            <div className="mini-status">
              <strong className={myTurn && !g.moving ? "is-turn" : ""}>
                {status}
              </strong>
              <span>
                {p.mode === "practice"
                  ? group
                  : `${p.players[p.myIndex]?.name || "Ты"} · ${
                      p.players[1 - p.myIndex]?.name || "ждём соперника"
                    }`}
              </span>
            </div>
            {pocketed.length > 0 && (
              <div className="mini-pocketed">
                {pocketed.slice(-7).map((b) => (
                  <BallIcon key={b.id} n={b.id} small />
                ))}
              </div>
            )}
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
          </header>
          {charge !== null && (
            <div className="mini-charge">
              <div className="mini-charge-track">
                <i style={{ height: `${Math.round(charge * 100)}%` }} />
              </div>
              <span>
                {Math.round(charge * 100)}%
                <small>{shotSpeedMps(charge).toFixed(1)} м/с</small>
              </span>
            </div>
          )}
          {g.winner === null && !p.isWaiting && (
            <div className="mini-hint">
              <Crosshair size={12} />
              {g.moving
                ? "Шары катятся"
                : !myTurn
                  ? "Соперник целится"
                  : g.shots > 0
                    ? g.message
                    : "Оттяни кий назад и отпусти — это удар"}
            </div>
          )}
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
              <p>{g.message}</p>
              <button
                className="mini-primary"
                onClick={p.mode === "practice" ? p.onRestart : p.onBack}
              >
                {p.mode === "practice" ? "Ещё партию" : "В меню"}
                <ArrowRight size={17} />
              </button>
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="mini-app mini-app-lobby">
      <header className="mini-bar">
        <span className="mini-brand">
          <span className="mini-brand-ball">8</span>
          луза
        </span>
        <span className={`mini-online ${p.connected ? "live" : ""}`}>
          <i />
          {soon
            ? "Онлайн позже"
            : p.connected
              ? `${p.population} в клубе`
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
        <BallIcon />
        <h1>Пул «Восьмёрка»</h1>
        <p>1 на 1, без ставок и лишнего</p>
      </div>
      {p.isWaiting ? (
        <div className="mini-searching">
          <LoaderCircle className="spin" size={30} />
          <strong>{p.code ? "Ждём друга" : "Ищем соперника"}</strong>
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
              <small>Случайный соперник</small>
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

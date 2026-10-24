import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createGame, shoot, step, type Game } from "../shared/game.ts";
import {
  WELCOME_BERRIES,
  canAfford,
  isStake,
  packById,
  potFor,
} from "../shared/wallet.ts";
import path from "node:path";

const app = express();
app.use(express.json({ limit: "64kb" }));
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2048 });
type Client = {
  id: string;
  name: string;
  /** Telegram profile photo, shown next to the name over the table. */
  avatar?: string;
  /**
   * Wallet owner: `tg:<id>` inside Telegram, `guest:<uuid>` in a browser. Two
   * tabs of the same player share one balance. NOTE: initData is not verified
   * yet, so this identifies a player only as well as the client is honest —
   * see README before putting anything of real value on it.
   */
  key: string;
  /** Telegram user id, needed to bill Stars through the bot. */
  tgId?: number;
  ws: WebSocket;
  room?: string;
  alive: boolean;
  lastAction: number;
  /** Asked for another game after the current one ended. */
  rematch?: boolean;
};
type Room = {
  code: string;
  players: Client[];
  game: Game;
  private: boolean;
  created: number;
  /** Berries each player put in; 0 = дружеский стол. */
  stake: number;
  /** Berries held by the table, paid out to the winner. */
  pot: number;
};
const clients = new Map<string, Client>(),
  rooms = new Map<string, Room>();

/* ------------------------------ Wallets --------------------------------- */
/**
 * Balances live in one small JSON file next to the server. It is not a
 * database: good enough for one process, replace it before real money.
 */
const WALLET_FILE =
  process.env.WALLETS_FILE || path.resolve("server/.wallets.json");
const wallets = new Map<string, number>();
/** Telegram charge ids already credited, so a retried webhook pays once. */
const charges = new Set<string>();
try {
  const saved = JSON.parse(readFileSync(WALLET_FILE, "utf8"));
  for (const [key, value] of Object.entries(saved.wallets || {}))
    if (typeof value === "number" && Number.isFinite(value))
      wallets.set(key, Math.max(0, Math.round(value)));
  for (const id of saved.charges || []) charges.add(String(id));
} catch {
  // No file yet: every wallet starts at the welcome balance.
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveWallets() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      const body = JSON.stringify({
        wallets: Object.fromEntries(wallets),
        charges: [...charges].slice(-5000),
      });
      writeFileSync(WALLET_FILE + ".tmp", body);
      renameSync(WALLET_FILE + ".tmp", WALLET_FILE);
    } catch (e) {
      console.error("wallets not saved:", e);
    }
  }, 500).unref?.();
}
function balanceOf(key: string) {
  if (!wallets.has(key)) {
    wallets.set(key, WELCOME_BERRIES);
    saveWallets();
  }
  return wallets.get(key)!;
}
function addBerries(key: string, amount: number) {
  wallets.set(key, Math.max(0, balanceOf(key) + Math.round(amount)));
  saveWallets();
  pushWallet(key);
}
/** Every tab of that player sees the new balance at once. */
function pushWallet(key: string) {
  clients.forEach((c) => {
    if (c.key === key) send(c, { type: "wallet", balance: balanceOf(key) });
  });
}
const send = (c: Client, data: unknown) => {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(data));
};
const population = () =>
  clients.forEach((c) => send(c, { type: "population", count: clients.size }));
function state(r: Room) {
  // A finished game pays out exactly once, before anyone is told about it.
  let prize = 0;
  if (r.game.winner !== null && r.pot > 0) {
    prize = r.pot;
    payout(r, r.players[r.game.winner]);
  }
  r.players.forEach((c, i) =>
    send(c, {
      type: "state",
      game: r.game,
      players: r.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
      })),
      yourIndex: i,
      code: r.code,
      private: r.private,
      stake: r.stake,
      pot: r.pot,
      /** Berries this player has just won, 0 for everyone else. */
      prize: i === r.game.winner ? prize : 0,
    }),
  );
}
/**
 * The winner takes the pot. Called from every place that can end a game, and
 * safe to call twice: the pot is cleared as it is paid.
 */
function payout(r: Room, winner: Client) {
  if (r.pot <= 0) return;
  const prize = r.pot;
  r.pot = 0;
  addBerries(winner.key, prize);
}
/** Open tables other players can sit at: public, still waiting for a second. */
const openTables = () =>
  [...rooms.values()]
    .filter(
      (r) =>
        !r.private &&
        r.players.length === 1 &&
        r.game.shots === 0 &&
        // A host whose socket is already closing would swallow the next
        // player: the table disappears as soon as the close is processed.
        r.players[0].ws.readyState === WebSocket.OPEN,
    )
    .sort((a, b) => a.created - b.created)
    .slice(0, 24)
    .map((r) => ({
      code: r.code,
      host: r.players[0].name,
      avatar: r.players[0].avatar,
      stake: r.stake,
      created: r.created,
    }));
/** Everyone in the lobby sees the list; players at a table do not need it. */
function pushTables() {
  const tables = openTables();
  clients.forEach((c) => {
    if (!c.room) send(c, { type: "tables", tables });
  });
}
function leave(c: Client) {
  // Read the code before clearing it: the loop below also clears c.room, so
  // deleting the room afterwards used to delete the key `undefined` and left
  // the abandoned room in the map, joinable by the next player.
  const code = c.room;
  delete c.rematch;
  if (!code) return;
  delete c.room;
  const r = rooms.get(code);
  if (!r) return;
  rooms.delete(code);
  const rest = r.players.filter((p) => p !== c);
  // Walking out of a staked game is a forfeit: the pot goes to who stayed.
  // Nobody stayed (both gone) — the stakes are returned instead.
  if (r.pot > 0) {
    if (rest.length) payout(r, rest[0]);
    else {
      const refund = r.pot / r.players.length;
      r.pot = 0;
      r.players.forEach((p) => addBerries(p.key, refund));
    }
  }
  r.players.forEach((p) => {
    delete p.room;
    if (p !== c) send(p, { type: "opponent_left" });
  });
  pushTables();
}
/** Both players pay the stake into the pot; false = someone cannot afford it. */
function escrow(r: Room) {
  if (r.stake <= 0 || r.pot > 0) return true;
  if (r.players.some((p) => !canAfford(balanceOf(p.key), r.stake)))
    return false;
  r.players.forEach((p) => addBerries(p.key, -r.stake));
  r.pot = potFor(r.stake);
  return true;
}
function newRoom(players: Client[], isPrivate: boolean, stake: number) {
  let code: string;
  do {
    code = randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  const room: Room = {
    code,
    players,
    game: createGame(),
    private: isPrivate,
    created: Date.now(),
    stake,
    pot: 0,
  };
  rooms.set(code, room);
  players.forEach((c) => {
    c.room = code;
    delete c.rematch;
  });
  if (players.length === 2) escrow(room);
  state(room);
  pushTables();
  return room;
}
/** Sit down at a table that is waiting for a second player. */
function sit(c: Client, room: Room) {
  if (!canAfford(balanceOf(c.key), room.stake)) {
    send(c, {
      type: "error",
      message: `Не хватает ягодок: за этот стол нужно ${room.stake}.`,
    });
    return false;
  }
  if (!canAfford(balanceOf(room.players[0].key), room.stake)) {
    send(c, { type: "error", message: "Хозяин стола уже не тянет эту ставку" });
    return false;
  }
  leave(c);
  room.players.push(c);
  c.room = room.code;
  escrow(room);
  state(room);
  pushTables();
  return true;
}
wss.on("connection", (ws) => {
  const c: Client = {
    id: randomUUID(),
    name: "Игрок",
    key: "guest:" + randomUUID(),
    ws,
    alive: true,
    lastAction: 0,
  };
  clients.set(c.id, c);
  send(c, { type: "welcome", id: c.id });
  send(c, { type: "wallet", balance: balanceOf(c.key) });
  send(c, { type: "tables", tables: openTables() });
  population();
  ws.on("pong", () => {
    c.alive = true;
  });
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (!m || typeof m !== "object") return;
      if (m.type === "hello") {
        // The wallet key: `tg:<id>` inside Telegram, `guest:<uuid>` otherwise.
        // Nothing is verified yet (see README), so a key is a name, not proof.
        if (
          typeof m.key === "string" &&
          /^(tg:\d{1,20}|guest:[\w-]{6,64})$/.test(m.key) &&
          m.key !== c.key
        ) {
          c.key = m.key;
          send(c, { type: "wallet", balance: balanceOf(c.key) });
        }
        if (typeof m.tgId === "number" && Number.isSafeInteger(m.tgId))
          c.tgId = m.tgId;
        c.name =
          typeof m.name === "string"
            ? m.name.trim().slice(0, 24) || "Игрок"
            : "Игрок";
        // Only a plain https image URL is passed on to the other player: the
        // avatar ends up in someone else's <img src>, so no javascript: or
        // data: payloads and no unbounded strings.
        c.avatar =
          typeof m.avatar === "string" &&
          /^https:\/\/[\w.-]+\/[\w./%+-]*$/.test(m.avatar) &&
          m.avatar.length <= 300
            ? m.avatar
            : undefined;
        return;
      }
      // Leaving is never throttled and never counts as a throttled action: a
      // dropped cancel would keep this client at a table, and the next player
      // could sit down against an opponent who already left. Repeated leaves
      // are cheap because an idle client exits immediately.
      if (m.type === "leave") {
        if (c.room) leave(c);
        send(c, { type: "left" });
        send(c, { type: "tables", tables: openTables() });
        return;
      }
      if (Date.now() - c.lastAction < 100) return;
      c.lastAction = Date.now();
      // Quick game: sit at the oldest open table with this stake, or open one
      // and wait there. The waiting tables are exactly what the lobby lists.
      if (m.type === "queue") {
        const stake = isStake(m.stake) ? m.stake : 0;
        if (!canAfford(balanceOf(c.key), stake)) {
          send(c, {
            type: "error",
            message: `Не хватает ягодок: нужно ${stake}, а у тебя ${balanceOf(c.key)}.`,
          });
          return;
        }
        const open = openTables()
          .map((t) => rooms.get(t.code)!)
          .find(
            (r) =>
              r.stake === stake &&
              r.players[0] !== c &&
              canAfford(balanceOf(r.players[0].key), stake),
          );
        if (open) {
          sit(c, open);
          return;
        }
        leave(c);
        newRoom([c], false, stake);
        send(c, { type: "waiting" });
        return;
      }
      // A table only friends can find: it is never listed in the lobby.
      if (m.type === "create") {
        const stake = isStake(m.stake) ? m.stake : 0;
        if (!canAfford(balanceOf(c.key), stake)) {
          send(c, {
            type: "error",
            message: `Не хватает ягодок: нужно ${stake}, а у тебя ${balanceOf(c.key)}.`,
          });
          return;
        }
        leave(c);
        newRoom([c], true, stake);
        return;
      }
      // By code from a friend, or by tapping a table in the open list.
      if (m.type === "join") {
        if (typeof m.code !== "string") return;
        const room = rooms.get(m.code.trim().toUpperCase());
        if (!room || room.players.length !== 1 || room.players[0] === c) {
          send(c, {
            type: "error",
            message: "Стол не найден или уже занят",
          });
          return;
        }
        sit(c, room);
        return;
      }
      // Berries for Telegram Stars. The invoice is created by the bot; the
      // balance is credited only by the payment webhook below.
      if (m.type === "topup") {
        const pack = packById(m.pack);
        if (pack) void topup(c, pack);
        return;
      }
      // Another game with the same opponent: both sides have to ask for it.
      if (m.type === "rematch" && c.room) {
        const room = rooms.get(c.room);
        if (!room || room.players.length !== 2 || room.game.winner === null)
          return;
        c.rematch = true;
        if (room.players.every((p) => p.rematch)) {
          room.players.forEach((p) => delete p.rematch);
          // Another game means another bet: both pay in again.
          if (!escrow(room)) {
            room.players.forEach((p) =>
              send(p, {
                type: "error",
                message: `Для новой партии каждому нужно ${room.stake} ягодок.`,
              }),
            );
            return;
          }
          room.game = createGame();
          state(room);
        } else
          room.players.forEach((p) =>
            send(p, { type: p === c ? "rematch_sent" : "rematch_offer" }),
          );
        return;
      }
      if (m.type === "shoot" && c.room) {
        const room = rooms.get(c.room);
        if (
          !room ||
          room.players.length !== 2 ||
          room.players[room.game.turn] !== c
        )
          return;
        if (typeof m.angle !== "number" || typeof m.power !== "number") return;
        if (shoot(room.game, m.angle, m.power)) state(room);
      }
    } catch {
      send(c, { type: "error", message: "Не удалось обработать действие" });
    }
  });
  ws.on("close", () => {
    leave(c);
    clients.delete(c.id);
    population();
  });
  ws.on("error", () => ws.close());
});
// Integrate elapsed monotonic time, not "two steps per timer callback".
// Node timers can run at 16ms or be delayed; that must not change shot speed.
let lastTick = performance.now(),
  accumulator = 0,
  lastBroadcast = lastTick;
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;
  const steps = Math.floor(accumulator / (1 / 120));
  accumulator -= steps / 120;
  const broadcast = now - lastBroadcast >= 1000 / 30;
  for (const room of rooms.values())
    if (room.game.moving) {
      for (let i = 0; i < steps && room.game.moving; i++)
        step(room.game, 1 / 120);
      if (broadcast || !room.game.moving) state(room);
    }
  if (broadcast) lastBroadcast = now;
}, 1000 / 120);
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
  for (const r of rooms.values())
    if (r.players.length === 1 && Date.now() - r.created > 30 * 60 * 1000) {
      r.players.forEach((c) => {
        delete c.room;
        send(c, {
          type: "error",
          message: "Время ожидания комнаты истекло. Создай новую.",
        });
      });
      rooms.delete(r.code);
      pushTables();
    }
}, 30000).unref();

/* --------------------------- Telegram Stars ------------------------------ */
/**
 * Berries are sold for Telegram Stars (currency XTR). Three pieces are needed
 * and all three live here:
 *
 *   1. `createInvoiceLink` on the bot, called when a player picks a pack;
 *      the Mini App opens the returned link with `WebApp.openInvoice`.
 *   2. `pre_checkout_query` — Telegram waits at most 10 seconds for an answer.
 *   3. `successful_payment` — the only moment berries are credited, keyed by
 *      `telegram_payment_charge_id` so a retried update cannot pay twice.
 *
 * Without BOT_TOKEN (for example on a plain GitHub Pages deployment with no
 * bot behind it) the client is told so instead of being shown a dead button.
 * ALLOW_TEST_TOPUP=1 credits packs without paying — local demos only.
 */
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const botApi = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<{ ok: boolean; result?: unknown }>);

async function topup(
  c: Client,
  pack: { id: string; berries: number; stars: number },
) {
  if (process.env.ALLOW_TEST_TOPUP === "1" && !BOT_TOKEN) {
    addBerries(c.key, pack.berries);
    send(c, { type: "topup_done", pack: pack.id, test: true });
    return;
  }
  if (!BOT_TOKEN) {
    send(c, {
      type: "topup_unavailable",
      reason:
        "Оплата звёздами появится, когда сервер подключат к боту. Сейчас играем на стартовые ягодки.",
    });
    return;
  }
  try {
    const invoice = await botApi("createInvoiceLink", {
      title: `${pack.berries} ягодок`,
      description: "Ягодки для ставок в Amazing Pool",
      // Echoed back by Telegram in pre_checkout_query and successful_payment.
      payload: JSON.stringify({ key: c.key, pack: pack.id }),
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `${pack.berries} ягодок`, amount: pack.stars }],
    });
    if (!invoice.ok || typeof invoice.result !== "string")
      throw new Error("createInvoiceLink failed");
    send(c, { type: "topup_link", pack: pack.id, url: invoice.result });
  } catch (e) {
    console.error("invoice:", e);
    send(c, {
      type: "topup_unavailable",
      reason: "Счёт не выставился. Попробуй ещё раз чуть позже.",
    });
  }
}

// Point the bot webhook at /api/telegram/<TELEGRAM_WEBHOOK_SECRET>.
app.post("/api/telegram/:secret", (req, res) => {
  if (!BOT_TOKEN || !WEBHOOK_SECRET || req.params.secret !== WEBHOOK_SECRET) {
    res.sendStatus(404);
    return;
  }
  const update = req.body || {};
  // Answer first, think later: ten seconds is the whole budget.
  if (update.pre_checkout_query) {
    void botApi("answerPreCheckoutQuery", {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: !!packById(
        parsePayload(update.pre_checkout_query.invoice_payload)?.pack,
      ),
      error_message: "Этот набор ягодок больше не продаётся",
    });
    res.sendStatus(200);
    return;
  }
  const paid = update.message?.successful_payment;
  if (paid) {
    const charge = String(paid.telegram_payment_charge_id || "");
    const data = parsePayload(paid.invoice_payload);
    const pack = packById(data?.pack);
    if (pack && data?.key && charge && !charges.has(charge)) {
      charges.add(charge);
      addBerries(data.key, pack.berries);
      console.log(
        `paid ${pack.stars}⭐ → ${pack.berries} ягодок for ${data.key}`,
      );
    }
  }
  res.sendStatus(200);
});
function parsePayload(raw: unknown): { key?: string; pack?: string } | null {
  try {
    const value = JSON.parse(String(raw));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, players: clients.size, stars: !!BOT_TOKEN }),
);
if (process.argv.includes("--production")) {
  app.use(express.static(path.resolve("dist")));
  app.get("*", (_req, res) => res.sendFile(path.resolve("dist/index.html")));
}
server.listen(Number(process.env.PORT) || 3001, "0.0.0.0", () =>
  console.log(
    "Billiard server listening on 0.0.0.0:" + (process.env.PORT || 3001),
  ),
);

import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomUUID } from "node:crypto";
import { createGame, shoot, step, type Game } from "../shared/game.ts";
import path from "node:path";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2048 });
type Client = {
  id: string;
  name: string;
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
};
const clients = new Map<string, Client>(),
  rooms = new Map<string, Room>();
let queue: Client[] = [];
const send = (c: Client, data: unknown) => {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(data));
};
const population = () =>
  clients.forEach((c) => send(c, { type: "population", count: clients.size }));
function state(r: Room) {
  r.players.forEach((c, i) =>
    send(c, {
      type: "state",
      game: r.game,
      players: r.players.map((p) => ({ id: p.id, name: p.name })),
      yourIndex: i,
      code: r.code,
      private: r.private,
    }),
  );
}
function leave(c: Client) {
  queue = queue.filter((p) => p.id !== c.id);
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
  r.players.forEach((p) => {
    delete p.room;
    if (p !== c) send(p, { type: "opponent_left" });
  });
}
function newRoom(players: Client[], isPrivate: boolean) {
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
  };
  rooms.set(code, room);
  players.forEach((c) => {
    c.room = code;
    delete c.rematch;
  });
  state(room);
  return room;
}
wss.on("connection", (ws) => {
  const c: Client = {
    id: randomUUID(),
    name: "Игрок",
    ws,
    alive: true,
    lastAction: 0,
  };
  clients.set(c.id, c);
  send(c, { type: "welcome", id: c.id });
  population();
  ws.on("pong", () => {
    c.alive = true;
  });
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (!m || typeof m !== "object") return;
      if (m.type === "hello") {
        c.name =
          typeof m.name === "string"
            ? m.name.trim().slice(0, 24) || "Игрок"
            : "Игрок";
        return;
      }
      // Leaving is never throttled and never counts as a throttled action: a
      // dropped cancel would keep this client in the queue or in a room, and
      // the next player could be matched with an opponent who already left.
      // Repeated leaves are cheap because an idle client exits immediately.
      if (m.type === "leave") {
        if (c.room || queue.some((p) => p.id === c.id)) leave(c);
        send(c, { type: "left" });
        return;
      }
      if (Date.now() - c.lastAction < 100) return;
      c.lastAction = Date.now();
      if (m.type === "queue") {
        leave(c);
        queue = queue.filter((p) => p.ws.readyState === WebSocket.OPEN);
        const other = queue.shift();
        if (other) newRoom([other, c], false);
        else {
          queue.push(c);
          send(c, { type: "waiting" });
        }
        return;
      }
      if (m.type === "create") {
        leave(c);
        newRoom([c], true);
        return;
      }
      if (m.type === "join") {
        if (typeof m.code !== "string") return;
        const room = rooms.get(m.code.trim().toUpperCase());
        if (
          !room ||
          !room.private ||
          room.players.length !== 1 ||
          room.players[0] === c
        ) {
          send(c, {
            type: "error",
            message: "Комната не найдена или уже занята",
          });
          return;
        }
        leave(c);
        room.players.push(c);
        c.room = room.code;
        state(room);
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
    }
}, 30000).unref();
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, players: clients.size }),
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

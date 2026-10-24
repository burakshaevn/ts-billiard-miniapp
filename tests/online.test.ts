import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
const PORT = 3029;
let server: ChildProcess;
const peers: WebSocket[] = [];
before(async () => {
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Server startup timeout")),
      10000,
    );
    server.stdout!.on("data", (d) => {
      if (d.toString().includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited: ${code}`));
    });
  });
});
after(() => {
  peers.forEach((p) => p.terminate());
  server?.kill();
});
async function peer(name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  peers.push(ws);
  const messages: any[] = [];
  const listeners = new Set<() => void>();
  ws.on("message", (raw) => {
    messages.push(JSON.parse(raw.toString()));
    listeners.forEach((fn) => fn());
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const send = (data: unknown) => ws.send(JSON.stringify(data));
  send({ type: "hello", name });
  const wait = (predicate: (m: any) => boolean, timeout = 5000) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`Message timeout for ${name}`));
      }, timeout);
      const check = () => {
        const i = messages.findIndex(predicate);
        if (i >= 0) {
          const m = messages.splice(i, 1)[0];
          clearTimeout(timer);
          listeners.delete(check);
          resolve(m);
        }
      };
      listeners.add(check);
      check();
    });
  return { ws, send, wait, messages };
}
const pause = () => new Promise((r) => setTimeout(r, 130));
test("matchmaking, authoritative turns, synchronized shots and disconnect cleanup", async () => {
  const a = await peer("Анна"),
    b = await peer("Борис");
  a.send({ type: "queue" });
  await a.wait((m) => m.type === "waiting");
  b.send({ type: "queue" });
  const sa = await a.wait((m) => m.type === "state"),
    sb = await b.wait((m) => m.type === "state");
  assert.equal(sa.yourIndex, 0);
  assert.equal(sb.yourIndex, 1);
  assert.equal(sa.code, sb.code);
  assert.deepEqual(sa.game, sb.game);
  assert.equal(sa.players[0].name, "Анна");
  await pause();
  b.send({ type: "shoot", angle: 0, power: 0.3 });
  await pause();
  assert.equal(
    b.messages.some((m) => m.type === "state" && m.game.moving),
    false,
    "out of turn shot rejected",
  );
  a.send({ type: "shoot", angle: 0, power: 0.15 });
  const moving = await b.wait((m) => m.type === "state" && m.game.moving);
  assert.equal(moving.game.shots, 1);
  const finishedA = await a.wait(
      (m) => m.type === "state" && !m.game.moving && m.game.shots === 1,
      10000,
    ),
    finishedB = await b.wait(
      (m) => m.type === "state" && !m.game.moving && m.game.shots === 1,
      10000,
    );
  assert.deepEqual(finishedA.game, finishedB.game);
  a.ws.close();
  await b.wait((m) => m.type === "opponent_left");
  b.ws.close();
});
test("private room can be joined by code but cannot admit a third player", async () => {
  const a = await peer("Автор"),
    b = await peer("Друг"),
    c = await peer("Третий");
  a.send({ type: "create" });
  const room = await a.wait((m) => m.type === "state");
  assert.match(room.code, /^[A-F0-9]{6}$/);
  assert.equal(room.players.length, 1);
  b.send({ type: "join", code: room.code.toLowerCase() });
  const joined = await b.wait((m) => m.type === "state");
  assert.equal(joined.players.length, 2);
  assert.equal(joined.private, true);
  c.send({ type: "join", code: room.code });
  const err = await c.wait((m) => m.type === "error");
  assert.match(err.message, /занята/);
  await pause();
  a.send({ type: "leave" });
  await b.wait((m) => m.type === "opponent_left");
  await pause();
  c.send({ type: "join", code: room.code });
  await c.wait((m) => m.type === "error");
  a.ws.close();
  b.ws.close();
  c.ws.close();
});
test("queue can be cancelled without leaving a ghost opponent", async () => {
  const a = await peer("Первый"),
    b = await peer("Второй");
  a.send({ type: "queue" });
  await a.wait((m) => m.type === "waiting");
  await pause();
  a.send({ type: "leave" });
  await a.wait((m) => m.type === "left");
  b.send({ type: "queue" });
  await b.wait((m) => m.type === "waiting");
  assert.equal(
    b.messages.some((m) => m.type === "state"),
    false,
  );
  a.ws.close();
  b.ws.close();
});

test("an immediate cancel is honoured even inside the action throttle window", async () => {
  const a = await peer("Быстрый"),
    b = await peer("Следующий"),
    c = await peer("Создатель"),
    d = await peer("Гость");
  // Queue and cancel inside the 100 ms throttle window: the client must not
  // stay in the queue, otherwise the next player meets a ghost opponent.
  a.send({ type: "queue" });
  await a.wait((m) => m.type === "waiting");
  a.send({ type: "leave" });
  await a.wait((m) => m.type === "left");
  b.send({ type: "queue" });
  await b.wait((m) => m.type === "waiting");
  assert.equal(
    b.messages.some((m) => m.type === "state"),
    false,
    "cancelled player was matched anyway",
  );
  assert.equal(
    a.messages.some((m) => m.type === "state"),
    false,
  );
  // Same for a private room abandoned right after it was created.
  c.send({ type: "create" });
  const room = await c.wait((m) => m.type === "state");
  c.send({ type: "leave" });
  await c.wait((m) => m.type === "left");
  d.send({ type: "join", code: room.code });
  const error = await d.wait((m) => m.type === "error");
  assert.match(error.message, /не найдена|занята/i);
  [a, b, c, d].forEach((p) => p.ws.close());
});

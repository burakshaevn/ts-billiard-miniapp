import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
const PORT = 3029;
let server: ChildProcess;
const peers: WebSocket[] = [];
// Wallets live in a throwaway file: one player is seeded nearly broke so the
// "not enough berries" path can be checked without losing matches first.
const walletDir = mkdtempSync(path.join(tmpdir(), "pool-wallets-")),
  walletFile = path.join(walletDir, "wallets.json");
const POOR = "guest:poor12345";
before(async () => {
  writeFileSync(
    walletFile,
    JSON.stringify({ wallets: { [POOR]: 5 }, charges: [] }),
  );
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT), WALLETS_FILE: walletFile },
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
  rmSync(walletDir, { recursive: true, force: true });
});
async function peer(name: string, key?: string) {
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
  send({ type: "hello", name, key });
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
  assert.match(err.message, /занят/);
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
    b.messages.some((m) => m.type === "state" && m.players.length === 2),
    false,
    "the cancelled player was still sitting at the table",
  );
  a.ws.close();
  b.ws.close();
  await pause();
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
    b.messages.some((m) => m.type === "state" && m.players.length === 2),
    false,
    "cancelled player was matched anyway",
  );
  assert.equal(
    a.messages.some((m) => m.type === "state" && m.players.length === 2),
    false,
  );
  // Same for a private room abandoned right after it was created.
  c.send({ type: "create" });
  const room = await c.wait((m) => m.type === "state");
  c.send({ type: "leave" });
  await c.wait((m) => m.type === "left");
  d.send({ type: "join", code: room.code });
  const error = await d.wait((m) => m.type === "error");
  assert.match(error.message, /не найден|занят/i);
  [a, b, c, d].forEach((p) => p.ws.close());
});

test("an open table is listed with its stake until someone sits down", async () => {
  const host = await peer("Хозяин", "guest:hostaaaa"),
    guest = await peer("Гость", "guest:guestbbb"),
    watcher = await peer("Зритель", "guest:watcherc");
  host.send({ type: "queue", stake: 25 });
  await host.wait((m) => m.type === "waiting");
  // Everyone in the lobby sees the table and the stake it is played for.
  const listed = await watcher.wait(
    (m) =>
      m.type === "tables" && m.tables.some((t: any) => t.host === "Хозяин"),
  );
  const table = listed.tables.find((t: any) => t.host === "Хозяин");
  assert.equal(table.stake, 25);
  assert.match(table.code, /^[A-F0-9]{6}$/);
  await pause();
  // Sitting down takes the stake from both wallets into the pot.
  guest.send({ type: "join", code: table.code });
  const sa = await host.wait(
      (m) => m.type === "state" && m.players.length === 2,
    ),
    sb = await guest.wait((m) => m.type === "state" && m.players.length === 2);
  assert.equal(sa.stake, 25);
  assert.equal(sa.pot, 50);
  assert.equal(sb.private, false, "a quick game table is public");
  const hostWallet = await host.wait(
      (m) => m.type === "wallet" && m.balance === 125,
    ),
    guestWallet = await guest.wait(
      (m) => m.type === "wallet" && m.balance === 125,
    );
  assert.equal(hostWallet.balance, 125);
  assert.equal(guestWallet.balance, 125);
  // A busy table is no longer offered to anyone else.
  const cleared = await watcher.wait(
    (m) =>
      m.type === "tables" && !m.tables.some((t: any) => t.host === "Хозяин"),
  );
  assert.equal(cleared.tables.length, 0);
  // Walking out of a staked game hands the whole pot to who stayed.
  await pause();
  host.send({ type: "leave" });
  await guest.wait((m) => m.type === "opponent_left");
  const paid = await guest.wait(
    (m) => m.type === "wallet" && m.balance === 175,
  );
  assert.equal(paid.balance, 175, "the winner takes both stakes");
  [host, guest, watcher].forEach((p) => p.ws.close());
});

test("a quick game only matches tables with the same stake", async () => {
  const cheap = await peer("Дешёвый", "guest:cheap111"),
    rich = await peer("Богатый", "guest:rich2222"),
    rival = await peer("Соперник", "guest:rival333");
  cheap.send({ type: "queue", stake: 10 });
  await cheap.wait((m) => m.type === "waiting");
  await pause();
  rich.send({ type: "queue", stake: 50 });
  await rich.wait((m) => m.type === "waiting");
  assert.equal(
    cheap.messages.some((m) => m.type === "state" && m.players.length === 2),
    false,
    "a 10 berry player must not be dropped into a 50 berry match",
  );
  await pause();
  rival.send({ type: "queue", stake: 50 });
  const match = await rich.wait(
    (m) => m.type === "state" && m.players.length === 2,
  );
  assert.equal(match.stake, 50);
  assert.equal(match.pot, 100);
  assert.equal(
    cheap.messages.some((m) => m.type === "state" && m.players.length === 2),
    false,
  );
  [cheap, rich, rival].forEach((p) => p.ws.close());
});

test("a stake nobody can pay is refused, a free table is not", async () => {
  const broke = await peer("Бедолага", POOR);
  const wallet = await broke.wait(
    (m) => m.type === "wallet" && m.balance === 5,
  );
  assert.equal(wallet.balance, 5, "the seeded balance survives a reconnect");
  broke.send({ type: "queue", stake: 50 });
  const error = await broke.wait((m) => m.type === "error");
  assert.match(error.message, /Не хватает ягодок/);
  await pause();
  // A made up stake is not accepted either: it falls back to a free table.
  broke.send({ type: "queue", stake: 37 });
  const table = await broke.wait((m) => m.type === "state");
  await broke.wait((m) => m.type === "waiting");
  assert.equal(table.stake, 0, "an arbitrary stake must never reach a room");
  assert.equal(table.pot, 0, "an empty table holds nothing");
  broke.ws.close();
});

test("berries can only be bought when the server has a bot token", async () => {
  const buyer = await peer("Покупатель", "guest:buyer111");
  buyer.send({ type: "topup", pack: "berries-350" });
  const answer = await buyer.wait((m) => m.type === "topup_unavailable");
  assert.match(answer.reason, /звёздами|бот/i);
  await pause();
  // An unknown pack is ignored instead of crediting anything.
  buyer.send({ type: "topup", pack: "berries-999999" });
  await pause();
  assert.equal(
    buyer.messages.some(
      (m) =>
        m.type === "wallet" && m.balance !== 150 && m.balance !== undefined,
    ),
    false,
    "nothing is credited without a payment",
  );
  buyer.ws.close();
});

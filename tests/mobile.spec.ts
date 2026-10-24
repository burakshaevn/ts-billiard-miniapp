import { test, expect } from "@playwright/test";
import { pullCue, swingCue } from "./gesture";

// Phone-sized viewport: the app must render the compact Mini App layout —
// a short menu and then nothing but the table and the shot controls.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const fits = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <= innerWidth &&
      document.documentElement.scrollHeight <= innerHeight + 1,
  );

test("mini app on a phone: menu, practice table, online match", async ({
  page: a,
  context,
}) => {
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto("/");
  await expect(
    a.getByRole("heading", { name: "Пул «Восьмёрка»" }),
  ).toBeVisible();
  await expect(a.getByText("в клубе")).toBeVisible();
  // The club page furniture must not be part of the Mini App layout.
  await expect(a.locator(".sidebar")).toHaveCount(0);
  await expect(a.locator(".match-panel")).toHaveCount(0);
  expect(await fits(a)).toBe(true);

  await a.getByRole("button", { name: /Тренировка/ }).click();
  await expect(a.locator(".mini-stage canvas")).toBeVisible();
  expect(await fits(a)).toBe(true);
  // A portrait phone shows the table sideways: the frame is turned 90°, so the
  // canvas itself is wide and fills the screen.
  await expect(a.locator(".mini-app-game")).toHaveClass(/is-rotated/);
  const canvas = await a.evaluate(() => {
    const c = document.querySelector(".mini-stage canvas") as HTMLCanvasElement;
    return { w: c.clientWidth, h: c.clientHeight };
  });
  expect(canvas.w).toBeGreaterThan(canvas.h * 1.5);
  expect(canvas.w).toBeGreaterThan(800);
  // No shot button and no power slider: a second cue beside the table is
  // the only shot control, and the chrome stays clear of the top corners,
  // where Telegram floats its own buttons.
  await expect(a.getByRole("button", { name: "Удар" })).toHaveCount(0);
  await expect(a.locator('input[type="range"]')).toHaveCount(0);
  await expect(a.locator(".mini-cue")).toBeVisible();
  const chrome = await a.locator(".mini-bar").boundingBox();
  expect(chrome!.x).toBeLessThan(60);
  expect(chrome!.y).toBe(0);
  await a.getByRole("button", { name: "Назад в меню" }).click();
  await expect(
    a.getByRole("heading", { name: "Пул «Восьмёрка»" }),
  ).toBeVisible();

  await a.getByRole("button", { name: /Играть онлайн/ }).click();
  await expect(a.getByText("Ищем соперника")).toBeVisible();
  const b = await context.newPage();
  b.on("pageerror", (e) => errors.push(e.message));
  await b.goto("/");
  await b.getByRole("button", { name: /Играть онлайн/ }).click();
  await expect(a.locator(".mini-stage canvas")).toBeVisible();
  await expect(b.locator(".mini-stage canvas")).toBeVisible();
  await expect(a.getByText("Твой ход")).toBeVisible();
  await expect(b.getByText(/Ход: /)).toBeVisible();
  expect(await fits(a)).toBe(true);

  await pullCue(a, 45);
  await expect(b.getByText("Шары в движении")).toBeVisible();
  await b.close();
  await expect(
    a.getByRole("heading", { name: "Пул «Восьмёрка»" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("practice-only build: no server, no failed connections, balls come to rest", async ({
  page,
}) => {
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (ws) => sockets.push(ws.url()));
  // `?server=off` reproduces a static deployment without a game server.
  await page.goto("/?server=off");
  await expect(page.getByText("Онлайн позже")).toBeVisible();
  await expect(page.getByText("скоро").first()).toBeVisible();
  await page.getByRole("button", { name: /Играть онлайн/ }).click();
  await expect(
    page.getByText("Онлайн подключим позже — сейчас работает тренировка."),
  ).toBeVisible();

  await page.getByRole("button", { name: /Тренировка/ }).click();
  await expect(page.locator(".mini-stage canvas")).toBeVisible();
  // Dragging the cloth only turns the cue, it never fires a shot.
  await swingCue(page);
  await expect(page.getByText("Шары в движении")).toHaveCount(0);
  // Straight down on the cloth by default; the raking view is one tap away.
  await expect(page.getByRole("button", { name: "Вид сбоку" })).toBeVisible();
  await page.getByRole("button", { name: "Вид сбоку" }).click();
  await page.getByRole("button", { name: "Вид сверху" }).click();
  await expect(page.getByRole("button", { name: "Вид сбоку" })).toBeVisible();
  // The scoreboard counts every ball still on the table, with no captions.
  await expect(page.locator(".mini-score .mini-dots i")).toHaveCount(15);
  // Pulling the side cue back charges the power, releasing it shoots.
  await pullCue(page, 80);
  await expect(page.getByText("Шары в движении")).toBeVisible();
  // A shot has to settle on its own; software rendering here is slow.
  await expect(page.getByText("Шары в движении")).toHaveCount(0, {
    timeout: 60000,
  });
  // Vite's own HMR socket is expected; the game socket must never be opened.
  expect(sockets.filter((url) => url.endsWith("/ws"))).toEqual([]);
  expect(errors).toEqual([]);
  await page.goto("/?server=auto");
});

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
  await expect(a.getByRole("heading", { name: "Amazing Pool" })).toBeVisible();
  await expect(a.getByText(/\d+ онлайн/)).toBeVisible();
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
  await expect(a.getByRole("heading", { name: "Amazing Pool" })).toBeVisible();

  // Online means: pick a stake, then open a table or sit at someone else's.
  await a.getByRole("button", { name: /Играть онлайн/ }).click();
  await expect(a.getByRole("heading", { name: /Выбери стол/ })).toBeVisible();
  await expect(
    a.getByText("Свободных столов нет", { exact: false }),
  ).toBeVisible();
  await a.getByRole("button", { name: "25 ягодок", exact: true }).click();
  await a.getByRole("button", { name: /Открыть свой стол/ }).click();
  await expect(a.getByText("Ищем соперника")).toBeVisible();
  await expect(a.locator(".mini-stake-note")).toHaveText(/Ставка стола\s*25/);
  const b = await context.newPage();
  b.on("pageerror", (e) => errors.push(e.message));
  // A second wallet: both tabs share localStorage, one key would be one purse.
  // A fresh key every run, so a rerun always starts from the welcome balance.
  await b.addInitScript(() =>
    localStorage.setItem(
      "amazing-pool-player",
      "guest:" + crypto.randomUUID().slice(0, 18),
    ),
  );
  await b.goto("/");
  await b.getByRole("button", { name: /Играть онлайн/ }).click();
  // The open table is listed for everyone, with the stake it is played for.
  const table = b.locator(".table-row");
  await expect(table).toHaveCount(1);
  await expect(table).toContainText("25");
  await expect(table).toContainText("ждёт соперника");
  await table.click();
  await expect(a.locator(".mini-stage canvas")).toBeVisible();
  // Both wallets paid the stake: 150 - 25 berries left in each.
  await expect(a.locator(".mini-stake")).toHaveText("25");
  await expect(b.locator(".mini-stake")).toHaveText("25");
  await expect(b.locator(".mini-stage canvas")).toBeVisible();
  await expect(a.getByText("Твой ход")).toBeVisible();
  await expect(b.getByText(/Ход: /)).toBeVisible();
  expect(await fits(a)).toBe(true);

  await pullCue(a, 45);
  await expect(b.getByText("Шары в движении")).toBeVisible();
  await b.close();
  await expect(a.getByRole("heading", { name: "Amazing Pool" })).toBeVisible();
  // Walking out of a staked game hands the pot over: 125 + 50 berries.
  await expect(a.locator(".mini-balance strong")).toHaveText("175");
  await a.getByRole("button", { name: /Кошелёк/ }).click();
  await expect(a.getByRole("heading", { name: /175 ягодок/ })).toBeVisible();
  await expect(a.getByText("350")).toBeVisible();
  await a.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("a bot takes the empty seat, so there is always someone to play", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Its own wallet, so the berries of the other tests are not involved.
  await page.addInitScript(() =>
    localStorage.setItem(
      "amazing-pool-player",
      "guest:" + crypto.randomUUID().slice(0, 18),
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Играть онлайн/ }).click();
  await page.getByRole("button", { name: /Сыграть с ботом/ }).click();
  // Straight to the table: no waiting, no empty lobby.
  await expect(page.locator(".mini-stage canvas")).toBeVisible();
  // The opponent is openly a bot: machine face over the table, real name.
  await expect(page.locator(".mini-score .avatar.is-bot")).toHaveCount(1);
  const opponent = page.locator(".mini-team-name").nth(1);
  await expect(opponent).not.toBeEmpty();
  await expect(page.getByText("Твой ход")).toBeVisible();
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
  // Without a server there is still a game: the bot match runs in the browser.
  await page.getByRole("button", { name: /Игра с ботом/ }).click();
  await expect(page.locator(".mini-stage canvas")).toBeVisible();
  await expect(page.locator(".mini-score .avatar.is-bot")).toHaveCount(1);
  await expect(page.getByText("Твой ход")).toBeVisible();
  await page.getByRole("button", { name: "Назад в меню" }).click();
  await expect(
    page.getByRole("heading", { name: "Amazing Pool" }),
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
  await expect(page.locator(".mini-score .mini-ball")).toHaveCount(15);
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

test("telegram photos of both players sit over the table", async ({
  page: a,
  context,
}) => {
  // A 1x1 PNG stands in for the Telegram CDN, which is unreachable from CI.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await context.route("https://cdn.telegram.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  const mock = ([n, p, id]: string[]) => {
    window.Telegram = {
      WebApp: {
        ready: () => {},
        expand: () => {},
        isVersionAtLeast: () => true,
        initDataUnsafe: {
          user: {
            id: Number(id),
            first_name: n,
            photo_url: p || undefined,
          },
        },
        viewportStableHeight: 800,
        contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        BackButton: {
          show: () => {},
          hide: () => {},
          onClick: () => {},
          offClick: () => {},
        },
      },
    };
  };

  await a.addInitScript(mock, [
    "Лена",
    "https://cdn.telegram.test/lena.png",
    "7001",
  ]);
  const b = await context.newPage();
  // The second player has no photo: the name letter has to stand in for it.
  await b.addInitScript(mock, ["Игорь", "", "7002"]);
  await a.goto("/");
  await b.goto("/");
  await a.getByRole("button", { name: /Играть онлайн/ }).click();
  await a.getByRole("button", { name: /Открыть свой стол/ }).click();
  await b.getByRole("button", { name: /Играть онлайн/ }).click();
  await b.locator(".table-row").click();
  await expect(a.locator(".mini-stage canvas")).toBeVisible();

  // Both names are over the table, so it is clear who is playing whom.
  await expect(a.locator(".mini-team-name")).toHaveText(["Лена", "Игорь"]);
  await expect(b.locator(".mini-team-name")).toHaveText(["Игорь", "Лена"]);
  // Lena's photo travels to her opponent's screen; Igor falls back to "И".
  await expect(a.locator(".mini-avatar img")).toHaveCount(1);
  await expect(b.locator(".mini-avatar img")).toHaveCount(1);
  await expect(
    b.locator(".mini-team.is-right .mini-avatar img"),
  ).toHaveAttribute("src", "https://cdn.telegram.test/lena.png");
  await expect(a.locator(".mini-team.is-right .mini-avatar")).toHaveText("И");
  await b.close();
});

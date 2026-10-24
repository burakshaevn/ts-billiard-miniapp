import { test, expect } from "@playwright/test";

test("desktop: training, online match, expanded table and private invitation", async ({
  page: a,
  context,
}) => {
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto("/");
  await expect(a.getByText("Сервер готов. Можно играть.")).toBeVisible();
  await a.getByRole("button", { name: "Как играть" }).click();
  await expect(a.getByRole("dialog")).toBeVisible();
  await a.keyboard.press("Escape");
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await a.getByRole("button", { name: "Найти соперника" }).click();
  await expect(
    a.getByRole("heading", { name: "Ищем соперника", exact: true }),
  ).toBeVisible();
  const b = await context.newPage();
  b.on("pageerror", (e) => errors.push(e.message));
  await b.goto("/");
  await expect(b.getByText("Сервер готов. Можно играть.")).toBeVisible();
  await b.getByRole("button", { name: "Найти соперника" }).click();
  // Both players, with their portraits, stand above the table once matched.
  await expect(a.locator(".versus-side")).toHaveCount(2);
  await expect(b.locator(".versus-side")).toHaveCount(2);
  await expect(a.locator(".versus-mark")).toHaveText("VS");
  await expect(a.locator(".versus-side.is-turn .avatar")).toHaveCount(1);
  await expect(
    a.getByRole("button", { name: "Ударить", exact: true }),
  ).toBeEnabled();
  await expect(
    b.getByRole("button", { name: "Ударить", exact: true }),
  ).toBeDisabled();
  await a.getByRole("slider").fill("15");
  await a.getByRole("button", { name: "Ударить", exact: true }).click();
  await expect(b.getByText("Шары в движении", { exact: true })).toBeVisible();
  await b.getByRole("button", { name: "Как играть" }).click();
  await b.waitForTimeout(500);
  await expect(b.getByRole("dialog")).toBeVisible();
  await b.keyboard.press("Escape");
  await b.close();
  // Alone at the table again: one player, no VS.
  await expect(a.locator(".versus-side")).toHaveCount(1);
  await expect(a.locator(".mode-tag")).toHaveText("ТРЕНИРОВКА");
  await a.getByRole("button", { name: "Развернуть стол", exact: true }).click();
  await expect(a.locator(".table-card")).toHaveClass(/is-expanded/);
  await a.getByRole("button", { name: "Свернуть стол", exact: true }).click();
  await a
    .getByRole("button", { name: "Пригласить друга", exact: true })
    .last()
    .click();
  await expect(a.getByRole("dialog")).toBeVisible();
  await a.getByRole("button", { name: "Создать свой стол" }).click();
  await expect(a.getByText("Ждём твоего друга", { exact: true })).toBeVisible();
  await expect(a.locator(".room-code")).toHaveText(/^[A-F0-9]{6}$/);
  await a.getByRole("button", { name: "Вернуться к тренировке" }).click();
  await expect(a.locator(".versus-side")).toHaveCount(1);
  await expect(a.locator(".mode-tag")).toHaveText("ТРЕНИРОВКА");
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
  expect(errors).toEqual([]);
});

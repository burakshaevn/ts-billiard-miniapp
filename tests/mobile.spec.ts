import { test, expect } from "@playwright/test";

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
  await expect(a.getByRole("button", { name: "Удар" })).toBeEnabled();
  expect(await fits(a)).toBe(true);
  const stage = await a.locator(".mini-stage").boundingBox();
  // The table has to own most of the screen on the game screen.
  expect(stage!.height).toBeGreaterThan(560);
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
  await expect(a.getByRole("button", { name: "Удар" })).toBeEnabled();
  await expect(b.getByRole("button", { name: "Удар" })).toBeDisabled();
  expect(await fits(a)).toBe(true);

  await a.getByRole("slider").fill("15");
  await a.getByRole("button", { name: "Удар" }).click();
  await expect(b.getByText("Шары в движении")).toBeVisible();
  await b.close();
  await expect(
    a.getByRole("heading", { name: "Пул «Восьмёрка»" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

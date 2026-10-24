import { test, expect } from "@playwright/test";

test("Telegram SDK bridge: ready, expand, safe area, back button and swipe guard (mock, not a real device)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { tgCalls: string[] }).tgCalls = calls;
    let back: (() => void) | null = null;
    (window as unknown as { tgBack: () => void }).tgBack = () => back?.();
    window.Telegram = {
      WebApp: {
        ready: () => {
          calls.push("ready");
        },
        expand: () => {
          calls.push("expand");
        },
        isVersionAtLeast: () => true,
        initDataUnsafe: { user: { first_name: "Лена" } },
        viewportStableHeight: 800,
        contentSafeAreaInset: { top: 12, bottom: 10, left: 0, right: 0 },
        disableVerticalSwipes: () => {
          calls.push("swipes-off");
        },
        enableVerticalSwipes: () => {
          calls.push("swipes-on");
        },
        enableClosingConfirmation: () => {
          calls.push("confirm-on");
        },
        disableClosingConfirmation: () => {
          calls.push("confirm-off");
        },
        BackButton: {
          show: () => {
            calls.push("back-show");
          },
          hide: () => {
            calls.push("back-hide");
          },
          onClick: (cb: () => void) => {
            back = cb;
          },
          offClick: () => {
            back = null;
          },
        },
      },
    };
  });
  await page.goto("/");
  // Telegram clients always get the compact layout, never the club page.
  await expect(
    page.getByRole("heading", { name: "Пул «Восьмёрка»" }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Лена" })).toBeVisible();
  const calls = () =>
    page.evaluate(() => (window as unknown as { tgCalls: string[] }).tgCalls);
  expect(await calls()).toEqual(expect.arrayContaining(["ready", "expand"]));
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--app-safe-top",
      ),
    ),
  ).toBe("12px");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".mini-app")!).height,
    ),
  ).toBe("800px");

  await page.getByRole("button", { name: /Тренировка/ }).click();
  await expect(page.locator(".mini-stage canvas")).toBeVisible();
  await expect
    .poll(async () =>
      (await calls()).filter((v) => v.startsWith("swipes")).at(-1),
    )
    .toBe("swipes-off");
  expect(await calls()).toContain("back-show");

  // Telegram's own back button returns to the menu instead of closing the app.
  await page.evaluate(() =>
    (window as unknown as { tgBack: () => void }).tgBack(),
  );
  await expect(
    page.getByRole("heading", { name: "Пул «Восьмёрка»" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await calls()).filter((v) => v.startsWith("swipes")).at(-1),
    )
    .toBe("swipes-on");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

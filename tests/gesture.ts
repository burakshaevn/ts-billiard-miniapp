import { expect, type Page } from "@playwright/test";

/** Where the cue grip and the cue ball are on screen, in client pixels. */
async function cue(page: Page) {
  const canvas = page.locator(".mini-stage canvas, .table-canvas canvas");
  await expect(canvas).toHaveAttribute("data-grip", /\d/, { timeout: 15000 });
  const [gx, gy, bx, by] = (await canvas.getAttribute("data-grip"))!
    .split(",")
    .map(Number);
  const length = Math.hypot(gx - bx, gy - by) || 1;
  return { gx, gy, bx, by, ux: (gx - bx) / length, uy: (gy - by) / length };
}

/** Swing the cue around the ball by dragging the cloth, without shooting. */
export async function swingCue(page: Page) {
  const { gx, gy, ux, uy } = await cue(page);
  const start = { x: gx - uy * 95, y: gy + ux * 95 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(
    start.x - uy * 45 - ux * 25,
    start.y + ux * 45 - uy * 25,
    { steps: 8 },
  );
  await page.mouse.up();
}

/**
 * Play a shot with the cue drawn beside the table: grab it, pull it back by
 * `pixels` and let go. In the rotated phone frame "back" is a drag towards
 * the physical left edge.
 */
export async function pullCue(page: Page, pixels = 120) {
  const control = page.locator(".mini-cue");
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  const rotated = await page
    .locator(".mini-app-game")
    .evaluate((el) => el.classList.contains("is-rotated"));
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const step of [0.4, 0.75, 1]) {
    const travel = pixels * step;
    await page.mouse.move(rotated ? x - travel : x, rotated ? y : y + travel, {
      steps: 4,
    });
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
}

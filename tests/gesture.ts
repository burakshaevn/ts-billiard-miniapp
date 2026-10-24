import { expect, type Page } from "@playwright/test";

/** Where the cue grip and the cue ball are on screen, in client pixels. */
async function cue(page: Page) {
  const canvas = page.locator(".mini-stage canvas, .table-canvas canvas");
  await expect(canvas).toHaveAttribute("data-grip", /\d/, { timeout: 15000 });
  const [gx, gy, bx, by] = (await canvas.getAttribute("data-grip"))!
    .split(",")
    .map(Number);
  const length = Math.hypot(gx - bx, gy - by) || 1;
  return { gx, gy, ux: (gx - bx) / length, uy: (gy - by) / length };
}

/**
 * Play a shot the way a player does: grab the cue behind the ball, pull it
 * back and let go. `pixels` is the backswing on screen, which sets the power.
 */
export async function pullCue(page: Page, pixels = 110) {
  const { gx, gy, ux, uy } = await cue(page);
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  for (const step of [0.4, 0.75, 1]) {
    await page.mouse.move(gx + ux * pixels * step, gy + uy * pixels * step, {
      steps: 4,
    });
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
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

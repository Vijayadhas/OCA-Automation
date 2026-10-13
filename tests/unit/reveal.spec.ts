import { test, expect } from '@playwright/test';
import { revealForViewer } from '../../src/core/interactions';

test('scrolls a selection into view and outlines it briefly', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.setContent('<div style="height: 3000px"></div><table><tr id="row" style="outline: 1px dotted blue"><td>P47781-B21</td></tr></table>');
  await expect(page.locator('#row')).not.toBeInViewport();
  await revealForViewer(page.locator('#row'));
  await expect(page.locator('#row')).toBeInViewport();
  expect(await page.locator('#row').evaluate((row) => (row as HTMLElement).style.outline)).toContain('solid');
  await expect.poll(() => page.locator('#row').evaluate((row) => (row as HTMLElement).style.outline), { timeout: 5_000 })
    .toContain('dotted');
});

test('never fails the run for a hidden or missing element', async ({ page }) => {
  await page.setContent('<div id="hidden" style="display:none">x</div>');
  await revealForViewer(page.locator('#hidden'));
  await revealForViewer(page.locator('#missing'));
});

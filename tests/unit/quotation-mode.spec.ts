import { test, expect } from '@playwright/test';
import { readLandingMode, selectAasMode } from '../../src/automation/quotation-mode';

const toggle = (onAasClick: string) => `
  <div class="mode-toggle">
    <span id="buy" class="mode active">Buy</span>
    <span id="aas" class="mode" onclick="${onAasClick}">aaS</span>
  </div>
  <input id="search-config" placeholder="Search config">`;

test('clicks the landing aaS option and confirms Buy is no longer selected', async ({ page }) => {
  await page.setContent(toggle("document.getElementById('buy').classList.remove('active'); this.classList.add('active')"));
  expect(await readLandingMode(page)).toMatchObject({ aasSelected: false, buySelected: true });

  await selectAasMode(page, { landingWaitMs: 5_000, aasAppearMs: 500 });

  const state = await readLandingMode(page);
  expect(state).toMatchObject({ aasSelected: true, buySelected: false });
  expect(state.controls.some((control) => control.startsWith('*aaS: span#aas.mode.active'))).toBe(true);
});

test('leaves an already selected aaS option unchanged', async ({ page }) => {
  await page.setContent(`<span id="buy" class="mode">Buy</span><span id="aas" class="mode selected"
    onclick="window.clicks = (window.clicks || 0) + 1">aaS</span><input id="search-config">`);
  await selectAasMode(page, { landingWaitMs: 5_000, aasAppearMs: 500 });
  expect(await page.evaluate(() => (window as unknown as { clicks?: number }).clicks ?? 0)).toBe(0);
});

test('falls back to New Configuration > aaS when the landing page has no aaS option', async ({ page }) => {
  await page.setContent(`
    <ul><li id="header_new_config_label">New Configuration<ul style="display:none">
      <li id="header_new_config">Buy</li>
      <li id="header_greenlake" title="Create aaS Configuration" onclick="window.mode = 'aaS'">aaS</li>
    </ul></li></ul>
    <input id="search-config" placeholder="Search config">`);
  await selectAasMode(page, { landingWaitMs: 5_000, aasAppearMs: 500 });
  expect(await page.evaluate(() => (window as unknown as { mode?: string }).mode)).toBe('aaS');
});

test('fails before the model search when Buy stays selected', async ({ page }) => {
  await page.setContent(toggle(''));
  await expect(selectAasMode(page, { landingWaitMs: 5_000, aasAppearMs: 500 }))
    .rejects.toThrow(/aaS could not be selected; Buy is still selected after 3 attempts/);
});

test('fails clearly when no aaS option exists anywhere', async ({ page }) => {
  await page.setContent('<input id="search-config" placeholder="Search config">');
  await expect(selectAasMode(page, { landingWaitMs: 5_000, aasAppearMs: 500 }))
    .rejects.toThrow(/aaS option was not found on the landing page or in the New Configuration menu/);
});

import { expect, type Page } from '@playwright/test';
import { waitForBlockingOverlay } from '../core/waits';
import { OcaPageLoadError } from './configuration-errors';

export interface LandingModeState {
  aasSelected: boolean;
  buySelected: boolean;
  /** Visible aaS/Buy controls, `*` marking a selected one, with two ancestors for diagnosis. */
  controls: string[];
}

export interface AasSelectionOptions {
  /** How long to wait for the authenticated landing page (manual sign-in included). */
  landingWaitMs: number;
  /** Extra time for the aaS option to render once the search box is already visible. */
  aasAppearMs?: number;
  /** Shortest landing wait (default 60 s); tests shorten it. */
  landingMinimumMs?: number;
}

const searchBox = (page: Page) => page.getByRole('textbox', { name: /Search to open UCID or create|Search config/i })
  .or(page.locator('#search-config')).first();

/**
 * Reads which landing-page mode control looks selected. Ported from the proven legacy
 * test: a visible control whose text, aria-label, or value is exactly aaS/Buy counts
 * as selected when it or one of four ancestors is active/selected/checked.
 * No named inner functions: the module runs under tsx, whose name helpers do not
 * exist inside the browser.
 */
export async function readLandingMode(page: Page): Promise<LandingModeState> {
  return page.evaluate(() => {
    const state = { aasSelected: false, buySelected: false, controls: [] as string[] };
    const elements = Array.from(document.querySelectorAll<HTMLElement>('button, a, li, label, span, div, input[type="radio"]'));
    for (const element of elements) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') <= 0.01
        || rect.width <= 0 || rect.height <= 0) continue;
      const texts = [element.textContent, element.getAttribute('aria-label'), element instanceof HTMLInputElement ? element.value : '']
        .map((value) => (value ?? '').replace(/\s+/g, ' ').trim());
      const mode = texts.some((value) => /^aaS$/i.test(value)) ? 'aaS' : texts.some((value) => /^Buy$/i.test(value)) ? 'Buy' : '';
      if (!mode) continue;
      let selected = false;
      const path: string[] = [];
      let current: HTMLElement | null = element;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        const className = typeof current.className === 'string' ? current.className.trim() : '';
        if (depth < 3) path.push(`${current.tagName.toLowerCase()}${current.id ? `#${current.id}` : ''}${className ? `.${className.split(/\s+/).join('.')}` : ''}`);
        if (/(^|\s)(active|selected|current|checked|highlight)(\s|$)/i.test(className)
          || current.getAttribute('aria-selected') === 'true' || current.getAttribute('aria-checked') === 'true'
          || /selected|active|checked/i.test(current.getAttribute('data-state') ?? '')
          || (current instanceof HTMLInputElement && current.checked)) selected = true;
      }
      if (mode === 'aaS') state.aasSelected ||= selected; else state.buySelected ||= selected;
      if (state.controls.length < 10) state.controls.push(`${selected ? '*' : ''}${mode}: ${path.join(' < ')}`);
    }
    return state;
  });
}

const describe = (state: LandingModeState) =>
  `aaS selected=${state.aasSelected}, Buy selected=${state.buySelected}; controls: ${state.controls.join(' | ') || '<none visible>'}`;

/**
 * Selects aaS before any model search. Buy is OCA's default, so this step is
 * mandatory: it clicks the landing-page aaS option (or, when the landing page has
 * none, New Configuration > aaS in the header), and fails here rather than letting
 * the model open in Buy mode.
 */
/**
 * selectAasMode, reloading OCA once when it stays on its "Loading..." screen (P72176-B21,
 * 2026-10-16: the landing page never loaded after sign-in). Nothing is configured yet, so a
 * reload is not a model retry.
 */
export async function selectAasModeWithReload(page: Page, options: AasSelectionOptions): Promise<void> {
  try {
    await selectAasMode(page, options);
  } catch (error) {
    if (!(error instanceof OcaPageLoadError)) throw error;
    console.log(`[WARN] ${error.message}; reloading OCA once (nothing is configured yet)`);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForBlockingOverlay(page);
    await selectAasMode(page, options);
  }
}

export async function selectAasMode(page: Page, options: AasSelectionOptions): Promise<void> {
  const search = searchBox(page);
  const landingAas = page.locator('button, a, li, label, span, div')
    .filter({ hasText: /^\s*aaS\s*$/i }).filter({ visible: true }).first();
  const headerAas = page.locator('#header_greenlake').first();
  const headerMenu = page.locator('#header_new_config_label').first();

  const landingWaitMs = Math.max(options.landingWaitMs, options.landingMinimumMs ?? 60_000);
  try {
    await expect.poll(async () => await landingAas.isVisible().catch(() => false) || await search.isVisible().catch(() => false), {
      timeout: landingWaitMs, message: 'Authenticated OCA landing page (aaS option or search box)',
    }).toBe(true);
  } catch (error) {
    // S3V83A: OCA's own "Loading..." block (.blockUI.blockMsg .maui-loading-label) stayed over an
    // empty page for the whole wait. That is OCA failing to load, not a sign-in prompt; reopening helps.
    if (await page.locator('.blockUI.blockMsg .maui-loading-label').filter({ visible: true }).first().isVisible().catch(() => false)) {
      throw new OcaPageLoadError(`OCA stayed on its "Loading..." screen for ${Math.round(landingWaitMs / 1000)} s; the landing page did not load`);
    }
    throw error;
  }
  if (!await landingAas.isVisible().catch(() => false)) {
    // The search box can render before the mode toggle; give the toggle a moment.
    await landingAas.waitFor({ state: 'visible', timeout: options.aasAppearMs ?? 20_000 }).catch(() => undefined);
  }

  let state = await readLandingMode(page);
  console.log(`[INFO] Landing mode before selection: ${describe(state)}`);
  if (state.aasSelected && !state.buySelected) {
    console.log('[STEP] aaS is already selected on the landing page');
  } else {
    let selected = false;
    for (let attempt = 1; attempt <= 3 && !selected; attempt += 1) {
      if (await landingAas.isVisible().catch(() => false)) {
        console.log(`[STEP] Selecting aaS on the landing page (attempt ${attempt}/3)`);
        await landingAas.scrollIntoViewIfNeeded().catch(() => undefined);
        await landingAas.click({ timeout: 10_000 }).catch(() => landingAas.click({ force: true, timeout: 10_000 }));
      } else if (await headerAas.count()) {
        console.log(`[STEP] Landing page has no aaS option; selecting New Configuration > aaS (attempt ${attempt}/3)`);
        await headerMenu.hover({ timeout: 5_000 }).catch(() => undefined);
        if (await headerAas.isVisible().catch(() => false)) await headerAas.click({ timeout: 10_000 });
        else await headerAas.evaluate((element) => (element as HTMLElement).click());
      } else {
        throw new Error(`aaS option was not found on the landing page or in the New Configuration menu. ${describe(state)}`);
      }
      await page.waitForTimeout(1_000);
      await waitForBlockingOverlay(page);
      state = await readLandingMode(page);
      console.log(`[INFO] Landing mode after aaS click: ${describe(state)}`);
      // Some OCA builds expose no selected state; Quotation Mode is verified again after Customize.
      selected = !state.buySelected;
    }
    if (!selected) throw new Error(`aaS could not be selected; Buy is still selected after 3 attempts. ${describe(state)}`);
  }
  await expect(search, 'aaS search landing page').toBeVisible({ timeout: 60_000 });
}

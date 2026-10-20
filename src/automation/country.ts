import { expect, type Locator, type Page } from '@playwright/test';
import { safeClick } from '../core/interactions';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';

/** OCA's landing page country when the Excel gives none (every captured landing page shows it). */
export const DEFAULT_COUNTRY = process.env.OCA_DEFAULT_COUNTRY ?? 'UNITED STATES';

export interface CountryOption { value: string; text: string; group: string }

const clean = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The option a requested country means: its exact name ("SAUDI ARABIA", any case), its code ("SA"),
 * else the one name that starts with it ("France" → "FRANCE, METROPOLITAN"). Several or none: null.
 */
export function matchCountry(options: CountryOption[], requested: string): CountryOption | null {
  const wanted = clean(requested);
  const exact = options.find((option) => clean(option.text) === wanted || clean(option.value) === wanted);
  if (exact) return exact;
  const starting = options.filter((option) => clean(option.text).startsWith(wanted));
  return starting.length === 1 ? starting[0] : null;
}

/**
 * The landing page Country (Arcus model in Saudi Arabia, 2026-10-20), as captured on the landing page:
 *   <div id="country"><label for="country-selector">Country</label>
 *     <select id="country-selector" class="selecter-element"><optgroup label="Europe Middle East and Africa">
 *       <option value="SA">SAUDI ARABIA</option>…</optgroup>…</select>
 *     <div class="selecter"><span class="selecter-selected">UNITED STATES</span><div class="selecter-options">
 *       <span class="selecter-group" sgroup="EuropeMiddleEastandAfrica">…</span>
 *       <span class="selecter-item group-item …" title="SAUDI ARABIA" data-value="SA">SAUDI ARABIA</span>…
 * The field is found by its "Country" label. A user opens the dropdown, opens the region, and picks the
 * country; OCA's own select is set when the list does not show it.
 */
export class Country {
  constructor(private readonly page: Page) {}

  private select(): Locator {
    return this.page.locator('label').filter({ hasText: /^\s*Country\s*$/i })
      .locator('xpath=following-sibling::select[1]').first();
  }

  async current(): Promise<CountryOption | null> {
    return this.select().evaluate((select) => {
      const option = (select as HTMLSelectElement).selectedOptions[0];
      if (!option) return null;
      return { value: option.value, text: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
        group: option.parentElement?.getAttribute('label') ?? '' };
    }, undefined, { timeout: 5_000 }).catch(() => null);
  }

  /** Sets the Country (blank: DEFAULT_COUNTRY). Nothing is clicked when it is already set. */
  async apply(requested: string | undefined): Promise<void> {
    const wanted = requested?.trim() || DEFAULT_COUNTRY;
    if (!await this.select().count()) {
      if (requested?.trim()) throw new Error(`The landing page shows no Country field to set ${wanted}`);
      return;
    }
    const options = await this.select().locator('option').evaluateAll((nodes) => nodes.map((node) => ({
      value: (node as HTMLOptionElement).value,
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
      group: node.parentElement?.getAttribute('label') ?? '',
    })));
    const target = matchCountry(options, wanted);
    if (!target) throw new Error(`Country "${wanted}" is not in OCA's Country list (or matches several countries)`);
    const current = await this.current();
    if (current?.value === target.value) {
      if (requested?.trim()) console.log(`[INFO] Country is already ${target.text}`);
      return;
    }
    console.log(`[STEP] Setting Country to ${target.text} (${target.group}); it was ${current?.text ?? 'not set'}`);
    await this.choose(target);
    await expect.poll(async () => (await this.current())?.value, { timeout: 15_000, message: `Country ${target.text}` })
      .toBe(target.value);
    console.log(`[INFO] Country: ${target.text}`);
  }

  private async choose(target: CountryOption): Promise<void> {
    const dropdown = this.select().locator('xpath=following-sibling::div[contains(concat(" ", normalize-space(@class), " "), " selecter ")][1]');
    const item = dropdown.locator(`.selecter-item[data-value=${JSON.stringify(target.value)}]`).first();
    if (await dropdown.isVisible().catch(() => false)) {
      await safeClick(dropdown.locator('.selecter-selected').first());
      // Regions open and close like the recording's "Europe Middle East and Africa" click.
      if (!await item.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const region = dropdown.locator('.selecter-group').filter({ hasText: new RegExp(`^\\s*${escapeRegex(target.group)}\\s*$`, 'i') }).first();
        if (await region.isVisible().catch(() => false)) await safeClick(region);
      }
      if (await item.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await safeClick(item);
        await waitForBlockingOverlay(this.page);
        return;
      }
      console.log(`[WARN] Country list did not show ${target.text}; setting the field directly`);
    }
    await this.select().evaluate((select, value) => {
      const element = select as HTMLSelectElement;
      element.value = value;
      // No named helper functions in browser code: tsx wraps them in __name(), which the page lacks.
      const jquery = (window as unknown as { jQuery?: (target: Element) => { trigger: (event: string) => void } }).jQuery;
      if (jquery) jquery(element).trigger('change'); else element.dispatchEvent(new Event('change', { bubbles: true }));
    }, target.value);
    await waitForBlockingOverlay(this.page);
  }
}

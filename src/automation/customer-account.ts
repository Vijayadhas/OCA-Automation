import { expect, type Locator, type Page } from '@playwright/test';
import { safeClick } from '../core/interactions';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Customer Account in the landing page's Advanced Settings, as captured (2026-10-16):
 *   <span class="input-title">Customer Account</span>
 *   <select id="party_id" class="selecter-element"><option default="">Key in value / Select from list</option>
 *     <option value="014141414" account-name="Nutanix">Nutanix</option>…</select>
 *   <div class="selecter"><span class="selecter-selected">Nutanix</span>
 *     <div class="selecter-options"><span class="selecter-item" data-value="014141414">Nutanix</span>…</div></div>
 * The setting stays in OCA between models, so every model sets it: to its account, or back to
 * the default (no account) when it has none.
 */
export class CustomerAccount {
  constructor(private readonly page: Page) {}

  private select(): Locator {
    return this.page.locator('.input-title').filter({ hasText: /^\s*Customer Account\s*$/i })
      .locator('xpath=following-sibling::select[1]').first();
  }

  /** The account selected now; '' for the default "Key in value / Select from list". */
  async current(): Promise<string> {
    return this.select().evaluate((select) => {
      const option = (select as HTMLSelectElement).selectedOptions[0];
      if (!option || option.hasAttribute('default') || !option.value) return '';
      return (option.getAttribute('account-name') ?? option.textContent ?? '').replace(/\s+/g, ' ').trim();
    }, undefined, { timeout: 5_000 }).catch(() => '');
  }

  /** Sets Customer Account to `account`, or back to the default when `account` is blank. */
  async apply(account: string): Promise<void> {
    const wanted = clean(account);
    const present = await this.select().count() > 0;
    const current = present ? await this.current() : '';
    if (current.toLowerCase() === wanted.toLowerCase()) {
      if (wanted) console.log(`[INFO] Customer Account is already ${wanted}`);
      return;
    }
    // Without the field on the page there is nothing to clear.
    if (!wanted && !present) return;
    console.log(wanted
      ? `[STEP] Setting Customer Account to ${wanted} in Advanced Settings`
      : `[STEP] Clearing Customer Account ${current} in Advanced Settings`);
    await this.openAdvancedSettings();
    await this.choose(wanted);
    await expect.poll(() => this.current(), { timeout: 15_000, message: `Customer Account ${wanted || '(none)'}` })
      .toBe(wanted ? await this.accountName(wanted) : '');
    // Read before closing: the field is not read reliably once Advanced Settings is closed.
    const chosen = await this.current();
    await this.close();
    console.log(`[INFO] Customer Account: ${chosen || 'none'}`);
  }

  private async openAdvancedSettings(): Promise<void> {
    const dropdown = this.select().locator('xpath=following-sibling::div[contains(concat(" ", normalize-space(@class), " "), " selecter ")][1]');
    if (await dropdown.isVisible().catch(() => false)) return;
    const search = this.page.getByRole('textbox', { name: /Search to open UCID or create|Search config/i })
      .or(this.page.locator('#search-config')).first();
    await expect(search, 'Search box that shows Advanced Settings').toBeVisible({ timeout: 60_000 });
    await safeClick(search);
    const advanced = this.page.getByText('Advanced Settings', { exact: true }).filter({ visible: true }).first();
    await expect(advanced, 'Advanced Settings').toBeVisible({ timeout: 30_000 });
    await safeClick(advanced);
    await waitForBlockingOverlay(this.page);
    await expect(dropdown, 'Customer Account field in Advanced Settings').toBeVisible({ timeout: 30_000 });
  }

  /** The account's name as OCA lists it (case as in the list), for the check after choosing. */
  private async accountName(wanted: string): Promise<string> {
    return this.select().evaluate((select, name) => {
      const option = Array.from((select as HTMLSelectElement).options).find((item) =>
        (item.getAttribute('account-name') ?? item.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === name.toLowerCase());
      return option ? (option.getAttribute('account-name') ?? option.textContent ?? '').replace(/\s+/g, ' ').trim() : name;
    }, wanted);
  }

  /**
   * Picks the account in OCA's searchable dropdown, as a user does. On a fresh page the list holds only
   * "Key in value / Select from list" (P72176-B21 run, 2026-10-16): OCA loads accounts as the name is
   * typed into "Type to search...". Setting OCA's own select is the fallback.
   */
  private async choose(wanted: string): Promise<void> {
    const dropdown = this.select().locator('xpath=following-sibling::div[contains(concat(" ", normalize-space(@class), " "), " selecter ")][1]');
    await safeClick(dropdown.locator('.selecter-selected').first());
    if (wanted) {
      const typeToSearch = this.page.getByRole('textbox', { name: 'Type to search...' }).filter({ visible: true }).first();
      if (await typeToSearch.isVisible({ timeout: 10_000 }).catch(() => false)) await typeToSearch.fill(wanted);
      else console.log('[WARN] "Type to search..." did not appear in Customer Account; looking for the account in the list');
    }
    const exact = new RegExp(`^\\s*${escapeRegex(wanted)}\\s*$`, 'i');
    const listed = wanted
      ? dropdown.locator('.selecter-item').filter({ visible: true, hasText: exact }).first()
      : dropdown.locator('.selecter-item').filter({ visible: true }).first();
    // The search can list matches outside the selecter; the landing page's recent-configuration
    // table also shows account names, so table cells do not count.
    const shown = this.page.getByText(exact).and(this.page.locator(':not(table *):not(select *)')).filter({ visible: true }).first();
    let item: Locator | undefined;
    await expect.poll(async () => {
      if (await listed.isVisible().catch(() => false)) item = listed;
      else if (wanted && await shown.isVisible().catch(() => false)) item = shown;
      return Boolean(item);
    }, { timeout: 30_000, intervals: [500] }).toBe(true).catch(() => undefined);
    if (item) {
      await safeClick(item);
    } else {
      // The list did not show the item: set OCA's own select and announce the change as the dropdown does.
      console.log(`[WARN] Customer Account list did not show ${wanted || 'the default entry'}; setting the field directly`);
      const set = await this.select().evaluate((select, name) => {
        const element = select as HTMLSelectElement;
        // No named helper functions in browser code: tsx wraps them in __name(), which the page lacks.
        const option = Array.from(element.options).find((entry) => (name
          ? (entry.getAttribute('account-name') ?? entry.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === name.toLowerCase()
          : entry.hasAttribute('default') || !entry.value));
        if (!option) return false;
        element.value = option.value;
        option.selected = true;
        const jquery = (window as unknown as { jQuery?: (target: Element) => { trigger: (event: string) => void } }).jQuery;
        if (jquery) jquery(element).trigger('change'); else element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, wanted);
      if (!set) throw new Error(`Customer Account "${wanted}" was not found in OCA's Customer Account list`);
    }
    await waitForBlockingOverlay(this.page);
  }

  private async close(): Promise<void> {
    const close = this.page.locator('#close-icon').filter({ visible: true }).first();
    if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) await safeClick(close);
    else await this.page.keyboard.press('Escape').catch(() => undefined);
    await waitForBlockingOverlay(this.page);
  }
}

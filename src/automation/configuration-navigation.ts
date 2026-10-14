import { expect, type Locator, type Page } from '@playwright/test';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';
import type { PageSnapshot } from '../reporting/html-capture';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/** A configuration listed in OCA's navigation tree. */
export interface NavigationEntry { key: string; label: string; description: string }

/**
 * OCA's configuration navigation, as captured on S3V83A:
 * - a breadcrumb of li.eo_nav_li entries ("OCA Config 2 > … #1 Group > … #1"); the open level has class "current";
 * - #show_full_nav (class "open" while shown) toggles a popup tree, .eo_popup_tree, with one
 *   span.popup_tree_item per configuration: key="|…|instance_2_GROUP|ZU715A_1|P53921-B21#GTA_57" (part
 *   number and instance last), a .label ("DL385 Gen11 #1") and a .description
 *   ("(HPE ProLiant DL385 Gen11 8SFF TAA Compliant Configure-to-order Server)");
 * - #nav_up for the parent level.
 */
export class ConfigurationNavigation {
  constructor(private readonly page: Page, private readonly snapshot?: PageSnapshot) {}

  /** Name of the configuration level now open (the current breadcrumb entry). */
  async currentLevel(): Promise<string> {
    return clean(await this.page.locator('li.eo_nav_li.current').first().innerText({ timeout: 10_000 }).catch(() => ''));
  }

  private tree(): Locator {
    return this.page.locator('.eo_popup_tree').filter({ visible: true }).first();
  }

  /** Shows the navigation tree; #show_full_nav toggles, so it is clicked only while the tree is hidden. */
  async expand(): Promise<void> {
    if (await this.tree().isVisible().catch(() => false)) return;
    const toggle = this.page.locator('#show_full_nav').first();
    if (!await toggle.count()) return;
    console.log('[STEP] Showing the full configuration navigation');
    // An icon-font toggle can have no size until its font loads; a DOM click still reaches it.
    if (await toggle.isVisible().catch(() => false)) await toggle.click({ force: true });
    else await toggle.evaluate((element) => (element as HTMLElement).click());
    await waitForBlockingOverlay(this.page);
    await this.tree().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  }

  /** Every configuration in the navigation tree. */
  async entries(): Promise<NavigationEntry[]> {
    await this.expand();
    return this.page.locator('.eo_popup_tree .popup_tree_item').evaluateAll((items) => items.map((item) => ({
      key: item.getAttribute('key') ?? '',
      label: (item.querySelector(':scope > .label')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      description: (item.querySelector(':scope > .description')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })));
  }

  /**
   * The configurations of one product: entries whose key ends in "<part number>_<instance>".
   * The Solution Wizard names the server it added "(P53921-B21#GTA) HPE DL385 Gen11 8SFF CTO Svr".
   */
  async entriesForPart(partNumber: string): Promise<NavigationEntry[]> {
    const pattern = new RegExp(`\\|${escapeRegex(partNumber)}_\\d+$`, 'i');
    const all = await this.entries();
    // Kept for checking OCA's tree on the next run.
    await this.snapshot?.('Solution full navigation');
    return all.filter((entry) => pattern.test(entry.key));
  }

  /** Opens a configuration from the navigation tree and waits until it is the current level. */
  async open(entry: NavigationEntry): Promise<void> {
    await this.expand();
    const item = this.page.locator(`.eo_popup_tree .popup_tree_item[key=${JSON.stringify(entry.key)}]`).first();
    await expect(item, `Navigation entry ${entry.label}`).toBeVisible({ timeout: 30_000 });
    console.log(`[STEP] Opening ${entry.label}${entry.description ? ` ${entry.description}` : ''}`);
    const label = item.locator(':scope > .label').first();
    const target = await label.isVisible().catch(() => false) ? label : item;
    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    await target.click({ force: true }).catch(() => target.evaluate((element) => (element as HTMLElement).click()));
    await waitForBlockingOverlay(this.page);
    await expect(this.page.locator('li.eo_nav_li.current').first(), `${entry.label} should be the open configuration`)
      .toContainText(entry.label, { timeout: 60_000 });
  }

  /** Opens a level of the breadcrumb again (the solution after its servers); else goes up one level. */
  async returnTo(level: string): Promise<void> {
    if (!level || await this.currentLevel() === level) return;
    const crumb = this.page.locator('li.eo_nav_li').filter({ visible: true, hasText: new RegExp(`^\\s*${escapeRegex(level)}\\s*$`) }).first();
    if (await crumb.isVisible({ timeout: 5_000 }).catch(() => false)) {
      console.log(`[STEP] Returning to ${level}`);
      await crumb.click({ force: true });
    } else {
      console.log(`[STEP] Returning to the parent level (${level} is not in the breadcrumb)`);
      await this.page.locator('#nav_up').first().click({ force: true });
    }
    await waitForBlockingOverlay(this.page);
    await expect.poll(() => this.currentLevel(), { timeout: 60_000, message: `Return to ${level}` }).toBe(level);
  }
}

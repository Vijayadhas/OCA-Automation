import { expect, type Locator, type Page } from '@playwright/test';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';
import type { PageSnapshot } from '../reporting/html-capture';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * OCA's configuration navigation, as captured on S3V83A: a breadcrumb of li.eo_nav_li entries
 * ("OCA Config 2 > … #1 Group > … #1", the open level has class "current"), a #show_full_nav toggle
 * that lists every configuration of the solution, and #nav_up for the parent level. A dHCI solution
 * lists each server it holds there by name and number ("HPE DL325 Gen11 GPU CTO Svr #1"); the proven
 * S3V83A script opened it by that text.
 */
export class ConfigurationNavigation {
  constructor(private readonly page: Page, private readonly snapshot?: PageSnapshot) {}

  /** Name of the configuration level now open (the current breadcrumb entry). */
  async currentLevel(): Promise<string> {
    return clean(await this.page.locator('li.eo_nav_li.current').first().innerText({ timeout: 10_000 }).catch(() => ''));
  }

  /** Shows the full navigation list. #show_full_nav toggles, so it is clicked only while the wanted entries are hidden. */
  async expand(wanted?: Locator): Promise<void> {
    if (wanted && await wanted.first().isVisible().catch(() => false)) return;
    const toggle = this.page.locator('#show_full_nav').filter({ visible: true }).first();
    if (!await toggle.isVisible({ timeout: 5_000 }).catch(() => false)) return;
    console.log('[STEP] Showing the full configuration navigation');
    await toggle.click({ force: true });
    await waitForBlockingOverlay(this.page);
  }

  /** Visible navigation entries for a server name with an instance number ("<name> #1"). */
  async serverEntries(serverName: string): Promise<string[]> {
    const pattern = new RegExp(`${escapeRegex(serverName)}\\s*#\\s*\\d+`, 'i');
    const entries = this.page.getByText(pattern).filter({ visible: true });
    await this.expand(entries);
    await expect.poll(() => entries.count(), { timeout: 30_000, message: `Navigation entries for ${serverName}` })
      .toBeGreaterThan(0).catch(() => undefined);
    // Kept for checking OCA's list markup on the next run.
    await this.snapshot?.('Solution full navigation');
    const texts = (await entries.allInnerTexts()).map((text) => clean(text).match(pattern)?.[0] ?? '').filter(Boolean);
    return [...new Set(texts)];
  }

  /** Opens a configuration from the full navigation by its entry text and waits until it is the current level. */
  async open(entry: string): Promise<void> {
    const item = this.page.getByText(entry, { exact: true }).filter({ visible: true }).first()
      .or(this.page.getByText(new RegExp(`${escapeRegex(entry)}(?!\\d)`, 'i')).filter({ visible: true }).first()).first();
    await this.expand(item);
    await expect(item, `Navigation entry ${entry}`).toBeVisible({ timeout: 30_000 });
    console.log(`[STEP] Opening ${entry}`);
    await item.scrollIntoViewIfNeeded().catch(() => undefined);
    await item.click({ force: true }).catch(() => item.evaluate((element) => (element as HTMLElement).click()));
    await waitForBlockingOverlay(this.page);
    await expect(this.page.locator('li.eo_nav_li.current').first(), `${entry} should be the open configuration`)
      .toContainText(entry, { timeout: 60_000 });
  }

  /** Opens a level of the breadcrumb again (the solution after its servers); else goes up one level. */
  async returnTo(level: string): Promise<void> {
    if (!level || clean(await this.currentLevel()) === level) return;
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

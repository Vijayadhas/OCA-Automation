import { expect, type Locator, type Page } from '@playwright/test';
import { env } from '../config/env';
import { waitForBlockingOverlay } from '../core/waits';
import { dismissOcaMessageDialogs, ocaProblemMessage } from '../core/oca-problem';
import type { PageSnapshot } from '../reporting/html-capture';

/** The configuration entry in OCA's BOM tab (OCA_EXPECTED_PAGE_TEXT, default 'OCA Config 2'). */
export const BOM_CONFIG_NAME = env.expectedPageText;

export class BillingTier {
  constructor(private readonly page: Page, private readonly snapshot?: PageSnapshot) {}
  async run(): Promise<void> {
    await this.openBillingTierSetup();
    const dialog = this.page.locator('.ui-dialog, [role="dialog"]')
      .filter({ visible: true, hasText: /Billing Tier Setup/i }).last();
    await expect(dialog, 'Billing Tier Setup dialog').toBeVisible({ timeout: 60_000 });
    const ok = dialog.getByRole('button', { name: /^OK$/i })
      .or(dialog.locator('button, .s-btn').filter({ visible: true, hasText: /^OK$/i }))
      .or(dialog.locator('input[type="button"][value="OK" i], input[type="submit"][value="OK" i]'))
      .filter({ visible: true }).first();
    await expect(ok, 'Billing Tier Setup OK button').toBeVisible({ timeout: 60_000 });
    await this.fillManualCapacity(dialog);
    if (await this.isDisabled(ok)) await this.acknowledgeIncomplete(dialog, ok);
    console.log('[STEP] Closing Billing Tier Setup with OK');
    await ok.click({ force: true });
    await expect(dialog, 'Billing Tier Setup dialog should close after OK').toBeHidden({ timeout: 60_000 });
    await this.page.locator('.ui-widget-overlay.ui-front, .ui-widget-overlay')
      .waitFor({ state: 'hidden', timeout: 60_000 });
    await waitForBlockingOverlay(this.page);
  }

  /**
   * Opens the BOM tab, selects the configuration and clicks Billing Tier Setup. On DL320 Gen11
   * (P52765-B21, S2G17A, 2026-10-19) OCA answered the selection with its problem dialog ("Widget does
   * not exist on current page: extended_overview:bom:bom_tab"), whose overlay blocked the click for
   * 30 s. The dialog is closed and the BOM tab opened once more.
   */
  private async openBillingTierSetup(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      const bom = this.page.getByRole('link', { name: 'BOM', exact: true }).filter({ visible: true }).first();
      await expect(bom).toBeVisible({ timeout: 60_000 }); await bom.click(); await waitForBlockingOverlay(this.page);
      const ocaConfig2 = this.page.locator('#eo_nav_li_0').filter({ visible: true }).first();
      await expect(ocaConfig2).toContainText(BOM_CONFIG_NAME, { timeout: 60_000 });
      console.log(`[STEP] Selecting ${BOM_CONFIG_NAME} in BOM`);
      await ocaConfig2.click({ force: true });
      await waitForBlockingOverlay(this.page);
      const setup = this.page.getByText('Billing Tier Setup', { exact: false }).filter({ visible: true }).first()
        .or(this.page.locator('#obw_billingtier_bot').filter({ visible: true })).first();
      let problem = await ocaProblemMessage(this.page);
      if (!problem) {
        try {
          await expect(setup).toBeVisible({ timeout: 60_000 });
          await setup.click({ timeout: 30_000 });
          return;
        } catch (error) {
          // The dialog can open after the overlay wait, while the click is being retried.
          problem = await ocaProblemMessage(this.page);
          if (!problem) throw error;
        }
      }
      if (attempt >= 2) throw new Error(`OCA could not open the BOM tab: ${problem}`);
      console.log(`[WARN] OCA error while opening the BOM tab (${problem}); closing it and opening BOM again`);
      await dismissOcaMessageDialogs(this.page);
      await waitForBlockingOverlay(this.page);
    }
  }

  /** OCA keeps OK disabled (class billingtier-disabled) until required entries are made. */
  private async isDisabled(ok: Locator): Promise<boolean> {
    return /\bbillingtier-disabled\b/.test(await ok.getAttribute('class').catch(() => '') ?? '')
      || await ok.isDisabled().catch(() => false);
  }

  /**
   * Storage models (S2U63A, DL380 Gen11 Data Solutions) bill by a capacity OCA does not fill:
   * "Written Usable TiB. Manual entry required in OCA." The cell (td.btier-editableNumber) shows 0
   * with an edit pencil, and OK stays disabled until it is set. Each such cell still at 0 gets
   * OCA_MANUAL_BILLING_CAPACITY (default 1).
   */
  private async fillManualCapacity(dialog: Locator): Promise<void> {
    const cells = dialog.locator('td.btier-editableNumber').filter({ visible: true });
    const value = env.manualBillingCapacity;
    for (let index = 0; index < await cells.count(); index += 1) {
      const cell = cells.nth(index);
      // Only the number counts; the pencil icon may add text of its own.
      const current = (await cell.innerText().catch(() => '')).trim().match(/^[\d.,]*/)?.[0] ?? '';
      if (!/^0*(?:\.0+)?$/.test(current)) continue;
      const tier = (await cell.locator('xpath=ancestor::tr[1]').locator('td.btier-name').first().innerText().catch(() => ''))
        .replace(/\s+/g, ' ').trim();
      console.log(`[STEP] Billing Tier ${tier || `row ${index + 1}`}: capacity needs manual entry; entering ${value}`);
      const pencil = cell.locator('.btier-edit-pencil').first();
      await ((await pencil.isVisible().catch(() => false)) ? pencil : cell).click({ force: true });
      const input = cell.locator('input:not([type="checkbox"]):not([type="hidden"])').filter({ visible: true }).first();
      if (!await input.isVisible({ timeout: 3_000 }).catch(() => false)) {
        console.log('[WARN] No input appeared in the Billing Tier capacity cell after clicking it');
        await this.snapshot?.('WARN-Billing Tier capacity cell did not open for entry');
        continue;
      }
      await input.fill(value);
      await input.press('Enter');
      await waitForBlockingOverlay(this.page);
      const now = (await cell.innerText().catch(() => '')).trim().match(/^[\d.,]*/)?.[0] ?? '';
      if (now && /^0*(?:\.0+)?$/.test(now)) console.log(`[WARN] Billing Tier capacity still reads ${now} after entering ${value}`);
    }
  }

  /**
   * OCA's own way past an incomplete Billing Tier Setup: "I Acknowledge that the configuration is
   * incomplete, and I will re-run Billing Tier Setup before Quoting it" (#bt_ack_checkbox).
   */
  private async acknowledgeIncomplete(dialog: Locator, ok: Locator): Promise<void> {
    const label = dialog.locator('label[for="bt_ack_checkbox"]').filter({ visible: true }).first();
    if (!await label.isVisible().catch(() => false)) return;
    console.log('[WARN] Billing Tier Setup OK is disabled; ticking "I Acknowledge that the configuration is incomplete"');
    await this.snapshot?.('WARN-Billing Tier Setup incomplete');
    await label.click({ force: true });
    await expect.poll(() => this.isDisabled(ok), { timeout: 10_000, message: 'Billing Tier Setup OK enabled after acknowledging' })
      .toBe(false).catch(() => undefined);
  }
}

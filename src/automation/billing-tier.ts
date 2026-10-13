import { expect, type Page } from '@playwright/test';
import { env } from '../config/env';
import { waitForBlockingOverlay } from '../core/waits';

/** The configuration entry in OCA's BOM tab (OCA_EXPECTED_PAGE_TEXT, default 'OCA Config 2'). */
export const BOM_CONFIG_NAME = env.expectedPageText;

export class BillingTier {
  constructor(private readonly page: Page) {}
  async run(): Promise<void> {
    const bom = this.page.getByRole('link', { name: 'BOM', exact: true }).filter({ visible: true }).first();
    await expect(bom).toBeVisible({ timeout: 60_000 }); await bom.click(); await waitForBlockingOverlay(this.page);
    const ocaConfig2 = this.page.locator('#eo_nav_li_0').filter({ visible: true }).first();
    await expect(ocaConfig2).toContainText(BOM_CONFIG_NAME, { timeout: 60_000 });
    console.log(`[STEP] Selecting ${BOM_CONFIG_NAME} in BOM`);
    await ocaConfig2.click({ force: true });
    await waitForBlockingOverlay(this.page);
    const setup = this.page.getByText('Billing Tier Setup', { exact: false }).filter({ visible: true }).first()
      .or(this.page.locator('#obw_billingtier_bot').filter({ visible: true })).first();
    await expect(setup).toBeVisible({ timeout: 60_000 }); await setup.click();
    const dialog = this.page.locator('.ui-dialog, [role="dialog"]')
      .filter({ visible: true, hasText: /Billing Tier Setup/i }).last();
    await expect(dialog, 'Billing Tier Setup dialog').toBeVisible({ timeout: 60_000 });
    const ok = dialog.getByRole('button', { name: /^OK$/i })
      .or(dialog.locator('button, .s-btn').filter({ visible: true, hasText: /^OK$/i }))
      .or(dialog.locator('input[type="button"][value="OK" i], input[type="submit"][value="OK" i]'))
      .filter({ visible: true }).first();
    await expect(ok, 'Billing Tier Setup OK button').toBeVisible({ timeout: 60_000 });
    console.log('[STEP] Closing Billing Tier Setup with OK');
    await ok.click({ force: true });
    await expect(dialog, 'Billing Tier Setup dialog should close after OK').toBeHidden({ timeout: 60_000 });
    await this.page.locator('.ui-widget-overlay.ui-front, .ui-widget-overlay')
      .waitFor({ state: 'hidden', timeout: 60_000 });
    await waitForBlockingOverlay(this.page);
  }
}

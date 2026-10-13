import { expect, type Page } from '@playwright/test';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';
import { revealForViewer } from '../core/interactions';

export class ConfigurationHandler {
  constructor(private readonly page: Page) {}

  async select(configurationText: string): Promise<void> {
    const row = this.page.locator('tr.item_tr, tr, [role="row"]').filter({ visible: true })
      .filter({ hasText: new RegExp(`^.*${escapeRegex(configurationText)}.*$`, 'i') }).first();
    await expect(row, `Configuration ${configurationText}`).toBeVisible({ timeout: 60_000 });
    await revealForViewer(row);
    const radio = row.locator('input[type="radio"]').filter({ visible: true }).first();
    if (await radio.isVisible({ timeout: 1_000 }).catch(() => false)) await radio.check({ force: true });
    else await row.getByText(configurationText, { exact: false }).first().click({ force: true });
    await waitForBlockingOverlay(this.page);
  }
}

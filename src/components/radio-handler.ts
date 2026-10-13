import { expect, type Locator } from '@playwright/test';
import { revealForViewer } from '../core/interactions';

export class RadioHandler {
  async select(row: Locator, productNumber: string): Promise<void> {
    await revealForViewer(row);
    const radio = row.locator('input[type="radio"]').filter({ visible: true }).first();
    await expect(radio, `Radio for ${productNumber}`).toBeVisible();
    if (!(await radio.isChecked())) await radio.check({ force: true });
    await expect(radio).toBeChecked();
  }
}

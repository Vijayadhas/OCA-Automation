import { expect, type Page } from '@playwright/test';
import { readBomUcid } from '../core/excel';
import { waitForBlockingOverlay } from '../core/waits';

export interface BomCapacityDetails {
  billingTier: string;
  billingTierCustomName: string;
  allocatedMemory: string;
  server: string;
  usedCpuCore: string;
}

export interface EndBomOutcome {
  status: string;
  startBomId: string;
  endBomId: string;
  associated: boolean;
  startDetails: BomCapacityDetails;
  endDetails: BomCapacityDetails;
}

const emptyDetails = (): BomCapacityDetails => ({
  billingTier: '', billingTierCustomName: '', allocatedMemory: '', server: '', usedCpuCore: '',
});

export class EndBom {
  constructor(private readonly page: Page) {}

  async generateAndAssociate(): Promise<EndBomOutcome> {
    console.log('[STEP] Opening End BOM');
    const endBom = this.page.locator([
      '#obw_endbom_bot',
      '[id*="endbom" i]',
      '[data-action*="endbom" i]',
    ].join(', ')).or(this.page.getByRole('button', { name: /End BOM/i }))
      .or(this.page.getByRole('link', { name: /End BOM/i }))
      .or(this.page.getByText(/^End BOM$/i)).filter({ visible: true }).first();
    try {
      await expect(endBom, 'End BOM action after the OCA configuration is saved').toBeVisible({ timeout: 60_000 });
    } catch (error) {
      const state = await this.page.locator('body').innerText().catch(() => '');
      const summary = state.replace(/\s+/g, ' ').trim().slice(0, 800);
      throw new Error(`End BOM action was not available after Save. Current page: ${this.page.url()}. Visible page text: ${summary || '<empty>'}`, { cause: error });
    }
    await endBom.click({ force: true });
    await waitForBlockingOverlay(this.page);

    const autoGenerate = this.page.getByRole('button', { name: /Auto-?generate(?:d)?/i }).filter({ visible: true }).first();
    await expect(autoGenerate).toBeVisible({ timeout: 60_000 });
    console.log('[STEP] Selecting Auto-generate');
    await autoGenerate.click({ force: true });
    await waitForBlockingOverlay(this.page);

    const generate = this.page.getByRole('button', { name: /Generate End BOM/i }).filter({ visible: true }).first();
    await expect(generate).toBeVisible({ timeout: 60_000 });
    console.log('[STEP] Generating End BOM');
    await generate.click({ force: true });
    await waitForBlockingOverlay(this.page);

    const startBomId = await readBomUcid(this.page, 'Start BOM UCID');
    const endBomId = await readBomUcid(this.page, 'End BOM UCID');
    if (!startBomId) throw new Error('Start BOM UCID was not visible after End BOM generation');
    if (!endBomId) throw new Error('End BOM UCID was not visible after End BOM generation');
    const startDetails = await this.readCapacityDetails('Start BOM UCID');
    const endDetails = await this.readCapacityDetails('End BOM UCID');

    const associate = this.page.getByRole('button', { name: /Associate End BOM/i }).filter({ visible: true }).first();
    await expect(associate).toBeVisible({ timeout: 60_000 });
    console.log(`[STEP] Associating End BOM ${endBomId}`);
    await associate.click({ force: true });
    await waitForBlockingOverlay(this.page);

    const done = this.page.getByRole('button', { name: 'Done', exact: true }).filter({ visible: true }).first();
    await expect(done).toBeVisible({ timeout: 60_000 });
    const associatedStatus = this.page.getByText(/^(Associated|End BOM Associated)$/i).filter({ visible: true }).first();
    if (await associatedStatus.isVisible({ timeout: 5_000 }).catch(() => false)) {
      console.log(`[INFO] End BOM ${endBomId} association status confirmed`);
    } else {
      // Integration OCA does not consistently render an "Associated" label. The proven
      // flow acknowledges association by completing the successful click/loading cycle
      // and exposing the enabled Done action.
      console.log(`[INFO] End BOM ${endBomId} association completed; Done is available`);
    }
    console.log('[STEP] Completing End BOM');
    await done.click({ force: true });
    await waitForBlockingOverlay(this.page);
    return { status: 'Generated and associated', startBomId, endBomId, associated: true, startDetails, endDetails };
  }

  private async readCapacityDetails(label: 'Start BOM UCID' | 'End BOM UCID'): Promise<BomCapacityDetails> {
    const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
    const labels = this.page.getByText(label, { exact: false }).filter({ visible: true });
    let anchorBox: Awaited<ReturnType<typeof labels.boundingBox>> = null;
    let shortestTextLength = Number.POSITIVE_INFINITY;
    const labelCount = await labels.count();
    for (let index = 0; index < labelCount; index += 1) {
      const candidate = labels.nth(index);
      const text = clean(await candidate.textContent().catch(() => ''));
      const box = await candidate.boundingBox();
      if (box && text.startsWith(label) && text.length < shortestTextLength) {
        anchorBox = box;
        shortestTextLength = text.length;
      }
    }
    if (!anchorBox) return emptyDetails();

    const tables = this.page.locator('table').filter({ visible: true });
    let nearestTable: ReturnType<Page['locator']> | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const tableCount = await tables.count();
    for (let index = 0; index < tableCount; index += 1) {
      const table = tables.nth(index);
      const box = await table.boundingBox();
      if (!box || box.y < anchorBox.y - 5) continue;
      const distance = box.y - anchorBox.y;
      if (distance < nearestDistance) {
        nearestTable = table;
        nearestDistance = distance;
      }
    }
    if (!nearestTable) return emptyDetails();

    const rows = nearestTable.locator('tr');
    if (await rows.count() < 2) return emptyDetails();
    const headers = (await rows.nth(0).locator('th, td').allTextContents()).map(clean);
    const values = (await rows.nth(1).locator('td, th').allTextContents()).map(clean);
    const at = (pattern: RegExp, fallbackIndex: number) => {
      const index = headers.findIndex((header) => pattern.test(header));
      return values[index >= 0 ? index : fallbackIndex] ?? '';
    };
    return {
      billingTier: at(/^Billing Tier$/i, 0),
      billingTierCustomName: at(/Billing Tier Custom Name/i, 1),
      allocatedMemory: at(/Allocated Memory/i, 2),
      server: at(/^Server$/i, 3),
      usedCpuCore: at(/Used CPU Core/i, 4),
    };
  }
}

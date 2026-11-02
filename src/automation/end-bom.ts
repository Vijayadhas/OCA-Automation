import { expect, type Page } from '@playwright/test';
import { readBomUcid } from '../core/excel';
import { waitForBlockingOverlay } from '../core/waits';
import type { PageSnapshot } from '../reporting/html-capture';
import type { BomTierRecord } from '../models/automation-result';

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
  /** Every billing tier of both tables, with all visible columns. */
  tiers: BomTierRecord[];
}

const emptyDetails = (): BomCapacityDetails => ({
  billingTier: '', billingTierCustomName: '', allocatedMemory: '', server: '', usedCpuCore: '',
});

export class EndBom {
  constructor(private readonly page: Page, private readonly snapshot?: PageSnapshot) {}

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
    // S2G16A/S2G18A (DL320 Gen11 for Cohesity, 2026-10-19): <button id="endbom_autogen" class="... billingtier-disabled"
    // title="Currently not supported for auto generation. Use manual">. Clicking it does nothing and
    // Generate End BOM never shows; the saved configuration stays, and the reason is reported at once.
    const autoClass = await autoGenerate.getAttribute('class').catch(() => '') ?? '';
    if (/\bbillingtier-disabled\b/.test(autoClass) || await autoGenerate.isDisabled().catch(() => false)) {
      const reason = (await autoGenerate.getAttribute('title').catch(() => '') ?? '').trim();
      throw new Error(`OCA does not offer Auto-generate End BOM for this model${reason ? ` ("${reason}")` : ''}; `
        + 'the configuration is saved, but its End BOM has to be made manually');
    }
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
    // The capacity tables are read by position; keep this page so the columns can be checked.
    await this.snapshot?.('End BOM generated');
    const startDetails = await this.readCapacityDetails('Start BOM UCID');
    const endDetails = await this.readCapacityDetails('End BOM UCID');
    // Every tier and column of both tables, as associated, for the BOM Details sheet.
    const tiers: BomTierRecord[] = [];
    for (const [bom, ucid, tableId] of [['Start', startBomId, 'startbom_billingtier_table'], ['End', endBomId, 'endbom_billingtier_table']] as const) {
      const rows = await this.readBillingTierRows(tableId).catch(() => null) ?? [];
      tiers.push(...rows.map((values) => ({ bom, ucid, values })));
      console.log(`[INFO] ${bom} BOM ${ucid}: ${rows.length} billing tier(s) read${rows.length ? ` (${Object.keys(rows[0]).join(', ')})` : ''}`);
    }

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
    return { status: 'Generated and associated', startBomId, endBomId, associated: true, startDetails, endDetails, tiers };
  }

  /**
   * Every billing tier of a BOM table on OCA's End BOM page (#startbom_billingtier_table or
   * #endbom_billingtier_table), one record per tier with each visible column under its header:
   * Billing Tier, Billing Tier Custom Name, Include Billing Tier, Allocated Memory, Server, Used CPU
   * Core, Written Usable GB/TB, Fixed, or whatever columns the model's table shows. The tables carry
   * hidden columns (Previous Allocated Memory, Fixed Servers, ...) and hidden duplicate cells, so only
   * visible headers and cells are paired. A switch or checkbox in a cell reads Yes or No; an empty
   * cell with an entry box reads the box's value.
   */
  async readBillingTierRows(tableId: string): Promise<Array<Record<string, string>> | null> {
    const table = this.page.locator(`[id=${JSON.stringify(tableId)}]`).first();
    if (!await table.count()) return null;
    // Inline callbacks only: named functions inside evaluate get tsx's __name helper, absent in the page.
    const read = await table.evaluate((element) => ({
      headers: Array.from(element.querySelectorAll('thead th')).filter((cell) => cell.getClientRects().length > 0)
        .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\s*\?$/, '')),
      rows: Array.from(element.querySelectorAll('tbody tr')).filter((row) => row.getClientRects().length > 0)
        .map((row) => Array.from(row.querySelectorAll('td')).filter((cell) => cell.getClientRects().length > 0)
          .map((cell) => {
            const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
            const toggle = cell.querySelector('input[type="checkbox"], input[type="radio"], [role="switch"], [aria-checked]');
            if (toggle) {
              const on = toggle instanceof HTMLInputElement ? toggle.checked : toggle.getAttribute('aria-checked') === 'true';
              return text ? `${on ? 'Yes' : 'No'} (${text})` : on ? 'Yes' : 'No';
            }
            const entry = cell.querySelector('input:not([type="hidden"]), select, textarea') as HTMLInputElement | null;
            return !text && entry ? (entry.value ?? '').trim() : text;
          })),
    }));
    if (!read.headers.length) return null;
    const names = read.headers.map((header, index) => header || `Column ${index + 1}`);
    return read.rows.filter((row) => row.some(Boolean)).map((row) => {
      const record: Record<string, string> = {};
      names.forEach((name, index) => {
        const key = Object.prototype.hasOwnProperty.call(record, name) ? `${name} (${index + 1})` : name;
        record[key] = row[index] ?? '';
      });
      return record;
    });
  }

  /**
   * The five capacity columns of a BOM table for the Results sheet; several tiers are joined with
   * "; ". The BOM Details sheet has every column of every tier (readBillingTierRows).
   */
  async readBillingTierTable(tableId: string): Promise<BomCapacityDetails | null> {
    const records = await this.readBillingTierRows(tableId);
    if (!records?.length) return null;
    const read = { headers: Object.keys(records[0]), rows: records.map((record) => Object.values(record)) };
    const column = (pattern: RegExp) => {
      const index = read.headers.findIndex((header) => pattern.test(header));
      return index < 0 ? '' : read.rows.map((row) => row[index] ?? '').filter(Boolean).join('; ');
    };
    return {
      billingTier: column(/^Billing Tier$/i),
      billingTierCustomName: column(/Billing Tier Custom Name/i),
      allocatedMemory: column(/^Allocated Memory/i),
      server: column(/^Server/i),
      usedCpuCore: column(/^Used CPU Core/i),
    };
  }

  private async readCapacityDetails(label: 'Start BOM UCID' | 'End BOM UCID'): Promise<BomCapacityDetails> {
    const fromTable = await this.readBillingTierTable(label === 'Start BOM UCID' ? 'startbom_billingtier_table' : 'endbom_billingtier_table');
    if (fromTable) return fromTable;
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

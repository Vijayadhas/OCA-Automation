import { expect, type Locator, type Page } from '@playwright/test';
import type { ComponentInstruction } from '../models/component-instruction';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';
import { QuantityHandler } from '../components/quantity-handler';
import { RadioHandler } from '../components/radio-handler';
import { ConfigurationHandler } from '../components/configuration-handler';
import { AutomaticDependencyHandler } from '../components/automatic-dependency-handler';
import type { ServerFamily } from './model-search';
import type { PageSnapshot } from '../reporting/html-capture';

export class UnsupportedComponentError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedComponentError'; }
}

/**
 * Random processor picks stay at or below this power. Above 270W, OCA pairs the CPU
 * with the Performance heatsink, and its rule then requires an OCP Enablement Kit for
 * any 1G/10G OCP card (seen on P72176-B21 with a 350W CPU). Excel-entered CPUs are not limited.
 */
export const MAX_RANDOM_PROCESSOR_WATTS = 270;

export function isMemoryBlankProduct(description: string): boolean {
  return /\b(?:memory\s+)?blank(?:\s+kit)?\b/i.test(description);
}

export class ComponentEngine {
  private readonly quantities: QuantityHandler;
  private readonly radios = new RadioHandler();
  private readonly configurations: ConfigurationHandler;
  private readonly dependencies: AutomaticDependencyHandler;

  constructor(private readonly page: Page, private readonly serverFamily: ServerFamily = 'unknown', snapshot?: PageSnapshot) {
    this.quantities = new QuantityHandler(page, snapshot);
    this.configurations = new ConfigurationHandler(page);
    this.dependencies = new AutomaticDependencyHandler(this.quantities);
  }

  async showAllProducts(): Promise<void> {
    await waitForBlockingOverlay(this.page);
    const toggle = this.page.locator('#menu_cust_cmn_toggle').first();
    const label = this.page.locator('label[for="menu_cust_cmn_toggle"]').first();
    if (!(await toggle.count()) && !(await label.isVisible({ timeout: 2_000 }).catch(() => false))) {
      console.log('[INFO] HPE Recommended only toggle is not present; continuing');
      return;
    }

    const enabled = await toggle.isChecked().catch(async () => {
      const className = await label.getAttribute('class').catch(() => '');
      return /active|checked|on/i.test(className ?? '');
    });
    if (!enabled) {
      console.log('[INFO] HPE Recommended only is already disabled');
      return;
    }

    console.log('[STEP] Disabling HPE Recommended only to show all products');
    if (await label.isVisible({ timeout: 2_000 }).catch(() => false)) await label.click({ force: true });
    else await toggle.click({ force: true });
    const yes = this.page.getByRole('button', { name: /^Yes$/i }).filter({ visible: true }).first();
    if (await yes.isVisible({ timeout: 5_000 }).catch(() => false)) await yes.click({ force: true });
    await waitForBlockingOverlay(this.page);
    await expect.poll(() => toggle.isChecked().catch(() => false), {
      timeout: 30_000,
      message: 'HPE Recommended only toggle should be disabled',
    }).toBe(false);
  }

  async openSection(sectionName: string): Promise<void> {
    // Power choices can already be expanded after Smart Chassis recalculation.
    // Clicking their header again would collapse the rows we need to configure.
    if (/^power\s*suppl(?:y|ies)$/i.test(sectionName) && await this.powerSupplyRows().count() > 0) return;
    const exact = new RegExp(`^\\s*${escapeRegex(sectionName)}\\s*$`, 'i');
    const knownSelectors: Record<string, string> = {
      processor: '#section_header_processor, #section_header_processorSection, [id*="section_header" i][id*="processor" i]',
      memory: '#section_header_memory, #section_header_memorySection, [id*="section_header" i][id*="memory" i]',
      'smart chassis': '#section_header_smartChassisSection, #section_header_smartChassis, [id*="section_header" i][id*="smartChassis" i]',
      'power supplies': '#section_header_power, #section_header_powerSection, [id*="section_header" i][id*="power" i]',
    };
    const known = knownSelectors[sectionName.trim().toLowerCase()];
    let section: Locator | undefined;
    if (known) {
      const candidate = this.page.locator(known).filter({ visible: true }).first();
      if (await candidate.isVisible({ timeout: 5_000 }).catch(() => false)) section = candidate;
    }
    const headers = this.page.locator('[id*="section_header" i], .section_header').filter({ visible: true });
    const words = sectionName.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const count = await headers.count();
    for (let index = 0; !section && index < count; index += 1) {
      const candidate = headers.nth(index);
      const identity = `${await candidate.getAttribute('id') ?? ''} ${await candidate.innerText().catch(() => '')}`.toLowerCase();
      if (words.every((word) => identity.includes(word))) {
        section = candidate;
        break;
      }
    }
    section ??= this.page.locator('button, a').filter({ visible: true, hasText: exact }).first();
    await expect(section, `Section ${sectionName}`).toBeVisible({ timeout: 60_000 });
    if (await section.getAttribute('aria-expanded') === 'true') return;
    // OCA section headers carry no aria-expanded, and clicking an open header collapses it
    // (required-selection recovery then saw zero processor rows). Visible choices = open.
    const sectionKey = (await section.getAttribute('id'))?.match(/^section_header_(.+)$/)?.[1];
    if (sectionKey && await this.page.locator(`[id^="choice_header_${sectionKey}_"], tr.item_tr[data-elementid^="${sectionKey}_"]`)
      .filter({ visible: true }).count()) return;
    await section.scrollIntoViewIfNeeded();
    await section.click({ force: true });
    await waitForBlockingOverlay(this.page);
  }

  async findProductRow(productNumber: string, description?: string): Promise<Locator> {
    await expect.poll(async () => this.page.locator('tr.item_tr, tr, [role="row"]')
      .filter({ visible: true, hasText: new RegExp(`\\b${escapeRegex(productNumber)}\\b`, 'i') }).count(),
    { timeout: 60_000, message: `Visible product row for ${productNumber}` }).toBeGreaterThan(0);
    const escaped = escapeRegex(productNumber);
    const rows = this.page.locator('tr.item_tr, tr, [role="row"]').filter({ visible: true })
      .filter({ hasText: new RegExp(`\\b${escaped}\\b`, 'i') });
    const scoped = description ? rows.filter({ hasText: description }) : rows;
    const exactRows: Locator[] = [];
    const count = await scoped.count();
    for (let index = 0; index < count; index += 1) {
      const row = scoped.nth(index);
      const visibleText = (await row.innerText()).replace(/\s+/g, ' ').trim();
      if (new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'i').test(visibleText)) exactRows.push(row);
    }
    if (exactRows.length !== 1) {
      throw new UnsupportedComponentError(`Expected one visible exact row for ${productNumber}; found ${exactRows.length}`);
    }
    return exactRows[0];
  }

  async selectRadioProduct(productNumber: string, description?: string): Promise<void> {
    await this.radios.select(await this.findProductRow(productNumber, description), productNumber);
    await waitForBlockingOverlay(this.page);
  }

  async setProductQuantity(productNumber: string, quantity: number, description?: string): Promise<void> {
    await this.quantities.set(await this.findProductRow(productNumber, description), productNumber, quantity);
  }

  async selectConfiguration(configurationText: string): Promise<void> {
    await this.configurations.select(configurationText);
  }

  async verifySelectedQuantity(productNumber: string, expectedQuantity: number, description?: string): Promise<void> {
    await this.dependencies.verify(await this.findProductRow(productNumber, description), productNumber, expectedQuantity);
  }

  async selectRandomProcessor(): Promise<{ productNumber: string; quantity: number }> {
    const existing = await this.findExistingSelection(/processor/i, /heat\s*sink|heatsink|fan/i);
    if (existing) {
      console.log(`[INFO] Processor ${existing.productNumber} x${existing.quantity} is already selected; leaving it unchanged`);
      return existing;
    }
    // OCA places Processor, Heatsink, and the next component tables in the same expanded panel.
    // Scope by the recorded element id so a row from the adjacent choice cannot be selected.
    const candidates = this.page
      .locator('tr.item_tr[id$="_ProcessorSection_ProcessorChoice"], tr.item_tr[data-elementid="ProcessorSection_ProcessorChoice"]')
      .filter({ visible: true });
    const available: Array<{ row: Locator; productNumber: string }> = [];
    const overLimit: string[] = [];
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const row = candidates.nth(index);
      const productNumber = ((await row.locator('._pid').first().textContent().catch(() => '')) ?? '').trim();
      const hasRadio = await row.locator('input[type="radio"]').count();
      const hasQuantity = await row.locator('td.item_qty .item_qty_div, td.item_qty select').count();
      if (!productNumber || !hasRadio || !hasQuantity) continue;
      const description = ((await row.locator('.item_desc').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
      const watts = Number(description.match(/(\d+)\s*W\b/i)?.[1]);
      if (watts > MAX_RANDOM_PROCESSOR_WATTS) { overLimit.push(`${productNumber} ${watts}W`); continue; }
      available.push({ row, productNumber });
    }
    if (overLimit.length) {
      console.log(`[INFO] Random Processor skips ${overLimit.length} CPU(s) over ${MAX_RANDOM_PROCESSOR_WATTS}W: ${overLimit.join(', ')}`);
    }
    if (!available.length) {
      throw new UnsupportedComponentError(
        `No visible rows matched ProcessorSection_ProcessorChoice at or below ${MAX_RANDOM_PROCESSOR_WATTS}W `
        + `(visible processor candidates: ${count}; over the limit: ${overLimit.length})`,
      );
    }
    return this.tryRandomCandidates('Processor', available, async (selected) => {
      const quantity = Math.random() < 0.5 ? 1 : 2;
      await this.quantities.set(selected.row, selected.productNumber, quantity);
      return { productNumber: selected.productNumber, quantity };
    });
  }

  async selectRandomMemory(): Promise<{ productNumber: string; quantity: number }> {
    const existing = await this.findExistingSelection(/memory/i, /\bblank\b/i);
    if (existing) {
      console.log(`[INFO] Memory ${existing.productNumber} x${existing.quantity} is already selected; leaving it unchanged`);
      return existing;
    }
    const choiceTable = this.page.locator('#choice_column_titles_memory_memorySlotsChoice').filter({ visible: true }).first();
    await expect(choiceTable, 'Memory choice table after opening the Memory section').toBeVisible({ timeout: 60_000 });
    await choiceTable.scrollIntoViewIfNeeded();
    await choiceTable.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const candidates = this.page
      .locator('tr.item_tr[data-elementid="memory_memorySlotsChoice"], tr.item_tr[id$="_memory_memorySlotsChoice"]')
      .filter({ visible: true });
    const available: Array<{ row: Locator; productNumber: string }> = [];
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const row = candidates.nth(index);
      const productNumber = ((await row.locator('._pid').first().textContent().catch(() => '')) ?? '').trim();
      const description = ((await row.locator('.item_desc').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      const hasQuantity = await row.locator('td.item_qty .item_qty_div, td.item_qty select').count();
      if (productNumber && !isMemoryBlankProduct(description) && hasQuantity) available.push({ row, productNumber });
    }
    if (!available.length) {
      throw new UnsupportedComponentError(
        `No visible rows matched memory_memorySlotsChoice (visible memory candidates: ${count})`,
      );
    }
    return this.tryRandomCandidates('Memory', available, async (selected) => {
      const quantity = Math.random() < 0.5 ? 1 : 2;
      await this.quantities.set(selected.row, selected.productNumber, quantity, true);
      return { productNumber: selected.productNumber, quantity };
    });
  }

  async selectRandomSmartChassis(): Promise<{ productNumber: string; description: string; quantity: number }> {
    const familyElementIds: Partial<Record<ServerFamily, string>> = {
      DL360: 'smartChassisSection_templateJsonChoiceDL360',
      DL380: 'smartChassis_templateJsonChoice',
      ML350: 'smartChassisSection_templateJsonChoiceML350',
    };
    const elementId = familyElementIds[this.serverFamily];
    const selector = elementId
      ? `tr.item_tr[data-elementid="${elementId}"]`
      : [
        'tr.item_tr[data-elementid*="smartChassis" i][data-elementid*="templateJsonChoice" i]',
        'tr.item_tr[id*="smartChassis" i][id*="templateJsonChoice" i]',
      ].join(', ');
    const candidates = this.page.locator(selector).filter({ visible: true });
    let rowsVisible = await candidates.first().waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true).catch(() => false);
    if (!rowsVisible) {
      console.log(`[INFO] Reopening Smart Chassis section for ${this.serverFamily}`);
      const header = this.page.getByRole('button', { name: /Smart Chassis/i }).filter({ visible: true }).first()
        .or(this.page.locator('#section_header_smartChassisSection, #section_header_smartChassis, [id*="section_header" i][id*="smartChassis" i]')
          .filter({ visible: true }).first()).first();
      if (await header.isVisible().catch(() => false)) {
        await header.click({ force: true });
        await waitForBlockingOverlay(this.page);
        rowsVisible = await candidates.first().waitFor({ state: 'visible', timeout: 30_000 })
          .then(() => true).catch(() => false);
      }
    }
    if (!rowsVisible) {
      return this.selectAlternateSmartChassisLayout();
    }
    await candidates.first().scrollIntoViewIfNeeded();
    const available: Array<{ row: Locator; productNumber: string; description: string }> = [];
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const row = candidates.nth(index);
      const productNumber = ((await row.locator('._pid').first().textContent().catch(() => '')) ?? '').trim();
      const description = ((await row.locator('.item_desc').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      if (productNumber && description && await row.locator('input[type="radio"]').count()) {
        available.push({ row, productNumber, description });
      }
    }
    if (!available.length) {
      throw new UnsupportedComponentError(
        `No visible Smart Chassis rows matched ${this.serverFamily} layout ${elementId ?? '(generic)'} (visible candidates: ${count})`,
      );
    }
    return this.tryRandomCandidates('Smart Chassis', available, async (selected) => {
      await this.radios.select(selected.row, selected.description);
      await waitForBlockingOverlay(this.page);
      await this.quantities.verify(selected.row, selected.productNumber, 1);
      return { productNumber: selected.productNumber, description: selected.description, quantity: 1 };
    });
  }

  async selectRandomPowerSupply(): Promise<{ productNumber: string; description: string; quantity?: number }> {
    const existing = await this.findExistingSelection(/power/i);
    if (existing) {
      console.log(`[INFO] Power Supplies ${existing.productNumber} x${existing.quantity} is already selected; leaving it unchanged`);
      return { ...existing, description: existing.productNumber };
    }
    // Product descriptions are not guaranteed to contain the words "Power Supply".
    // The stable OCA identity is the power choice/slot element id (for example
    // item_tr_P44712-B21_power_powerSlots on DL360 Gen12).
    const candidates = this.powerSupplyRows();
    const choicesVisible = await candidates.first().waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true).catch(() => false);
    if (!choicesVisible) {
      throw new UnsupportedComponentError(
        `${this.serverFamily} Power Supplies section did not expose any selectable power slot rows`,
      );
    }
    await candidates.first().scrollIntoViewIfNeeded();
    const available: Array<{ row: Locator; productNumber: string; description: string }> = [];
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const row = candidates.nth(index);
      const productNumber = ((await row.locator('._pid').first().textContent().catch(() => '')) ?? '').trim();
      const description = ((await row.locator('.item_desc').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      const hasQuantity = await row.locator('td.item_qty .item_qty_div, td.item_qty select').count();
      if (productNumber && hasQuantity) available.push({ row, productNumber, description: description || productNumber });
    }
    if (!available.length) {
      throw new UnsupportedComponentError(`No visible Power Supply product rows were available (visible candidates: ${count})`);
    }
    return this.tryRandomCandidates('Power Supplies', available, async (selected) => {
      await this.quantities.set(selected.row, selected.productNumber, 1, true);
      return { productNumber: selected.productNumber, description: selected.description, quantity: 1 };
    });
  }

  private async tryRandomCandidates<T extends { row: Locator; productNumber: string }, R>(
    section: string, candidates: T[], select: (candidate: T) => Promise<R>,
  ): Promise<R> {
    const remaining: T[] = [];
    // Capture identities before the first action can reorder any choice table.
    for (const candidate of candidates) {
      const id = await candidate.row.getAttribute('id');
      remaining.push({ ...candidate, row: id ? this.page.locator(`[id=${JSON.stringify(id)}]`) : candidate.row });
    }
    const failures: string[] = [];
    while (remaining.length) {
      const [candidate] = remaining.splice(Math.floor(Math.random() * remaining.length), 1);
      const before = await this.quantities.committedQuantity(candidate.row, candidate.productNumber);
      console.log(`[STEP] Random ${section} candidate ${failures.length + 1}/${candidates.length}: ${candidate.productNumber}`);
      try {
        const result = await select(candidate);
        console.log(`[INFO] ${section} selected successfully: ${candidate.productNumber}`);
        return result;
      } catch (error) {
        if (this.page.isClosed() || /page, context or browser has been closed|browser.*disconnected/i.test(String(error))) throw error;
        const message = String(error).split('\n')[0];
        failures.push(`${candidate.productNumber}: ${message}`);
        console.log(`[WARN] ${section} candidate ${candidate.productNumber} failed: ${message}`);
        await this.page.keyboard.press('Escape');
        await waitForBlockingOverlay(this.page);
        const after = await this.quantities.committedQuantity(candidate.row, candidate.productNumber);
        if (after !== before) {
          if (!/^\d+$/.test(before)) throw new Error(`Cannot safely restore failed ${section} candidate ${candidate.productNumber}; previous quantity was unreadable`, { cause: error });
          console.log(`[STEP] Restoring failed candidate ${candidate.productNumber} to quantity ${before} before fallback`);
          await this.quantities.set(candidate.row, candidate.productNumber, Number(before), true);
        }
        if (remaining.length) console.log(`[STEP] Trying another random ${section} candidate (${remaining.length} remaining)`);
      }
    }
    throw new Error(`All ${section} candidates failed: ${failures.join(' | ')}`);
  }

  async executeGeneric(instruction: ComponentInstruction): Promise<void> {
    await this.openSection(instruction.section);
    if (instruction.selectionType === 'random' && /^(processor|memory|power supplies)$/i.test(instruction.section)) {
      const isProcessor = /^processor$/i.test(instruction.section);
      const sectionPattern = isProcessor
        ? /processor/i
        : /^memory$/i.test(instruction.section) ? /memory/i : /power/i;
      const excludePattern = isProcessor
        ? /heat\s*sink|heatsink|fan/i
        : /^memory$/i.test(instruction.section) ? /\bblank\b/i : undefined;
      const existing = await this.findExistingSelection(sectionPattern, excludePattern);
      if (existing) {
        console.log(`[INFO] ${instruction.section} ${existing.productNumber} x${existing.quantity} is already selected; leaving it unchanged`);
        instruction.productNumber = existing.productNumber;
        instruction.quantity = existing.quantity;
        return;
      }
    }
    const product = instruction.productNumber;
    switch (instruction.selectionType) {
      case 'radio': await this.selectRadioProduct(product!, instruction.description); break;
      case 'quantity': await this.setProductQuantity(product!, instruction.quantity!, instruction.description); break;
      case 'random': {
        const selected = /^processor$/i.test(instruction.section)
          ? await this.selectRandomProcessor()
          : /^memory$/i.test(instruction.section)
            ? await this.selectRandomMemory()
            : /^smart chassis$/i.test(instruction.section)
              ? await this.selectRandomSmartChassis()
              : await this.selectRandomPowerSupply();
        instruction.productNumber = selected.productNumber;
        instruction.quantity = selected.quantity;
        if ('description' in selected && typeof selected.description === 'string') instruction.description = selected.description;
        break;
      }
      case 'automatic': await this.verifySelectedQuantity(product!, instruction.quantity ?? 1, instruction.description); break;
      case 'configuration': await this.selectConfiguration(instruction.configurationText!); break;
      case 'checkbox': {
        const row = await this.findProductRow(product!, instruction.description);
        const checkbox = row.locator('input[type="checkbox"]').filter({ visible: true }).first();
        await expect(checkbox).toBeVisible(); if (!(await checkbox.isChecked())) await checkbox.check({ force: true });
        await expect(checkbox).toBeChecked();
        await waitForBlockingOverlay(this.page);
        break;
      }
      case 'default': break;
      default: throw new UnsupportedComponentError(`Unsupported selection type for ${product ?? instruction.section}`);
    }
  }

  /** Opens a section reported by OCA as invalid and supplies a safe required value. */
  async satisfyRequiredSection(sectionName: string): Promise<void> {
    await this.openSection(sectionName);
    if (/^processor$/i.test(sectionName)) { await this.selectRandomProcessor(); return; }
    if (/^memory$/i.test(sectionName)) { await this.selectRandomMemory(); return; }
    if (/^smart\s*chassis$/i.test(sectionName)) { await this.selectRandomSmartChassis(); return; }
    if (/^power\s*suppl(?:y|ies)$/i.test(sectionName)) {
      const selected = await this.selectRandomPowerSupply();
      await waitForBlockingOverlay(this.page);
      const invalidHeader = this.page.locator('[id*="section_header" i][id*="power" i]')
        .filter({ has: this.page.locator('[title="Error" i]:visible, [aria-label="Error" i]:visible, .img-alert.dqe-status-icon-14:visible') });
      if (await invalidHeader.count()) {
        const rows = (await this.powerSupplyRows().allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());
        throw new Error(`Power Supplies still has a mandatory error after selecting ${selected.productNumber} x${selected.quantity}. `
          + `The selected quantity alone does not satisfy this section; stopping instead of repeating the same selection. Power slot rows: ${rows.join(' | ')}`);
      }
      return;
    }
    if (!await this.satisfyVisibleRequiredControl()) {
      throw new UnsupportedComponentError(`No selectable required control was found in error section ${sectionName}`);
    }
  }

  /** Handles required dropdowns/rows not represented by an Excel component instruction. */
  async satisfyVisibleRequiredControl(): Promise<boolean> {
    const selects = this.page.locator('select:visible');
    for (let index = 0; index < await selects.count(); index += 1) {
      const select = selects.nth(index);
      const selected = await select.locator('option:checked').first().evaluate((option) => ({
        value: (option as HTMLOptionElement).value,
        text: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })).catch(() => ({ value: '', text: '' }));
      if (selected.value && selected.value !== 'none_item' && !/please make a selection|^none\.?$/i.test(selected.text)) continue;
      const available = await select.locator('option:not([disabled])').evaluateAll((options) => options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        text: (option.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })));
      const picked = available.find((option) => option.value && option.value !== 'none_item'
        && !/please make a selection|^none\.?$/i.test(option.text));
      if (!picked) continue;
      console.log(`[STEP] Required dropdown: ${picked.text}`);
      await select.selectOption(picked.value, { force: true });
      await waitForBlockingOverlay(this.page);
      return true;
    }

    const row = this.page.locator('tr.item_tr:visible, tr[role="row"]:visible')
      .filter({ has: this.page.locator('input[type="radio"]:not(:checked)') }).first();
    if (await row.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const productNumber = ((await row.locator('._pid').first().textContent().catch(() => '')) ?? '').trim();
      if (productNumber && await row.locator('td.item_qty .item_qty_div, td.item_qty select').count()) {
        console.log(`[STEP] Required product: ${productNumber} x1`);
        await this.quantities.set(row, productNumber, 1, false);
      } else {
        await row.locator('input[type="radio"]').first().check({ force: true });
        await waitForBlockingOverlay(this.page);
      }
      return true;
    }
    return false;
  }

  private async selectAlternateSmartChassisLayout(): Promise<{ productNumber: string; description: string; quantity: number }> {
    const requiredRows = ['Select Defaults for Smart Chassis', 'Config 65'];
    const selected: string[] = [];
    for (const description of requiredRows) {
      const row = this.page.locator('tr.item_tr, tr, [role="row"]')
        .filter({ visible: true, hasText: description }).first();
      if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) continue;
      await this.quantities.set(row, description, 1, false);
      selected.push(description);
    }
    if (!selected.length) {
      throw new UnsupportedComponentError(
        `Smart Chassis section did not expose the ${this.serverFamily} choice table or the alternate Defaults/Config 65 layout`,
      );
    }
    const description = selected.join(' + ');
    console.log(`[INFO] Alternate Smart Chassis layout configured: ${description}`);
    return { productNumber: description, description, quantity: 1 };
  }

  private async findExistingSelection(
    sectionPattern: RegExp,
    excludePattern?: RegExp,
  ): Promise<{ productNumber: string; quantity: number } | null> {
    const sectionName = /memory/i.test(sectionPattern.source)
      ? 'memory'
      : /power/i.test(sectionPattern.source) ? 'power' : 'processor';
    const rows = sectionName === 'power'
      ? this.powerSupplyRows()
      : this.page.locator([
        `tr.item_tr[id*="${sectionName}" i]`,
        `tr.item_tr[data-elementid*="${sectionName}" i]`,
      ].join(', ')).filter({ visible: true });
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const identity = `${await row.getAttribute('id') ?? ''} ${await row.getAttribute('data-elementid') ?? ''}`;
      const description = ((await row.locator('.item_desc').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      if (!sectionPattern.test(identity) || (excludePattern && excludePattern.test(`${identity} ${description}`))) continue;
      const radio = row.locator('input[type="radio"]').first();
      const radioSelected = await radio.count() > 0 && await radio.isChecked().catch(() => false);
      const inner = row.locator('.item_qty_div').filter({ visible: true }).first();
      const quantityText = await inner.isVisible()
        ? (await inner.textContent() ?? '').trim()
        : ((await row.locator('.item_qty').first().textContent().catch(() => '')) ?? '').trim();
      const productNumber = ((await row.locator('._pid').first().textContent().catch(() => '')) ?? '').trim();
      if (!productNumber) continue;
      const select = row.locator('select').filter({ visible: true }).first();
      const input = row.locator('input[type="number"], input[type="text"]').filter({ visible: true }).first();
      let rawQuantity = quantityText;
      if (await select.count()) rawQuantity = (await select.locator('option:checked').textContent() ?? '').trim();
      else if (await input.count()) rawQuantity = await input.inputValue().catch(() => quantityText);
      // Read only a complete quantity, never the first digit of menu options or
      // other text in the cell. A displayed zero is not a committed selection.
      const parsed = /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : (!rawQuantity && radioSelected ? 1 : 0);
      if (parsed <= 0) continue;
      return { productNumber, quantity: parsed };
    }
    return null;
  }

  private powerSupplyRows(): Locator {
    // The power section also contains cords and other accessories. A positive
    // quantity anywhere under "power" does not mean a PSU slot is populated.
    // These are the slot identities in the recorded base-model OCA layouts.
    const identified = this.page.locator([
      'tr.item_tr[id$="_power_powerSlots" i]',
      'tr.item_tr[data-elementid="power_powerSlots" i]',
      'tr[role="row"][id$="_power_powerSlots" i]',
    ].join(', '));
    return identified.filter({ visible: true })
      .filter({ has: this.page.locator('td.item_qty .item_qty_div, td.item_qty select') })
      .filter({ has: this.page.locator('._pid') });
  }
}

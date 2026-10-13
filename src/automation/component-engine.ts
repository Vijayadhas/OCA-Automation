import { expect, type Locator, type Page } from '@playwright/test';
import type { ComponentInstruction } from '../models/component-instruction';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';
import { QuantityHandler } from '../components/quantity-handler';
import { RadioHandler } from '../components/radio-handler';
import { ConfigurationHandler } from '../components/configuration-handler';
import { AutomaticDependencyHandler } from '../components/automatic-dependency-handler';
import type { PageSnapshot } from '../reporting/html-capture';

export class UnsupportedComponentError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedComponentError'; }
}

/**
 * Random processor picks stay at or below this power (OCA_MAX_RANDOM_CPU_WATTS, default 270).
 * Above it, OCA pairs the CPU with a Performance heatsink, and its rule then requires an OCP
 * Enablement Kit for 1G/10G OCP cards. Processors given explicitly are not limited.
 */
export const MAX_RANDOM_PROCESSOR_WATTS = Number(process.env.OCA_MAX_RANDOM_CPU_WATTS ?? 270);

/** Blank and filler kits are never chosen at random. */
export function isMemoryBlankProduct(description: string): boolean {
  return /\b(?:memory\s+)?blank(?:\s+kit)?\b/i.test(description);
}

/**
 * A component menu section as OCA renders it for every model:
 * `#section_header_<key>` holds the visible title; each choice in it has `#choice_title_<choice>`
 * and item rows `tr.item_tr[data-elementid="<choice>"]` (row ids end in `_<choice>`), where
 * `<choice>` starts with `<key>_`. Keys and choice ids differ between models; titles do not.
 */
export interface MenuSection { key: string; title: string }
export interface MenuChoice { id: string; title: string; rows: number }
export interface Selection { productNumber: string; description: string; quantity: number }
export type ExecutionOutcome = 'done' | 'skipped';

interface RowInfo {
  id: string; productNumber: string; description: string; unavailable: boolean;
  hasRadio: boolean; radioChecked: boolean; hasQuantity: boolean; quantity: string;
}

interface RandomPolicy { quantities: number[]; radioOnly: boolean; limitWatts: boolean }

/** How a random pick behaves per component category (the category, never the model). */
function randomPolicy(sectionName: string): RandomPolicy {
  if (/^processors?$/i.test(sectionName.trim())) return { quantities: [1, 2], radioOnly: false, limitWatts: true };
  if (/^memory$/i.test(sectionName.trim())) return { quantities: [1, 2], radioOnly: false, limitWatts: false };
  if (/^smart\s*chassis$/i.test(sectionName.trim())) return { quantities: [1], radioOnly: true, limitWatts: false };
  return { quantities: [1], radioOnly: false, limitWatts: false };
}

/** Sections whose missing selection the engine may fill at random during error recovery. */
const RANDOMIZED_SECTIONS = /^(processors?|memory|smart\s*chassis|power\s*suppl(?:y|ies))$/i;

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

export class ComponentEngine {
  private readonly quantities: QuantityHandler;
  private readonly radios = new RadioHandler();
  private readonly configurations: ConfigurationHandler;
  private readonly dependencies: AutomaticDependencyHandler;

  constructor(private readonly page: Page, snapshot?: PageSnapshot) {
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

  /** Lists the model's menu sections by title; hidden sections are not offered for this model. */
  async sections(): Promise<Array<MenuSection & { visible: boolean }>> {
    const found = await this.page.locator('[id^="section_header_"]').evaluateAll((headers) => headers.map((header) => {
      const copy = header.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('i, .section_counter, .section_status, .section_toggle').forEach((node) => node.remove());
      return {
        key: header.id.slice('section_header_'.length),
        title: (copy.textContent ?? '').replace(/\s+/g, ' ').trim(),
        visible: header.getClientRects().length > 0 && getComputedStyle(header).visibility !== 'hidden',
      };
    }));
    return found.filter((section, index) => section.key && found.findIndex((other) => other.key === section.key) === index);
  }

  /** Finds a visible section by its title: exact first, then one whose title contains every word. */
  async findSection(sectionName: string): Promise<MenuSection | null> {
    const wanted = normalize(sectionName);
    const words = wanted.match(/[a-z0-9]+/g) ?? [];
    const visible = (await this.sections()).filter((section) => section.visible);
    const match = visible.find((section) => normalize(section.title) === wanted)
      ?? visible.find((section) => words.length > 0 && words.every((word) => normalize(section.title).includes(word)));
    return match ? { key: match.key, title: match.title } : null;
  }

  /** Choices of a section in page order, with their item-row counts. */
  async choices(section: MenuSection): Promise<MenuChoice[]> {
    return this.page.evaluate((key) => {
      const order: string[] = [];
      const titles = new Map<string, string>();
      const counts = new Map<string, number>();
      document.querySelectorAll(`[id^="choice_title_${key}_"]`).forEach((node) => {
        const id = node.id.slice('choice_title_'.length);
        if (!titles.has(id)) { order.push(id); titles.set(id, (node.textContent ?? '').replace(/\s+/g, ' ').trim()); }
      });
      document.querySelectorAll('tr.item_tr').forEach((row) => {
        const element = row.getAttribute('data-elementid') ?? '';
        const marker = row.id.indexOf(`_${key}_`);
        const id = element.startsWith(`${key}_`) ? element : marker >= 0 ? row.id.slice(marker + 1) : '';
        if (!id) return;
        if (!titles.has(id) && !counts.has(id)) order.push(id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      });
      return order.map((id) => ({ id, title: titles.get(id) ?? '', rows: counts.get(id) ?? 0 }));
    }, section.key);
  }

  /**
   * The section's main choice: the one titled like the section (Processor, Memory, Power Supplies),
   * else one whose title contains the section title or is contained in it, else the first with rows
   * (Smart Chassis: "Top Selling Smart Chassis Combinations").
   */
  async mainChoice(section: MenuSection): Promise<MenuChoice | null> {
    const withRows = (await this.choices(section)).filter((choice) => choice.rows > 0);
    const title = normalize(section.title);
    return withRows.find((choice) => normalize(choice.title) === title)
      ?? withRows.find((choice) => choice.title && (normalize(choice.title).includes(title) || title.includes(normalize(choice.title))))
      ?? withRows[0] ?? null;
  }

  choiceRows(choiceId: string): Locator {
    return this.page.locator(`tr.item_tr[data-elementid=${JSON.stringify(choiceId)}], tr.item_tr[id$=${JSON.stringify(`_${choiceId}`)}]`);
  }

  /** OCA headers carry no expanded state, and clicking an open header collapses it. Visible content = open. */
  async isOpen(section: MenuSection): Promise<boolean> {
    return await this.page.locator([
      `[id^="choice_header_${section.key}_"]`,
      `tr.item_tr[data-elementid^="${section.key}_"]`,
      `tr.item_tr[id*="_${section.key}_"]`,
    ].join(', ')).filter({ visible: true }).count() > 0;
  }

  async openSection(sectionName: string): Promise<MenuSection> {
    const section = await this.findSection(sectionName);
    if (!section) throw new UnsupportedComponentError(`Section ${sectionName} is not offered for this model`);
    await this.open(section);
    return section;
  }

  private async open(section: MenuSection): Promise<void> {
    if (await this.isOpen(section)) return;
    const header = this.page.locator(`[id=${JSON.stringify(`section_header_${section.key}`)}]`).first();
    await expect(header, `Section ${section.title}`).toBeVisible({ timeout: 60_000 });
    await header.scrollIntoViewIfNeeded();
    await header.click({ force: true });
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

  private async rowInfo(rows: Locator): Promise<RowInfo[]> {
    return rows.evaluateAll((elements) => elements.map((row) => {
      const radio = row.querySelector('input[type="radio"]') as HTMLInputElement | null;
      const select = row.querySelector('td.item_qty select') as HTMLSelectElement | null;
      const input = row.querySelector('td.item_qty input[type="number"], td.item_qty input[type="text"]') as HTMLInputElement | null;
      const display = row.querySelector('td.item_qty .item_qty_div');
      // Read only the committed quantity, never hidden menu digits elsewhere in the cell.
      const quantity = select ? (select.selectedOptions[0]?.textContent ?? select.value)
        : input ? input.value : (display?.textContent ?? '');
      return {
        id: row.id,
        productNumber: (row.querySelector('._pid')?.textContent ?? '').trim(),
        description: (row.querySelector('.item_desc')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        unavailable: /(^|\s)unavailable(\s|$)/.test(row.className),
        hasRadio: Boolean(radio),
        radioChecked: Boolean(radio?.checked),
        hasQuantity: Boolean(select || input || display),
        quantity: quantity.replace(/\s+/g, ' ').trim(),
      };
    }));
  }

  private committedQuantity(row: RowInfo): number {
    if (/^\d+$/.test(row.quantity)) return Number(row.quantity);
    return !row.quantity && row.radioChecked ? 1 : 0;
  }

  /** The product already selected in a choice, if any. */
  async existingSelection(choiceId: string): Promise<Selection | null> {
    const rows = await this.rowInfo(this.choiceRows(choiceId).filter({ visible: true }));
    const selected = rows.find((row) => row.productNumber && this.committedQuantity(row) > 0);
    return selected
      ? { productNumber: selected.productNumber, description: selected.description, quantity: this.committedQuantity(selected) }
      : null;
  }

  /**
   * Picks a random product in the section's main choice, keeping any product OCA already
   * selected there. Works for any section; the category only sets the quantity policy.
   */
  async selectRandom(sectionName: string): Promise<Selection> {
    const section = await this.openSection(sectionName);
    const choice = await this.mainChoice(section);
    if (!choice) throw new UnsupportedComponentError(`Section ${section.title} has no choice with product rows`);
    const existing = await this.existingSelection(choice.id);
    if (existing) {
      console.log(`[INFO] ${section.title} ${existing.productNumber} x${existing.quantity} is already selected; leaving it unchanged`);
      return existing;
    }
    const policy = randomPolicy(sectionName);
    const columns = this.page.locator(`[id=${JSON.stringify(`choice_column_titles_${choice.id}`)}]`).filter({ visible: true }).first();
    if (await columns.isVisible().catch(() => false)) {
      await columns.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    }
    const rows = await this.rowInfo(this.choiceRows(choice.id).filter({ visible: true }));
    const overLimit: string[] = [];
    const available = rows.filter((row) => {
      if (!row.id || !row.productNumber || row.unavailable || isMemoryBlankProduct(row.description)) return false;
      if (policy.radioOnly ? !row.hasRadio : !(row.hasQuantity || row.hasRadio)) return false;
      const watts = Number(row.description.match(/(\d+)\s*W\b/i)?.[1]);
      if (policy.limitWatts && watts > MAX_RANDOM_PROCESSOR_WATTS) { overLimit.push(`${row.productNumber} ${watts}W`); return false; }
      return true;
    });
    if (overLimit.length) {
      console.log(`[INFO] Random ${section.title} skips ${overLimit.length} product(s) over ${MAX_RANDOM_PROCESSOR_WATTS}W: ${overLimit.join(', ')}`);
    }
    if (!available.length) {
      throw new UnsupportedComponentError(`No selectable ${section.title} product in "${choice.title || choice.id}"`
        + ` (visible rows: ${rows.length}${policy.limitWatts ? `; over ${MAX_RANDOM_PROCESSOR_WATTS}W: ${overLimit.length}` : ''})`);
    }
    return this.tryRandomCandidates(section.title, available.map((row) => ({
      row: this.page.locator(`[id=${JSON.stringify(row.id)}]`), productNumber: row.productNumber, description: row.description,
    })), async (candidate) => {
      if (policy.radioOnly) {
        await this.radios.select(candidate.row, candidate.description || candidate.productNumber);
        await waitForBlockingOverlay(this.page);
        await this.quantities.verify(candidate.row, candidate.productNumber, 1);
        return { productNumber: candidate.productNumber, description: candidate.description, quantity: 1 };
      }
      const wanted = policy.quantities[Math.floor(Math.random() * policy.quantities.length)];
      const quantity = await this.quantities.set(candidate.row, candidate.productNumber, wanted, true, { acceptOffered: true });
      return { productNumber: candidate.productNumber, description: candidate.description, quantity };
    });
  }

  private async tryRandomCandidates<T extends { row: Locator; productNumber: string }, R>(
    section: string, candidates: T[], select: (candidate: T) => Promise<R>,
  ): Promise<R> {
    const remaining = [...candidates];
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

  /** Applies one instruction. A section this model does not offer is skipped, never failed. */
  async executeGeneric(instruction: ComponentInstruction): Promise<ExecutionOutcome> {
    const section = await this.findSection(instruction.section);
    if (!section) return 'skipped';
    await this.open(section);
    const product = instruction.productNumber;
    switch (instruction.selectionType) {
      case 'radio': await this.selectRadioProduct(product!, instruction.description); break;
      case 'quantity': await this.setProductQuantity(product!, instruction.quantity!, instruction.description); break;
      case 'random': {
        const selected = await this.selectRandom(instruction.section);
        instruction.productNumber = selected.productNumber;
        instruction.quantity = selected.quantity;
        instruction.description = selected.description || instruction.description;
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
    return 'done';
  }

  /**
   * Opens a section OCA flagged with an error and fills a missing selection. Component
   * categories get a random product (kept when one is already selected: then the error
   * is an OCA rule, which resolveConfigurationErrors reports with OCA's own message).
   */
  async satisfyRequiredSection(sectionName: string): Promise<void> {
    if (RANDOMIZED_SECTIONS.test(sectionName.trim())) { await this.selectRandom(sectionName); return; }
    await this.openSection(sectionName);
    if (!await this.satisfyVisibleRequiredControl()) {
      throw new UnsupportedComponentError(`No selectable required control was found in error section ${sectionName}`);
    }
  }

  /** Handles required dropdowns/rows not represented by an instruction. */
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
}

import { expect, type Locator, type Page } from '@playwright/test';
import type { ComponentInstruction } from '../models/component-instruction';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';
import { revealForViewer } from '../core/interactions';
import { QuantityHandler } from '../components/quantity-handler';
import { RadioHandler } from '../components/radio-handler';
import { ConfigurationHandler } from '../components/configuration-handler';
import { AutomaticDependencyHandler } from '../components/automatic-dependency-handler';
import type { PageSnapshot } from '../reporting/html-capture';
import { dismissOcaMessageDialogs, ocaProblemMessage } from '../core/oca-problem';
import { OcaPageLoadError } from './configuration-errors';
import { MandatorySelectionError } from '../core/errors';

export class UnsupportedComponentError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedComponentError'; }
}

/**
 * Random processor picks stay at or below this power (OCA_MAX_RANDOM_CPU_WATTS, default 270).
 * Above it, OCA pairs the CPU with a Performance heatsink, and its rule then requires an OCP
 * Enablement Kit for 1G/10G OCP cards. Processors given explicitly are not limited.
 */
export const MAX_RANDOM_PROCESSOR_WATTS = Number(process.env.OCA_MAX_RANDOM_CPU_WATTS ?? 270);

/**
 * Model-like words in OCA text: tokens holding both a letter and a digit, such as
 * MR416i, 8SFF, x1, 2P or 1-port. Used to match products a rule describes by name.
 */
export function modelWords(text: string): string[] {
  const isModelWord = (word: string) => /[a-z]/.test(word) && /\d/.test(word);
  return [...new Set(text.toLowerCase().split(/[^a-z0-9.-]+/)
    .map((word) => word.replace(/^[.-]+|[.-]+$/g, ''))
    // "MR416i-o" also counts as "MR416i"; "1-port" stays whole.
    .flatMap((word) => [word, ...word.split('-')])
    .filter(isModelWord))];
}

/**
 * True when a rule word is OCA's abbreviation of a description word: same first letter and its
 * letters in order ("ht" → hot, "plg" → plug, "opt" → optimized, "dev" → device).
 */
export function abbreviates(short: string, word: string): boolean {
  if (!short || short[0] !== word[0]) return false;
  let matched = 0;
  for (const letter of word) if (letter === short[matched]) matched += 1;
  return matched === short.length;
}

/**
 * How many words of an OCA phrase ("NS204i-u Ht Plg Boot Opt Dev") a product description has, exactly
 * or as abbreviations ("HPE NS204i-u v2 480GB NVMe Hot Plug Boot Optimized Storage Device" → 6).
 */
export function phraseScore(phrase: string, description: string): number {
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9-]+/)
    .filter((word) => word.length > 1 && !GENERIC_WORDS.has(word));
  const described = words(description);
  return words(phrase).filter((word) => described.some((other) => other === word
    || (/^[a-z]+$/.test(word) && /^[a-z]+$/.test(other) && abbreviates(word, other)))).length;
}

/** Words of an OCA phrase that count for phraseScore. */
export function phraseWordCount(phrase: string): number {
  return phraseScore(phrase, phrase);
}

/** Candidates a repair tries before giving up (the model is then retried with fresh picks). */
// Products OCA offers only at 0 are skipped in seconds, so a long list (24 network cards) can be tried further.
const REPAIR_CANDIDATE_TRIES = 10;

/** Words too general to tie an OCA rule to a choice title. */
const GENERIC_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'with', 'per', 'must', 'be', 'selected', 'select',
  'option', 'options', 'min', 'max', 'qty', 'kit', 'server', 'cto']);

/**
 * Distinctive words of a choice title or rule text, e.g. "Ethernet PCIe" → ethernet, pcie. Used to
 * find the choices a rule means when it names a group ("Networking (PCIe or OCP)"), not products.
 */
export function titleWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !/^\d+$/.test(word) && !GENERIC_WORDS.has(word)))];
}

/** True when text names a part number as a whole word ("(P80429-B21)"), not inside a longer name ("NS204i-u"). */
export function mentionsProduct(text: string, productNumber: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(productNumber)}(?![A-Za-z0-9-])`, 'i').test(text);
}

/** A kind of product an OCA rule requires, with a test on product descriptions. */
export interface RequiredKind { name: string; matches: (description: string) => boolean }

/** The power in a processor description ("... 24-core 225W Processor for HPE"), or NaN. */
export function processorWatts(description: string): number {
  return Number(description.match(/(\d+)\s*W\b/i)?.[1]);
}

/**
 * The processor power an OCA rule limits: "If Processor more than 240W and less than or equal to 500W is
 * selected then Performance heat sink OR DLC Module must be selected" (P81948-B21, DL345 Gen12). OCA had
 * preselected a 390W processor and its Performance heat sink was unavailable; a processor of at most
 * 240W needs neither.
 */
export function requiredProcessorWatts(text: string): RequiredKind | null {
  const limit = Number(text.match(/\bprocessors?\s+(?:more|greater)\s+than\s+(\d+)\s*W\b/i)?.[1]);
  if (!limit) return null;
  return { name: `a processor of at most ${limit}W`, matches: (description) => processorWatts(description) <= limit };
}

/** The kind of product a rule requires, if it names one. */
export function requiredKind(text: string): RequiredKind | null {
  return requiredProcessorSeries(text) ?? requiredMemorySpeed(text) ?? requiredProcessorWatts(text);
}

/**
 * The processor series an OCA rule requires: "20EDSFF DA cbl kit ... is supported only with 6XX1P
 * processor series" (P75217-B21, DL320 Gen12) or "Front 4xGPU Enable kit can be selected only if 6XX1P
 * processor is selected" (P75728-B21, DL340 Gen12). X stands for a digit, so 6XX1P matches "Intel Xeon
 * 6521P". OCA also writes "6XXX1P" for the same series, so a run of Xs matches up to that many digits.
 */
export function requiredProcessorSeries(text: string): RequiredKind | null {
  const name = text.match(/\b(\d*X+[\dX]*[A-Z]*)\s+processors?\b/)?.[1];
  if (!name || !/\d/.test(name)) return null;
  const source = name.replace(/X+/g, (run) => `\\d{1,${run.length}}`);
  const pattern = new RegExp(`\\b${source}\\b`);
  return { name: `a ${name} processor`, matches: (description) => pattern.test(description) };
}

/**
 * The memory speed an OCA rule requires: "Supports only PC5-4800B Memory." (P55438-B21, DL320 Gen11).
 * OCA's memory descriptions give the speed as "DDR5-4800", so PC5-4800B matches DDR5-4800 kits.
 */
export function requiredMemorySpeed(text: string): RequiredKind | null {
  const match = text.match(/\bsupports?\s+only\s+(?:PC|DDR)(\d)-(\d{4})[A-Z]?\s+memory\b/i);
  if (!match) return null;
  const pattern = new RegExp(`\\bDDR${match[1]}-${match[2]}\\b`, 'i');
  return { name: `DDR${match[1]}-${match[2]} memory`, matches: (description) => pattern.test(description) };
}

/** Blank and filler kits are never chosen at random. */
/** A memory slot filler: "HPE DDR4 DIMM Blank Kit" (P07818-B21), choice "Memory Blank Kit". Not memory. */
export function isDimmBlank(text: string): boolean {
  return /\b(?:DIMM|memory)\s+blank\b/i.test(text);
}

export function isMemoryBlankProduct(description: string): boolean {
  return /\b(?:memory\s+)?blank(?:\s+kit)?\b/i.test(description);
}

/**
 * A component menu section as OCA renders it for every model:
 * `#section_header_<key>` holds the visible title; each choice in it has `#choice_title_<choice>`
 * and item rows `tr.item_tr[data-elementid="<choice>"]` (row ids end in `_<choice>`), where
 * `<choice>` starts with `<key>_`. Keys and choice ids differ between models; titles do not.
 */
/** A section; choiceId is set when the section was found through a choice of that title. */
export interface MenuSection { key: string; title: string; choiceId?: string }
export interface MenuChoice { id: string; title: string; rows: number }
export interface Selection { productNumber: string; description: string; quantity: number }
export type ExecutionOutcome = 'done' | 'skipped';

interface RowInfo {
  id: string; productNumber: string; description: string; unavailable: boolean;
  hasRadio: boolean; radioChecked: boolean; hasQuantity: boolean; quantity: string; visible: boolean;
}

/** A row recovery may pick: a visible, available product with a quantity or radio control. */
function isPickable(row: RowInfo): boolean {
  return Boolean(row.id && row.productNumber && row.visible && !row.unavailable
    && !isMemoryBlankProduct(row.description) && (row.hasQuantity || row.hasRadio));
}

interface RandomPolicy { quantities: number[]; radioOnly: boolean; limitWatts: boolean }

/** An OCA error rule on a choice: its text, its own words, the choices it links and the products it names. */
export interface OcaRule {
  text: string; ownText: string; targets: string[];
  products: Array<{ choiceId: string; productNumber: string }>;
}

/** Rules that forbid the products they name ("cannot be selected", "NOT allowed", "Supported with ... Only", "Max 2"). */
const FORBIDDING_RULE = /\b(?:cannot|can\s*not|must\s+not)\s+be\s+selected\b|\bnot\s+(?:allowed|supported)\b|\bonly\b|\bmax(?:imum)?\b/i;

/** A quantity range OCA states for one choice (from its "User Selection: Min/Max" and odd-quantity rules). */
export interface QuantityRule { min: number; max: number; even: boolean }

/** The nearest quantity at or above the wanted one that satisfies the rule (or the highest allowed). */
export function fitQuantity(quantity: number, rule: QuantityRule): number {
  let value = Math.max(quantity, rule.min);
  if (rule.even && value % 2) value += 1;
  if (value > rule.max) value = rule.even && rule.max % 2 ? rule.max - 1 : rule.max;
  return value;
}

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

  /**
   * Fails when OCA's Menu tab has no component sections: the configuration did not load. On
   * P72176-B21 the Menu panel was empty behind OCA's error dialog ("Widget does not exist on current
   * page: extended_overview:menu"), every component was then skipped as "not offered", and the run
   * only failed later at the BOM tab. Every CTO server menu has section headers.
   */
  async ensureMenuLoaded(timeoutMs = 30_000): Promise<void> {
    const loaded = await this.page.locator('[id^="section_header_"]').first()
      .waitFor({ state: 'attached', timeout: timeoutMs }).then(() => true, () => false);
    if (loaded) return;
    const problem = await ocaProblemMessage(this.page);
    throw new OcaPageLoadError(`OCA's Menu tab has no component sections; the configuration did not load${problem ? `. OCA error: ${problem}` : ''}`);
  }

  /**
   * The product selected in a mandatory section (Processor, Memory). Fails with
   * MandatorySelectionError when nothing is selected in its main choice, so the configuration is
   * never saved without it. A model whose Menu has no such section (P86628-B21, DL110 Gen12: the
   * processor is part of the base server, OCA shows no Processor section) has nothing to select
   * there; that is logged and null returned. An empty Menu fails earlier, in ensureMenuLoaded.
   */
  async mandatorySelection(sectionName: string): Promise<Selection | null> {
    const section = await this.findSection(sectionName);
    if (!section) {
      console.log(`[WARN] OCA offers no ${sectionName} section for this model (part of the base server); nothing to check`);
      return null;
    }
    await this.open(section);
    const choice = await this.mainChoice(section);
    const existing = choice ? await this.existingSelection(choice.id) : null;
    if (!existing) throw new MandatorySelectionError(`${sectionName} is mandatory, but nothing is selected in ${section.title}; the configuration was not saved`);
    console.log(`[INFO] Mandatory ${sectionName}: ${existing.productNumber} x${existing.quantity}`);
    return existing;
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

  /**
   * Finds a visible section by its title: exact first, then one whose title contains every word.
   * Failing that, a choice with that title identifies its section: on a DL580 Gen12 the
   * "Power Supplies" choice sits in a section titled "Power and Cooling".
   */
  async findSection(sectionName: string): Promise<MenuSection | null> {
    const wanted = normalize(sectionName);
    const words = wanted.match(/[a-z0-9]+/g) ?? [];
    const visible = (await this.sections()).filter((section) => section.visible);
    const match = visible.find((section) => normalize(section.title) === wanted)
      ?? visible.find((section) => words.length > 0 && words.every((word) => normalize(section.title).includes(word)));
    if (match) return { key: match.key, title: match.title };
    const titledChoices = await this.page.locator('[id^="choice_title_"]').evaluateAll((nodes) => nodes.map((node) => ({
      id: node.id.slice('choice_title_'.length), title: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })));
    for (const choice of titledChoices.filter((item) => normalize(item.title) === wanted)) {
      // The owning section's key is the longest key that prefixes the choice id.
      const owner = visible.filter((section) => choice.id.startsWith(`${section.key}_`))
        .sort((a, b) => b.key.length - a.key.length)[0];
      if (owner) return { key: owner.key, title: owner.title, choiceId: choice.id };
    }
    return null;
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
    // "Memory Blank Kit" (P07818-B21, preselected by OCA) is never the Memory choice: a blank kit
    // fills empty slots and is not memory.
    const withRows = (await this.choices(section)).filter((choice) => choice.rows > 0 && !isDimmBlank(choice.title));
    const named = withRows.find((choice) => choice.id === section.choiceId);
    if (named) return named;
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
    if (await this.opened(section)) return;
    // S3V83A: "Controller Node Models" stayed collapsed after the click on the header row's centre.
    // A DOM click on the header's title element does not depend on what is drawn over the row.
    console.log(`[WARN] Section ${section.title} did not open; clicking its title`);
    await header.locator('.section_header_div').first().evaluate((element) => (element as HTMLElement).click())
      .catch(() => header.evaluate((element) => (element as HTMLElement).click()));
    await waitForBlockingOverlay(this.page);
    if (!await this.opened(section)) console.log(`[WARN] Section ${section.title} still shows no choices after opening`);
  }

  /** Waits briefly for a section's content to show after it was clicked open. */
  private async opened(section: MenuSection): Promise<boolean> {
    return expect.poll(() => this.isOpen(section), { timeout: 5_000 }).toBe(true).then(() => true, () => false);
  }

  /**
   * Selects one random product with the quantity (or the nearest OCA offers) in a section's choice
   * named by its title (the section's main choice when no title is given). Used for solution menus
   * such as S3V83A: "Controller Node Models" → "Node Chassis" and "Node". A choice can appear only
   * after an earlier selection (Node after Node Chassis), so its rows are awaited.
   */
  async selectInChoice(sectionName: string, choiceTitle: string | undefined, quantity: number): Promise<Selection & { choiceTitle: string }> {
    // A section can appear only after an earlier selection (S3V83A: Capacity after Drive Enclosure).
    let found: MenuSection | null = null;
    await expect.poll(async () => Boolean(found = await this.findSection(sectionName)), {
      timeout: 60_000, message: `Section ${sectionName}`,
    }).toBe(true);
    const section = found as unknown as MenuSection;
    await this.open(section);
    let choice: MenuChoice | null = null;
    await expect.poll(async () => {
      const all = (await this.choices(section)).filter((item) => item.rows > 0);
      choice = choiceTitle ? all.find((item) => normalize(item.title) === normalize(choiceTitle)) ?? null : await this.mainChoice(section);
      return Boolean(choice);
    }, { timeout: 60_000, message: `${section.title} choice ${choiceTitle ?? '(main)'}` }).toBe(true);
    const target = choice as unknown as MenuChoice;
    await this.open(section);
    let rows: RowInfo[] = [];
    await expect.poll(async () => (rows = (await this.rowInfo(this.choiceRows(target.id))).filter(isPickable)).length, {
      timeout: 60_000, message: `Selectable rows of ${section.title} / ${target.title || target.id}`,
    }).toBeGreaterThan(0);
    const label = `${section.title}${target.title && normalize(target.title) !== normalize(section.title) ? ` / ${target.title}` : ''}`;
    const picked = await this.tryRandomCandidates(label, rows.map((row) => ({
      row: this.page.locator(`[id=${JSON.stringify(row.id)}]`), productNumber: row.productNumber, description: row.description,
    })), async (candidate) => {
      const set = await this.quantities.set(candidate.row, candidate.productNumber, quantity, false, { acceptOffered: true });
      // The quantity asked for is a default (solution Menu: Capacity 16, DAC Cables 8); the choice's own OCA
      // rule ("Minimum N ...", "User Selection: Min // Max") decides when it states another range.
      const committed = await this.enforceQuantityRule(target.id, candidate.row, candidate.productNumber, set);
      return { productNumber: candidate.productNumber, description: candidate.description, quantity: committed };
    }, REPAIR_CANDIDATE_TRIES);
    console.log(`[STEP] ${label}: ${picked.productNumber} x${picked.quantity}`);
    return { ...picked, choiceTitle: target.title };
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
        visible: row.getClientRects().length > 0,
      };
    }));
  }

  private committedQuantity(row: RowInfo): number {
    if (/^\d+$/.test(row.quantity)) return Number(row.quantity);
    return !row.quantity && row.radioChecked ? 1 : 0;
  }

  /** The product already selected in a choice, if any, with its row id. */
  async existingSelection(choiceId: string): Promise<(Selection & { rowId: string }) | null> {
    const rows = await this.rowInfo(this.choiceRows(choiceId).filter({ visible: true }));
    // A blank kit never counts as a selection (it is not memory).
    const selected = rows.find((row) => row.productNumber && this.committedQuantity(row) > 0 && !isDimmBlank(row.description));
    return selected
      ? { productNumber: selected.productNumber, description: selected.description, quantity: this.committedQuantity(selected), rowId: selected.id }
      : null;
  }

  /**
   * OCA's quantity rule for one choice, read from its error messages. Each rule is an
   * li.message_li whose error_message links (a.err-lnk, id = choice id) list the choices it
   * covers; only rules covering this choice alone are used, e.g. on DL580 Gen12:
   * "(User Selection: Min 2 // Max 4) Odd quantities of processor selection is not allowed. (Processor)".
   */
  async quantityRule(choiceId: string, description = ''): Promise<QuantityRule | null> {
    let rule: QuantityRule | null = null;
    const title = await this.page.locator(`[id=${JSON.stringify(`choice_title_${choiceId}`)}]`).first()
      .textContent({ timeout: 1_000 }).catch(() => '') ?? '';
    for (const { text, targets } of await this.choiceRules(choiceId)) {
      // "If Secondary riser is selected, then 2 Processor must be selected. (Riser Cards, Processors)" (P67161-B21,
      // DL365 Gen11): a rule over several choices sets this choice's minimum when its words name this choice.
      const then = targets.includes(choiceId) ? text.match(/\bthen\s+(\d+)\s+(?!qty\b|of\b)(.+?)\s+must\s+be\s+selected/i) : null;
      const counted = then && phraseScore(then[2], title) > 0 ? Number(then[1]) : 0;
      if (targets.length !== 1 || targets[0] !== choiceId) {
        if (!counted) continue;
        rule ??= { min: 0, max: Number.POSITIVE_INFINITY, even: false };
        rule.min = Math.max(rule.min, counted);
        continue;
      }
      const range = text.match(/User Selection:\s*Min\s*(\d+)\s*\/\/\s*Max\s*(\d+)/i);
      const even = /odd quantit(?:y|ies)\b[^.]*\bnot allowed/i.test(text);
      // "... then the drive cage quantity must be Qty 2" (P83540-B21, 8EDSFF in 2P).
      const exact = text.match(/quantity must be\s*(?:qty\s*)?(\d+)/i);
      // "Minimum 2 and Maximum 2 of M.2 SSD Drive must be selected." (P86628-B21, DL110 Gen12).
      // Product names can contain dots ("M.2"), so the words between are matched lazily, not as [^.]*.
      const bounds = text.match(/Minimum\s*(\d+)\s*and\s*Maximum\s*(\d+)\s*of\b.*?\bmust be selected/i);
      // "If this NVMe Trigger is selected, then Qty2 Processors must be selected. (Processor)" (S3V83A's
      // DL380 Gen12): at least that many of this choice. "Qty1 of P51083-B21 … must be selected" names
      // another product and is left to the other repairs.
      const atLeast = text.match(/(?:^|\bthen\s+)Qty\s*=?\s*(\d+)\b(?!\s*of\b).*?\bmust be selected/i);
      // "Minimum 2 Processor must be selected", "Minimum 2 Heat sink is required" (S3N87AAE, DL380 Gen11);
      // "Min 1/Max 1" and "Minimum 2 and Maximum 2" are ranges, read above.
      const minimum = text.match(/\bMin(?:imum)?\s*=?\s*(\d+)\b(?!\s*(?:\/|and\b))[^/]*?\b(?:(?:must|should)\s+be\s+selected|is\s+required)\b/i);
      // "For ALL CTO models (vSAN solutions), the Total memory capacity must total 256GB or higher." (P52536-B21,
      // DL380 Gen11): enough kits of the selected size ("HPE 32GB (1x32GB) ...") to reach it.
      const capacity = Number(text.match(/\btotal\s+memory\s+capacity\s+must\s+(?:total|be)\s+(\d+)\s*GB\s+or\s+(?:higher|more)\b/i)?.[1]);
      const kitSize = Number(description.match(/\b(\d+)\s*GB\b/i)?.[1]);
      const kits = capacity && kitSize ? Math.ceil(capacity / kitSize) : 0;
      if (!range && !even && !exact && !bounds && !atLeast && !minimum && !kits) continue;
      rule ??= { min: 0, max: Number.POSITIVE_INFINITY, even: false };
      if (range) { rule.min = Math.max(rule.min, Number(range[1])); rule.max = Math.min(rule.max, Number(range[2])); }
      if (bounds) { rule.min = Math.max(rule.min, Number(bounds[1])); rule.max = Math.min(rule.max, Number(bounds[2])); }
      if (exact) { rule.min = Math.max(rule.min, Number(exact[1])); rule.max = Math.min(rule.max, Number(exact[1])); }
      if (atLeast) rule.min = Math.max(rule.min, Number(atLeast[1]));
      if (minimum) rule.min = Math.max(rule.min, Number(minimum[1]));
      if (kits) rule.min = Math.max(rule.min, kits);
      rule.even ||= even;
    }
    return rule;
  }

  /**
   * OCA's error-level rules shown on a choice: each li.message_li's text and the choice ids
   * its a.err-lnk links name (the choices the rule covers).
   */
  async choiceRules(choiceId: string): Promise<OcaRule[]> {
    return this.page.locator(`[id=${JSON.stringify(`choice_header_${choiceId}`)}] li.message_li .error_message`)
      .evaluateAll((spans) => spans.map((span) => {
        // ownText leaves out the linked choice titles, which every rule lists after its own words.
        const own = span.cloneNode(true) as HTMLElement;
        own.querySelectorAll('a.err-lnk').forEach((link) => link.remove());
        const links = Array.from(span.querySelectorAll('a.err-lnk'));
        return {
          text: (span.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ownText: (own.textContent ?? '').replace(/\(\s*(?:,\s*)*\)/g, '').replace(/\s+/g, ' ').trim(),
          targets: links.map((link) => link.id),
          // A link may name one product of the choice: "P58456-B21 (Heatsink Kit)".
          products: links.map((link) => ({
            choiceId: link.id,
            productNumber: (link.textContent ?? '').trim().match(/^([A-Z0-9][A-Z0-9#-]*\d[A-Z0-9#-]*)\s*\(/i)?.[1] ?? '',
          })).filter((product) => product.productNumber),
        };
      }));
  }

  /** Choices of a section whose status icon OCA shows as an error (img-alert). */
  async flaggedChoices(section: MenuSection): Promise<MenuChoice[]> {
    const choices = await this.choices(section);
    const flagged = await this.page.evaluate((ids) => ids.filter((id) =>
      document.getElementById(`choice_status_icon_${id}`)?.classList.contains('img-alert')), choices.map((choice) => choice.id));
    return choices.filter((choice) => flagged.includes(choice.id));
  }

  /** The visible section that owns a choice id (longest key that prefixes it). */
  private async owningSection(choiceId: string): Promise<MenuSection | null> {
    const owner = (await this.sections()).filter((section) => section.visible && choiceId.startsWith(`${section.key}_`))
      .sort((a, b) => b.key.length - a.key.length)[0];
    return owner ? { key: owner.key, title: owner.title } : null;
  }

  /**
   * Fills a flagged choice that has no selection. Prefers the products OCA's message names
   * (e.g. "At-least one option from the below list must be selected - 8SFF x1 Drive Cage
   * (P80429-B21) ..."), taken from the choices that message covers; otherwise, when allowed,
   * any available product of the choice. Returns false when there is nothing to fill.
   */
  private async repairFlaggedChoice(choice: MenuChoice, allowUnnamed: boolean): Promise<boolean> {
    const existing = await this.existingSelection(choice.id);
    if (existing) {
      // A selection is present: only its quantity can be brought into OCA's rule here.
      const quantity = await this.enforceQuantityRule(choice.id, this.page.locator(`[id=${JSON.stringify(existing.rowId)}]`),
        existing.productNumber, existing.quantity);
      return quantity !== existing.quantity;
    }
    const rules = await this.choiceRules(choice.id);
    await this.openOwners([choice.id, ...rules.flatMap((rule) => rule.targets)]);
    const candidates = new Map<string, RowInfo & { choiceId: string }>();
    for (const rule of rules) {
      for (const target of new Set([choice.id, ...rule.targets])) {
        for (const row of await this.rowInfo(this.choiceRows(target))) {
          if (isPickable(row) && mentionsProduct(rule.text, row.productNumber)) candidates.set(row.id, { ...row, choiceId: target });
        }
      }
    }
    let source = candidates.size ? 'the products OCA names' : '';
    if (!candidates.size) {
      // OCA often names products by model words instead ("1-port/2-port PCIe/OROC TM controller
      // (MR416i / MR216i / MR408i)"); keep this choice's products whose descriptions share the most.
      const ruleWords = new Set(rules.flatMap((rule) => modelWords(rule.text)));
      const rows = (await this.rowInfo(this.choiceRows(choice.id))).filter(isPickable)
        .map((row) => ({ row, score: modelWords(row.description).filter((word) => ruleWords.has(word)).length }));
      const best = Math.max(0, ...rows.map((item) => item.score));
      if (best > 0) {
        for (const { row, score } of rows) if (score === best) candidates.set(row.id, { ...row, choiceId: choice.id });
        source = `the products matching OCA's message (${[...ruleWords].join(' ')})`;
      }
    }
    // "Minimum one heatsink kit must be selected (Heatsink Kit)" (S8J34A, SimpliVity 325 Gen12): the
    // choice's own rule asks for any one of its products; "Minimum 2 Heat sink is required" (S3N87AAE) for two,
    // which the choice's quantity rule then sets.
    const ownMinimum = rules.some((rule) => rule.targets.length === 1 && rule.targets[0] === choice.id
      && /\b(?:minimum|min|at[- ]least)\s*=?\s*(?:one|\d+)\b.*?\b(?:(?:must|should)\s+be\s+selected|is\s+required)\b/i.test(rule.text));
    if (!candidates.size && (allowUnnamed || ownMinimum)) {
      for (const row of await this.rowInfo(this.choiceRows(choice.id))) if (isPickable(row)) candidates.set(row.id, { ...row, choiceId: choice.id });
      source = 'its available products';
    }
    if (!candidates.size) return false;
    console.log(`[STEP] Filling flagged choice "${choice.title || choice.id}" from ${source}: `
      + [...candidates.values()].map((row) => row.productNumber).join(', '));
    await this.fillOne(choice.title || choice.id, [...candidates.values()]);
    return true;
  }

  /**
   * Fills a rule that counts selections across several choices without naming products, e.g. on
   * P75220-B21 (DL320 Gen12 GPU): "Must select Min = 1 of Networking (PCIe or OCP)" and "Minimum 1
   * quantities of Graphics option must be selected per GPU CTO Server", each linking Fibre Channel
   * HBA, SAS Controller, InfiniBand PCIe, Ethernet PCIe, Graphics, and OCP Ethernet. The flagged
   * choice (SAS Controller) already had a selection, so nothing else repaired it. The rule's own
   * words pick the covered choices by title (PCIe, OCP → Ethernet PCIe, InfiniBand PCIe, OCP
   * Ethernet; Graphics → Graphics), and one product is added to one of them that has none yet.
   */
  private async repairGroupRule(choice: MenuChoice): Promise<boolean> {
    for (const rule of await this.choiceRules(choice.id)) {
      // "Qty=3 of 4EDSFF BP Kit ... only if 6XXX1P processor is selected" counts BP kits, not processors:
      // it raised the processor to 3 twelve times (P75217-B21). repairRequiredKindRule handles it.
      if (rule.targets.length < 2 || requiredKind(rule.ownText)) continue;
      const ruleWords = new Set(titleWords(rule.ownText));
      const titles = await this.page.evaluate((ids) => ids.map((id) =>
        (document.getElementById(`choice_title_${id}`)?.textContent ?? '').replace(/\s+/g, ' ').trim()), rule.targets);
      const scored = rule.targets.map((id, index) => ({
        id, title: titles[index], score: titleWords(titles[index]).filter((word) => ruleWords.has(word)).length,
      }));
      const best = Math.max(0, ...scored.map((item) => item.score));
      if (best === 0) continue;
      const named = scored.filter((item) => item.score === best);
      await this.openOwners(named.map((item) => item.id));
      // "... then Qty=2 of Ethernet OCP adapter must be selected" (P75217-B21); "Min = 1" otherwise.
      const count = Number(rule.ownText.match(/\b(?:Qty|Min)\s*=\s*(\d+)/i)?.[1] ?? 1) || 1;
      const candidates: Array<RowInfo & { choiceId: string }> = [];
      const filled: Array<Selection & { rowId: string; choiceId: string }> = [];
      for (const target of named) {
        const existing = await this.existingSelection(target.id);
        if (existing) { filled.push({ ...existing, choiceId: target.id }); continue; }
        for (const row of await this.rowInfo(this.choiceRows(target.id))) if (isPickable(row)) candidates.push({ ...row, choiceId: target.id });
      }
      const selected = filled.reduce((sum, item) => sum + item.quantity, 0);
      // Enough products are already selected: the rule wants something else; leave it to OCA's message.
      if (selected >= count) continue;
      if (filled.length === 1) {
        const [item] = filled;
        const wanted = item.quantity + count - selected;
        console.log(`[STEP] OCA rule "${rule.ownText}" needs ${count}; raising ${item.productNumber} from ${item.quantity} to ${wanted}`);
        const row = this.page.locator(`[id=${JSON.stringify(item.rowId)}]`);
        const set = await this.quantities.set(row, item.productNumber, wanted, false, { acceptOffered: true });
        await this.enforceQuantityRule(item.choiceId, row, item.productNumber, set);
        return true;
      }
      if (filled.length || !candidates.length) continue;
      console.log(`[STEP] OCA rule "${rule.ownText}" covers ${named.map((item) => item.title).join(', ')}; filling one of them`
        + `${count > 1 ? ` with quantity ${count}` : ''}: ${candidates.map((row) => row.productNumber).join(', ')}`);
      await this.fillOne(named.map((item) => item.title).join(' / '), candidates, count);
      return true;
    }
    return false;
  }

  /**
   * "In SFF CTO Server Max=1 8SFF cable kit is allowed for selection." (DL320 Gen12): more products
   * of that kind are selected in the choice than allowed (a Smart Chassis template added a PCIe and
   * an OROC 8SFF cable kit). The extra ones are set to 0, keeping a random allowed number.
   */
  private async repairMaxRule(choice: MenuChoice): Promise<boolean> {
    for (const rule of await this.choiceRules(choice.id)) {
      const match = rule.ownText.match(/\bMax\s*=\s*(\d+)\s+(.+?)\s+(?:is|are)\s+allowed\b/i);
      if (!match) continue;
      const max = Number(match[1]);
      const kind = match[2];
      const needed = phraseWordCount(kind);
      const selected = (await this.rowInfo(this.choiceRows(choice.id)))
        .filter((row) => row.productNumber && this.committedQuantity(row) > 0 && needed > 0 && phraseScore(kind, row.description) === needed);
      if (selected.length <= max) continue;
      const extra = [...selected].sort(() => Math.random() - 0.5).slice(max);
      console.log(`[STEP] OCA rule "${rule.ownText}": ${selected.length} selected; removing ${extra.map((row) => row.productNumber).join(', ')}`);
      for (const row of extra) {
        await this.quantities.set(this.page.locator(`[id=${JSON.stringify(row.id)}]`), row.productNumber, 0, false)
          .catch((error: unknown) => console.log(`[WARN] Could not remove ${row.productNumber}: ${String(error).split('\n')[0]}`));
      }
      return true;
    }
    return false;
  }

  /**
   * "NS204i-u Cbl kit requires selection of NS204i-u Ht Plg Boot Opt Dev (OS Boot Device)" (P75217-B21):
   * the choice already has the cable kit, so the plain repair leaves it alone. The products the rule
   * asks for are found by its words, abbreviations included, among the unselected rows of the
   * choices it covers, and one is added.
   */
  private async repairRequiresRule(choice: MenuChoice): Promise<boolean> {
    for (const rule of await this.choiceRules(choice.id)) {
      const requires = rule.ownText.match(/requires?\s+(?:the\s+)?selection\s+of\s+(.+?)\s*\.?\s*$/i)?.[1];
      // "Processor upto 240W is selected then 7 Qty of Standard Fan Kit must be selected" (P54960-B21, DL325 Gen11)
      // and "If 96GB or higher Memory is selected then High Performance Fan Kit must be selected" (P55432-B21, DL380
      // Gen11) sit on Processor or Memory and ask for a product of another choice. A rule naming a processor or memory
      // kind is left to repairRequiredKindRule.
      const then = requires || requiredKind(rule.ownText) ? null
        : rule.ownText.match(/\bthen\s+(?:(\d+)\s*Qty\s+of\s+)?(.+?)\s+must\s+be\s+selected\b/i);
      const wanted = requires ?? then?.[2];
      if (!wanted) continue;
      const count = Number(then?.[1] ?? 1) || 1;
      const targets = [...new Set([choice.id, ...rule.targets])];
      await this.openOwners(targets);
      const rows: Array<RowInfo & { choiceId: string; score: number; committed: number }> = [];
      for (const target of targets) {
        for (const row of await this.rowInfo(this.choiceRows(target))) {
          const committed = this.committedQuantity(row);
          // A selected product counts for a "then ... must be selected" rule: it may only need more of it.
          if (then ? row.productNumber && (isPickable(row) || committed > 0) : isPickable(row) && committed === 0) {
            rows.push({ ...row, choiceId: target, score: phraseScore(wanted, row.description), committed });
          }
        }
      }
      const best = Math.max(0, ...rows.map((row) => row.score));
      // One shared word (the model name in "NS204i-u Cbl kit") is not enough to tell the products apart.
      if (best < 2) continue;
      const top = rows.filter((row) => row.score === best);
      const selected = top.find((row) => row.committed > 0);
      if (selected) {
        if (selected.committed >= count) continue;
        console.log(`[STEP] OCA rule "${rule.ownText}" asks for ${count}; raising ${selected.productNumber} from ${selected.committed}`);
        await this.quantities.set(this.page.locator(`[id=${JSON.stringify(selected.id)}]`), selected.productNumber, count, false, { acceptOffered: true });
        return true;
      }
      const candidates = top.filter((row) => isPickable(row));
      if (!candidates.length) continue;
      console.log(`[STEP] OCA rule "${rule.ownText}" asks for ${count > 1 ? `${count} of ` : ''}${wanted}; adding one of: `
        + candidates.map((row) => row.productNumber).join(', '));
      await this.fillOne(choice.title || choice.id, candidates, count);
      return true;
    }
    return false;
  }

  /**
   * Rules that forbid products OCA names one by one. On P53934-B21 (DL365 Gen11 EDSFF, 2026-10-19) OCA's own base
   * held two Standard and one Performance heat sink: "Mixing of Standard and Performance Heatsink is NOT allowed.
   * (P58457-B21 (Heatsink Kit), P58456-B21 (Heatsink Kit))", "Supported with 8SFF CTO Model Only. (P58456-B21 (Heatsink
   * Kit))" and "If Standard Heatsink is selected, then Performance Fan cannot be selected. (P58462-B21 (Power Cooling
   * Options), P58456-B21 (Heatsink Kit))". Each rule blames the selected products it names; "If A is selected, then B
   * cannot be selected" blames only B. The product blamed most is removed, when its choice keeps another product.
   */
  private async repairConflictRule(choice: MenuChoice): Promise<boolean> {
    const rowsByChoice = new Map<string, RowInfo[]>();
    const blamed = new Map<string, RowInfo & { choiceId: string; blame: number }>();
    for (const rule of await this.choiceRules(choice.id)) {
      if (!rule.products.length || !FORBIDDING_RULE.test(rule.ownText) || /\bmust\s+be\s+selected\b/i.test(rule.ownText)) continue;
      const named: Array<RowInfo & { choiceId: string }> = [];
      for (const { choiceId, productNumber } of rule.products) {
        if (!rowsByChoice.has(choiceId)) rowsByChoice.set(choiceId, await this.rowInfo(this.choiceRows(choiceId)));
        const row = rowsByChoice.get(choiceId)!.find((item) => item.productNumber === productNumber && this.committedQuantity(item) > 0);
        if (row && !named.some((item) => item.id === row.id)) named.push({ ...row, choiceId });
      }
      const then = rule.ownText.match(/\bthen\s+(.+?)\s+(?:cannot|can\s*not|must\s+not)\b/i)?.[1];
      const scores = named.map((row) => (then ? phraseScore(then, row.description) : 0));
      const best = Math.max(0, ...scores);
      named.forEach((row, index) => {
        if (best > 0 && scores[index] < best) return;
        const entry = blamed.get(row.id) ?? { ...row, blame: 0 };
        entry.blame += 1;
        blamed.set(row.id, entry);
      });
    }
    const removable = [...blamed.values()].filter((row) => rowsByChoice.get(row.choiceId)!
      .some((other) => other.id !== row.id && other.productNumber && this.committedQuantity(other) > 0 && !isDimmBlank(other.description)))
      .sort((a, b) => b.blame - a.blame);
    const [worst] = removable;
    if (!worst) return false;
    await this.openOwners([worst.choiceId]);
    console.log(`[STEP] OCA rules on "${choice.title || choice.id}" forbid ${worst.productNumber} (named by ${worst.blame}); removing it`);
    await this.quantities.set(this.page.locator(`[id=${JSON.stringify(worst.id)}]`), worst.productNumber, 0, false);
    return true;
  }

  /**
   * A rule needs a kind of product the current selection is not: a processor series (P75728-B21, DL340
   * Gen12: the random Smart Chassis brought a Front 4xGPU kit that "can be selected only if 6XX1P processor
   * is selected", while OCA's preselected processor was kept) or a memory speed (P55438-B21, DL320 Gen11:
   * "Supports only PC5-4800B Memory. (Memory, Processors)" with DDR5-5600 memory). In each choice the rule
   * covers, a product of that kind is selected with the same quantity, then the old one is removed (a
   * radio row replaces it by itself).
   */
  private async repairRequiredKindRule(choice: MenuChoice): Promise<boolean> {
    for (const rule of await this.choiceRules(choice.id)) {
      const kind = requiredKind(rule.ownText);
      if (!kind) continue;
      const targets = [...new Set([choice.id, ...rule.targets])];
      await this.openOwners(targets);
      for (const target of targets) {
        const existing = await this.existingSelection(target);
        if (existing && kind.matches(existing.description)) continue;
        const rows = (await this.rowInfo(this.choiceRows(target)))
          .filter((row) => isPickable(row) && row.id !== existing?.rowId && kind.matches(row.description));
        if (!rows.length) continue;
        const withinWatts = rows.filter((row) => !(processorWatts(row.description) > MAX_RANDOM_PROCESSOR_WATTS));
        const candidates = withinWatts.length ? withinWatts : rows;
        console.log(`[STEP] OCA rule "${rule.ownText}" needs ${kind.name}`
          + `${existing ? ` (${existing.productNumber} is not)` : ''}: ${candidates.map((row) => row.productNumber).join(', ')}`);
        await this.fillOne(target, candidates.map((row) => ({ ...row, choiceId: target })), existing?.quantity ?? 1);
        if (existing) {
          const old = this.page.locator(`[id=${JSON.stringify(existing.rowId)}]`);
          if (Number(await this.quantities.committedQuantity(old, existing.productNumber)) > 0) {
            console.log(`[STEP] Removing ${existing.productNumber}, which is not ${kind.name}`);
            await this.quantities.set(old, existing.productNumber, 0, false);
          }
        }
        return true;
      }
    }
    return false;
  }

  /**
   * "Quantity of Processor and Quantity of Heatsink must match. (Processor, Heatsink Kit)" (P72176-B21,
   * DL360 Gen12): the random Smart Chassis added a High Performance heat sink beside OCA's standard one,
   * so two heat sinks stood against one processor. When the larger side has several products, the one
   * the choice's other error rules speak of most ("If Performance Heatsink is selected, then Standard fan
   * cannot be selected") is removed; when both sides hold one product, the smaller quantity is raised.
   */
  private async repairMatchRule(choice: MenuChoice): Promise<boolean> {
    const rules = await this.choiceRules(choice.id);
    for (const rule of rules) {
      // "... must be equal" on P53934-B21 (DL365 Gen11).
      if (rule.targets.length !== 2 || !/\bquantity of \b.+?\band quantity of \b.+?\bmust (?:match|be equal)\b/i.test(rule.ownText)) continue;
      await this.openOwners(rule.targets);
      const sides = await Promise.all(rule.targets.map(async (id) => {
        const rows = (await this.rowInfo(this.choiceRows(id)))
          .filter((row) => row.productNumber && this.committedQuantity(row) > 0 && !isDimmBlank(row.description));
        return { id, rows, total: rows.reduce((sum, row) => sum + this.committedQuantity(row), 0) };
      }));
      const [low, high] = [...sides].sort((a, b) => a.total - b.total);
      if (!low.total || low.total === high.total) continue;
      if (high.rows.length > 1) {
        const others = (await this.choiceRules(high.id)).filter((other) => other.text !== rule.text).map((other) => other.ownText).join(' ');
        const extra = high.rows.filter((row) => this.committedQuantity(row) <= high.total - low.total)
          .sort((a, b) => phraseScore(others, b.description) - phraseScore(others, a.description))[0];
        if (!extra) continue;
        console.log(`[STEP] OCA rule "${rule.ownText}": ${high.total} against ${low.total}; removing ${extra.productNumber}`);
        await this.quantities.set(this.page.locator(`[id=${JSON.stringify(extra.id)}]`), extra.productNumber, 0, false);
        return true;
      }
      if (low.rows.length !== 1) continue;
      const [row] = low.rows;
      console.log(`[STEP] OCA rule "${rule.ownText}": raising ${row.productNumber} from ${low.total} to ${high.total}`);
      await this.quantities.set(this.page.locator(`[id=${JSON.stringify(row.id)}]`), row.productNumber, high.total, false, { acceptOffered: true });
      return true;
    }
    return false;
  }

  /** Choices of the Processor and Memory sections OCA flags as errors now. */
  private async flaggedMandatoryChoices(): Promise<string[]> {
    const keys = (await this.sections()).filter((section) => /^(processors?|memory)$/i.test(section.title)).map((section) => section.key);
    if (!keys.length) return [];
    return this.page.evaluate((prefixes) => Array.from(document.querySelectorAll('[id^="choice_status_icon_"].img-alert'))
      .map((icon) => icon.id.slice('choice_status_icon_'.length))
      .filter((id) => prefixes.some((key) => id.startsWith(`${key}_`))), keys);
  }

  /** Opens the sections owning these choices: only rows the page shows can be picked. */
  private async openOwners(choiceIds: string[]): Promise<void> {
    // Rows behind OCA's "Show more" stay hidden, and choosing one timed out (P83540-B21 cables).
    for (const choiceId of new Set(choiceIds)) {
      const owner = await this.owningSection(choiceId);
      if (owner) await this.open(owner);
    }
  }

  /**
   * Sets one random candidate to the quantity (or what OCA offers), then into its choice's quantity
   * rule. At most REPAIR_CANDIDATE_TRIES candidates are tried: on P75218-B21 all 24 network cards
   * were tried one by one for over 8 minutes.
   */
  private async fillOne(label: string, candidates: Array<RowInfo & { choiceId: string }>, quantity = 1): Promise<void> {
    await this.tryRandomCandidates(label, candidates.map((row) => ({
      row: this.page.locator(`[id=${JSON.stringify(row.id)}]`), productNumber: row.productNumber, choiceId: row.choiceId,
    })), async (candidate) => {
      const flaggedBefore = new Set(await this.flaggedMandatoryChoices());
      const set = await this.quantities.set(candidate.row, candidate.productNumber, quantity, false, { acceptOffered: true });
      const committed = await this.enforceQuantityRule(candidate.choiceId, candidate.row, candidate.productNumber, set);
      // A repair must not break Processor or Memory (P75218-B21: "OCPB R1S Cbl Kit (P75154-B21) is
      // supported only with 6XX1P processor series"). Failing here restores the row and tries the next one.
      const broken = (await this.flaggedMandatoryChoices()).filter((id) => !flaggedBefore.has(id) && id !== candidate.choiceId);
      if (broken.length) throw new Error(`${candidate.productNumber} makes OCA flag ${broken.join(', ')}`);
      return committed;
    }, REPAIR_CANDIDATE_TRIES);
  }

  /** Brings a committed quantity into OCA's rule for the choice; returns the quantity now committed. */
  private async enforceQuantityRule(choiceId: string, row: Locator, productNumber: string, quantity: number): Promise<number> {
    const description = (await row.locator('.item_desc').first().textContent({ timeout: 1_000 }).catch(() => '') ?? '').replace(/\s+/g, ' ').trim();
    const rule = await this.quantityRule(choiceId, description);
    if (!rule) return quantity;
    const allowed = fitQuantity(quantity, rule);
    if (allowed === quantity) return quantity;
    console.log(`[INFO] ${productNumber}: OCA allows ${rule.min}-${rule.max}${rule.even ? ', even only' : ''}; changing quantity ${quantity} to ${allowed}`);
    return this.quantities.set(row, productNumber, allowed, true, { acceptOffered: true });
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
      console.log(`[INFO] ${section.title} ${existing.productNumber} x${existing.quantity} is already selected; keeping it`);
      const quantity = !randomPolicy(sectionName).radioOnly
        ? await this.enforceQuantityRule(choice.id, this.page.locator(`[id=${JSON.stringify(existing.rowId)}]`), existing.productNumber, existing.quantity)
        : existing.quantity;
      return { productNumber: existing.productNumber, description: existing.description, quantity };
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
      const set = await this.quantities.set(candidate.row, candidate.productNumber, wanted, true, { acceptOffered: true });
      // OCA states its quantity rules only once a product is selected.
      const quantity = await this.enforceQuantityRule(choice.id, candidate.row, candidate.productNumber, set);
      return { productNumber: candidate.productNumber, description: candidate.description, quantity };
    });
  }

  private async tryRandomCandidates<T extends { row: Locator; productNumber: string }, R>(
    section: string, candidates: T[], select: (candidate: T) => Promise<R>, maxTries = Number.POSITIVE_INFINITY,
  ): Promise<R> {
    const remaining = [...candidates];
    const failures: string[] = [];
    while (remaining.length && failures.length < maxTries) {
      // A dialog left by OCA (e.g. "PCI Card Placement") blocks every click until it is closed.
      await dismissOcaMessageDialogs(this.page);
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
        await dismissOcaMessageDialogs(this.page);
        const after = await this.quantities.committedQuantity(candidate.row, candidate.productNumber);
        if (after !== before) {
          if (!/^\d+$/.test(before)) throw new Error(`Cannot safely restore failed ${section} candidate ${candidate.productNumber}; previous quantity was unreadable`, { cause: error });
          console.log(`[STEP] Restoring failed candidate ${candidate.productNumber} to quantity ${before} before fallback`);
          await this.quantities.set(candidate.row, candidate.productNumber, Number(before), true);
        }
        if (remaining.length) console.log(`[STEP] Trying another random ${section} candidate (${remaining.length} remaining)`);
      }
    }
    if (remaining.length) throw new Error(`${failures.length} ${section} candidates failed; not trying the other ${remaining.length}: ${failures.join(' | ')}`);
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
        await revealForViewer(row);
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
    const randomized = RANDOMIZED_SECTIONS.test(sectionName.trim());
    if (randomized) await this.selectRandom(sectionName);
    const section = await this.openSection(sectionName);
    // Only this section's flagged choices are touched. In component sections the main choice is
    // already set, so other flagged choices are filled only with products OCA names.
    const flagged = await this.flaggedChoices(section);
    for (const choice of flagged) {
      if (await this.repairMaxRule(choice)) return;
    }
    for (const choice of flagged) {
      if (await this.repairRequiredKindRule(choice)) return;
    }
    // A forbidden product goes before quantities are matched: otherwise the allowed one might be removed.
    for (const choice of flagged) {
      if (await this.repairConflictRule(choice)) return;
    }
    for (const choice of flagged) {
      if (await this.repairMatchRule(choice)) return;
    }
    for (const choice of flagged) {
      if (await this.repairFlaggedChoice(choice, !randomized)) return;
    }
    for (const choice of flagged) {
      if (await this.repairRequiresRule(choice)) return;
    }
    // A rule counting across several choices may sit on a choice that is already filled.
    for (const choice of flagged) {
      if (await this.repairGroupRule(choice)) return;
    }
    if (randomized || await this.satisfyVisibleRequiredControl()) return;
    console.log(`[WARN] ${sectionName} is flagged, but none of its flagged choices can be filled; OCA's message will be reported`);
  }

  /** Fills an empty required dropdown ("Please make a selection"); never changes product rows. */
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
      await revealForViewer(select);
      await select.selectOption(picked.value, { force: true });
      await waitForBlockingOverlay(this.page);
      return true;
    }
    // No page-wide product fallback: picking "any unselected row" changed the processor
    // when OCA asked for a drive cage (P83540-B21).
    return false;
  }
}

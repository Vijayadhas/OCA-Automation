import { expect, type Locator, type Page } from '@playwright/test';
import { waitForBlockingOverlay } from '../core/waits';

export interface StorageSelection {
  label: string;
  productNumber: string;
  description: string;
  quantity: number;
}

interface StorageChoice {
  label: string;
  sectionKey: string;
  rowKey: string;
  selection: 'row' | 'quantity';
  preferHighest?: boolean;
}

const choices: StorageChoice[] = [
  { label: 'Cloud Connectivity', sectionKey: 'cloudConnectivitySection', rowKey: 'cloudConnectivity', selection: 'row' },
  { label: 'Controller Node Chassis', sectionKey: 'nodechassisSection', rowKey: 'nodechassisSection_nodeschassisChoice', selection: 'quantity' },
  { label: 'Controller Nodes', sectionKey: 'nodechassisSection', rowKey: 'nodechassisSection_nodesChoice', selection: 'quantity', preferHighest: true },
  { label: 'Capacity', sectionKey: 'hardDriveSection', rowKey: 'hardDriveSection_', selection: 'quantity' },
];

export class StorageFlow {
  constructor(private readonly page: Page) {}

  async configure(): Promise<StorageSelection[]> {
    const selected: StorageSelection[] = [];
    for (const choice of choices) selected.push(await this.selectRandomRequiredChoice(choice));
    return selected;
  }

  private async selectRandomRequiredChoice(choice: StorageChoice): Promise<StorageSelection> {
    console.log(`[STEP] Configuring Storage ${choice.label}`);
    await this.openSection(choice);
    const rows = this.page.locator([
      `tr.item_tr[data-elementid*="${choice.rowKey}" i]:visible`,
      `tr.item_tr[id*="${choice.rowKey}" i]:visible`,
      `tr[role="row"][data-elementid*="${choice.rowKey}" i]:visible`,
      `tr[role="row"][id*="${choice.rowKey}" i]:visible`,
    ].join(', '));
    const count = await rows.count();
    if (!count) throw new Error(`${choice.label} did not expose any selectable storage rows`);
    console.log(`[INFO] Storage ${choice.label} selectable row count: ${count}`);

    const startIndex = Math.floor(Math.random() * count);
    const failures: string[] = [];
    for (let offset = 0; offset < count; offset += 1) {
      const selectedIndex = (startIndex + offset) % count;
      console.log(`[INFO] Storage ${choice.label} trying row index: ${selectedIndex}`);
      const row = rows.nth(selectedIndex);
      const productCell = row.locator('._pid').first();
      const descriptionCell = row.locator('.item_desc').first();
      const productNumber = (await productCell.count()
        ? (await productCell.textContent() ?? '') : '').trim();
      const description = (await descriptionCell.count()
        ? (await descriptionCell.textContent() ?? '') : '').replace(/\s+/g, ' ').trim()
        || productNumber || choice.label;
      try {
        const quantity = choice.selection === 'row'
          ? await this.selectRowChoice(row, choice.label)
          : await this.selectAvailableQuantity(row, choice.label, choice.preferHighest ?? false);
        console.log(`[STEP] Random Storage ${choice.label}: ${description}${productNumber ? ` (${productNumber})` : ''} x${quantity}`);
        await waitForBlockingOverlay(this.page);
        return { label: choice.label, productNumber, description, quantity };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`row ${selectedIndex}: ${message}`);
        console.warn(`[WARN] Storage ${choice.label} row ${selectedIndex} was not selectable: ${message}`);
        await this.page.keyboard.press('Escape').catch(() => undefined);
      }
    }
    throw new Error(`${choice.label} could not select a positive quantity (${failures.join('; ')})`);
  }

  private async selectRowChoice(row: Locator, label: string): Promise<number> {
    const clickTarget = row.locator('.item_desc, div').filter({ visible: true }).first();
    if (!await clickTarget.isVisible({ timeout: 500 }).catch(() => false)) {
      throw new Error(`${label} row did not expose a selectable element`);
    }
    await clickTarget.scrollIntoViewIfNeeded();
    await clickTarget.click({ force: true });
    await waitForBlockingOverlay(this.page);

    // A row choice can legitimately display zero because it represents a mode,
    // rather than an ordered component. Preserve a positive quantity when OCA
    // exposes one, otherwise report zero without treating the selection as failed.
    const selectedQuantity = await this.readDisplayedQuantity(row, clickTarget).catch(() => 0);
    return selectedQuantity > 0 ? selectedQuantity : 0;
  }

  private async openSection(choice: StorageChoice): Promise<void> {
    const header = this.page.locator(
      `#section_header_${choice.sectionKey}, [id*="section_header" i][id*="${choice.sectionKey}" i]`,
    ).filter({ visible: true }).first();
    const fallback = this.page.getByText(new RegExp(choice.label, 'i')).filter({ visible: true }).first();
    const section = await header.isVisible({ timeout: 3_000 }).catch(() => false) ? header : fallback;
    await expect(section, `${choice.label} storage section`).toBeVisible({ timeout: 30_000 });
    const toggle = this.page.locator(`#section_toggle_${choice.sectionKey}`).filter({ visible: true }).first();
    if (await toggle.isVisible({ timeout: 300 }).catch(() => false)
      && !(await toggle.getAttribute('class') ?? '').includes('icon-angle-down')) return;
    if (await section.getAttribute('aria-expanded') === 'true') return;
    await section.scrollIntoViewIfNeeded();
    await section.click({ force: true });
    await waitForBlockingOverlay(this.page);
  }

  private async selectAvailableQuantity(row: Locator, label: string, preferHighest: boolean): Promise<number> {
    const nativeOptions = await row.evaluate((element) => Array.from(element.querySelectorAll('select option:not([disabled])'))
      .map((option) => ({ value: (option as HTMLOptionElement).value, text: (option.textContent ?? '').trim() }))
      .filter((option) => /^\d+$/.test(option.text) && Number(option.text) > 0));
    if (nativeOptions.length) {
      const picked = preferHighest
        ? nativeOptions.reduce((highest, option) => Number(option.text) > Number(highest.text) ? option : highest)
        : nativeOptions[Math.floor(Math.random() * nativeOptions.length)];
      await row.evaluate((element, value) => {
        const select = element.querySelector('select');
        if (!select) throw new Error('Storage quantity select disappeared');
        select.value = value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, picked.value);
      return Number(picked.text);
    }

    const target = row.locator([
      'td.item_qty .item_qty_div',
      '.item_qty_div',
      'td.item_qty',
      '[data-elementid*="qty" i]',
      'div',
    ].join(', ')).filter({ visible: true }).first();
    if (!await target.isVisible({ timeout: 500 }).catch(() => false)) {
      throw new Error(`${label} row did not expose a quantity control`);
    }
    const radio = row.locator('input[type="radio"]').filter({ visible: true }).first();
    if (await radio.isVisible({ timeout: 500 }).catch(() => false) && !(await radio.isChecked())) {
      await radio.check({ force: true }).catch(() => radio.click({ force: true }));
      await waitForBlockingOverlay(this.page);
    }
    await target.scrollIntoViewIfNeeded();
    await target.click({ force: true });
    await this.page.waitForTimeout(500);

    const popup = this.page.locator('#popup_textbox').filter({ visible: true }).first();
    if (await popup.isVisible({ timeout: 500 }).catch(() => false)) {
      const minimum = Number(await popup.getAttribute('min') ?? await popup.getAttribute('aria-valuemin') ?? '');
      if (!Number.isInteger(minimum) || minimum < 1) {
        throw new Error(`${label} uses a free-entry quantity but OCA did not expose its minimum; add a quantity column before automating this layout`);
      }
      await popup.fill(String(minimum));
      await popup.press('Enter');
      return minimum;
    }

    const options = this.page.locator([
      '.selecter-options:visible .selecter-item',
      '[role="listbox"]:visible [role="option"]',
      '.ui-menu:visible .ui-menu-item',
      '[id]:visible',
    ].join(', ')).filter({ visible: true });
    const available: Array<{ locator: Locator; quantity: number }> = [];
    const targetBox = await target.boundingBox();
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index);
      const text = ((await option.textContent()) ?? '').trim();
      if (!/^\d+$/.test(text) || Number(text) < 1) continue;
      const box = await option.boundingBox();
      if (!box || !targetBox) continue;
      const distance = Math.hypot(
        box.x + box.width / 2 - (targetBox.x + targetBox.width / 2),
        box.y + box.height / 2 - (targetBox.y + targetBox.height / 2),
      );
      if (distance < 400) available.push({ locator: option, quantity: Number(text) });
    }
    if (!available.length) {
      // Some OCA quantity widgets render no listbox/options in the DOM. Advance the
      // focused widget with the keyboard, then verify the UI reports a positive value.
      const before = await this.readDisplayedQuantity(row, target);
      await target.press('ArrowDown').catch(() => this.page.keyboard.press('ArrowDown'));
      await target.press('Enter').catch(() => this.page.keyboard.press('Enter'));
      await waitForBlockingOverlay(this.page);
      const quantity = await this.readDisplayedQuantity(row, target);
      if (quantity > 0 && quantity !== before) return quantity;
      throw new Error(`${label} quantity control did not expose or accept any positive values`);
    }
    const picked = preferHighest
      ? available.reduce((highest, option) => option.quantity > highest.quantity ? option : highest)
      : available[Math.floor(Math.random() * available.length)];
    await picked.locator.click({ force: true });
    return picked.quantity;
  }

  private async readDisplayedQuantity(row: Locator, target: Locator): Promise<number> {
    return row.evaluate((element, targetElement) => {
      const select = element.querySelector('select') as HTMLSelectElement | null;
      if (select) {
        const option = select.selectedOptions[0];
        const optionText = option?.textContent?.trim() ?? '';
        const selectValue = select.value.trim();
        const selected = /^\d+$/.test(optionText)
          ? Number(optionText)
          : /^\d+$/.test(selectValue) ? Number(selectValue) : 0;
        if (selected > 0) return selected;
      }
      const input = element.querySelector('input[type="number"], input[role="spinbutton"]') as HTMLInputElement | null;
      const inputValue = input?.value.trim() ?? '';
      const entered = /^\d+$/.test(inputValue) ? Number(inputValue) : 0;
      if (entered > 0) return entered;
      const targetText = (targetElement as HTMLElement | null)?.textContent?.trim() ?? '';
      return /^\d+$/.test(targetText) ? Number(targetText) : 0;
    }, await target.elementHandle());
  }
}

import { expect, type Locator, type Page } from '@playwright/test';
import { escapeRegex, waitForBlockingOverlay } from '../core/waits';
import type { PageSnapshot } from '../reporting/html-capture';
import { revealForViewer } from '../core/interactions';

export class QuantityHandler {
  constructor(private readonly page: Page, private readonly snapshot?: PageSnapshot) {}

  async committedQuantity(row: Locator, productNumber: string): Promise<string> {
    return this.readCommitted(row, productNumber);
  }

  /**
   * Sets a row's quantity and returns the quantity committed. With acceptOffered, a menu
   * that does not offer the wanted quantity commits the smallest one it does offer
   * (OCA can allow only some quantities, e.g. memory in pairs).
   */
  async set(
    originalRow: Locator, productNumber: string, quantity: number, requireStableVerification = true,
    options: { acceptOffered?: boolean } = {},
  ): Promise<number> {
    // Random choices arrive as nth() locators. Recalculation can reorder those
    // rows, so retain the row identity before performing any action.
    const rowId = await originalRow.getAttribute('id');
    const row = rowId ? this.page.locator(`[id=${JSON.stringify(rowId)}]`) : originalRow;
    await revealForViewer(row);
    const radio = row.locator('input[type="radio"]').filter({ visible: true }).first();
    let selectedNow = false;
    if (await radio.isVisible({ timeout: 1_000 }).catch(() => false)) {
      if (!(await radio.isChecked().catch(() => false))) {
        await radio.check({ force: true }).catch(async () => radio.click({ force: true }));
        selectedNow = true;
        // A radio selection causes OCA to rebuild the choice table and normally commits quantity 1.
        // Do not inspect or open the row-owned quantity dropdown until that recalculation settles.
        await waitForBlockingOverlay(this.page);
        await this.page.waitForTimeout(1_500);
      }
    }
    let committed = await this.readCommitted(row, productNumber);
    if (selectedNow && quantity === 1 && (!committed || committed === '0')) {
      // Selecting a radio row commits OCA's default quantity of 1. Some models rebuild
      // the row without leaving a readable quantity control, so reopening it is both
      // unnecessary and unreliable.
      committed = '1';
      console.log(`[INFO] ${productNumber} was newly selected with OCA default quantity 1; no quantity change needed`);
    }
    if (committed === String(quantity)) {
      console.log(`[INFO] ${productNumber} is already selected with quantity ${quantity}; leaving it unchanged`);
    } else {
      try {
        const written = await this.write(row, quantity, productNumber, options.acceptOffered ?? false);
        if (written !== quantity) {
          console.log(`[INFO] ${productNumber}: quantity ${quantity} is not offered; using the smallest offered quantity ${written}`);
          quantity = written;
        }
      } catch (error) {
        // A quantity click can cause an immediate row rebuild. Confirm the refreshed
        // committed row before treating a missing dropdown option as a real failure.
        const refreshed = await this.readCommitted(row, productNumber);
        if (refreshed !== String(quantity)) throw error;
        console.log(`[INFO] ${productNumber} quantity ${quantity} was committed during row refresh; continuing`);
      }
    }
    await waitForBlockingOverlay(this.page);
    if (!requireStableVerification) {
      await this.page.waitForTimeout(2_000);
      const observed = await this.readCommitted(row, productNumber);
      if (observed === String(quantity)) console.log(`[INFO] ${productNumber} quantity committed as ${quantity}`);
      else console.log(`[WARN] ${productNumber} quantity reads as ${observed || '<empty>'} after selecting ${quantity}; continuing because OCA can expose stale Memory row text after recalculation`);
      return quantity;
    }
    let stable = 0;
    const observed = new Set<string>();
    try {
      await expect.poll(async () => {
        const actual = await this.readCommitted(row, productNumber);
        observed.add(actual || '<empty>');
        stable = actual === String(quantity) ? stable + 1 : 0;
        return stable;
      }, { timeout: 30_000, intervals: [750, 1000, 1500], message: `${productNumber} quantity must remain ${quantity}` })
        .toBeGreaterThanOrEqual(3);
    } catch (error) {
      throw new Error(`${productNumber} quantity must remain ${quantity}; observed: ${[...observed].join(', ') || '<unreadable>'}`, { cause: error });
    }
    return quantity;
  }

  async verify(row: Locator, productNumber: string, quantity: number): Promise<void> {
    await expect.poll(() => this.readCommitted(row, productNumber), {
      timeout: 30_000,
      message: `${productNumber} committed quantity`,
    }).toBe(String(quantity));
  }

  /** Smallest positive whole quantity among option texts, if any. */
  private smallestOffered(texts: string[]): number | undefined {
    const values = texts.map((text) => text.trim()).filter((text) => /^\d+$/.test(text)).map(Number).filter((value) => value > 0);
    return values.length ? Math.min(...values) : undefined;
  }

  private async write(row: Locator, quantity: number, productNumber: string, acceptOffered: boolean): Promise<number> {
    const value = String(quantity);
    const select = row.locator('select').filter({ visible: true }).first();
    if (await select.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const option = select.locator('option').filter({ hasText: new RegExp(`^\\s*${escapeRegex(value)}\\s*$`) }).first();
      if (await option.count()) {
        await select.selectOption(await option.getAttribute('value') ?? value);
        return quantity;
      }
      const fallback = acceptOffered ? this.smallestOffered(await select.locator('option').allTextContents()) : undefined;
      if (fallback === undefined) throw new Error(`Quantity option ${value} is unavailable`);
      const fallbackOption = select.locator('option').filter({ hasText: new RegExp(`^\\s*${fallback}\\s*$`) }).first();
      await select.selectOption(await fallbackOption.getAttribute('value') ?? String(fallback));
      return fallback;
    }
    const input = row.locator('input[type="number"], input[type="text"]').filter({ visible: true }).first();
    if (await input.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await input.fill(value); await input.press('Tab'); return quantity;
    }
    // Prefer the inner clickable quantity div. Selecting the outer td and clicking
    // its right edge is unreliable after OCA rebuilds a dHCI choice table.
    let target = row.locator('.item_qty_div').filter({ visible: true }).first();
    const quantityCell = row.locator('td.item_qty, [class*="qty"]').filter({ visible: true }).first();
    if (!(await target.isVisible({ timeout: 1_000 }).catch(() => false))) target = quantityCell;
    await target.scrollIntoViewIfNeeded();
    await target.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    let offered: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // dHCI tables are inconsistent: chassis rows open from the inner div,
      // while rebuilt node rows can open only from the owning quantity cell.
      const attemptTarget = attempt === 1 || !(await quantityCell.isVisible().catch(() => false)) ? target : quantityCell;
      await attemptTarget.scrollIntoViewIfNeeded();
      const targetBox = await attemptTarget.boundingBox();
      // OCA's custom quantity control opens from the arrow at the right edge. A
      // center click can focus the displayed 0 without opening the options.
      if (targetBox) await this.page.mouse.click(
        attempt < 3 ? targetBox.x + targetBox.width / 2 : targetBox.x + Math.max(4, targetBox.width - 8),
        targetBox.y + targetBox.height / 2,
      );
      else await attemptTarget.click({ force: true });
      if (attempt === 2) {
        await attemptTarget.evaluate((element) => (element as HTMLElement).click()).catch(() => undefined);
      }
      await this.page.waitForTimeout(700);

      const popupTextBox = this.page.locator('#popup_textbox').filter({ visible: true }).first();
      if (await popupTextBox.isVisible({ timeout: 1_000 }).catch(() => false)) {
        console.log(`[INFO] Entering quantity ${value} through OCA quantity popup textbox`);
        await popupTextBox.fill(value);
        await popupTextBox.press('Enter');
        return quantity;
      }
      let menuOption = await this.findNearestOpenOption(attemptTarget, value).catch(() => null);
      let chosen = quantity;
      if (!menuOption) {
        // The menu may have opened without this value (OCA can allow only some quantities).
        offered = (await this.page.locator([
          '.selecter.open .selecter-item', '.selecter-options:visible .selecter-item',
          '[role="listbox"]:visible [role="option"]', '.ui-menu:visible .ui-menu-item',
          // OCA's quantity popup: <div id="action_div" class="popup-menu"><li class="menu-item"><a id="2">2</a>.
          '.popup-menu:visible .menu-item',
        ].join(', ')).filter({ visible: true }).allTextContents().catch(() => [] as string[]))
          .map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
        const fallback = acceptOffered ? this.smallestOffered(offered) : undefined;
        if (fallback !== undefined) {
          menuOption = await this.findNearestOpenOption(attemptTarget, String(fallback)).catch(() => null);
          chosen = fallback;
        }
      }
      if (menuOption) {
        const optionBox = await menuOption.boundingBox();
        if (optionBox) await this.page.mouse.click(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
        else await menuOption.click({ force: true });
        return chosen;
      }
      console.log(`[WARN] Quantity option ${value} did not open on attempt ${attempt}/3; retrying`);
      // Keep the page as the last click left it, before Escape closes anything that did open.
      if (attempt === 3) await this.snapshot?.(`WARN-Quantity ${value} did not open for ${productNumber}`);
      await this.page.keyboard.press('Escape').catch(() => undefined);
      await this.page.waitForTimeout(500);
    }
    throw new Error(`Quantity option ${value} did not open for the selected row after 3 attempts`
      + ` (visible options: ${offered.length ? offered.join(', ') : 'none'})`);
  }

  private async findNearestOpenOption(target: Locator, value: string): Promise<Locator | null> {
    const exact = new RegExp(`^\\s*${escapeRegex(value)}\\s*$`);
    const options = this.page.locator([
      `[id="${value}"]`,
      `.selecter.open .selecter-options .selecter-item[data-value="${value}"]`,
      `.selecter.open .selecter-item[data-value="${value}"]`,
      `.selecter-options:visible .selecter-item[data-value="${value}"]`,
      `[role="listbox"]:visible [role="option"][data-value="${value}"]`,
      `[role="listbox"]:visible [role="option"]`,
      `.ui-menu:visible .ui-menu-item`,
      `.popup-menu:visible .menu-item`,
    ].join(', ')).filter({ visible: true, hasText: exact });
    await expect.poll(() => options.count(), { timeout: 5_000, message: `Visible quantity option ${value}` }).toBeGreaterThan(0);

    const targetBox = await target.boundingBox();
    let nearest: Locator | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const count = await options.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = options.nth(index);
      const box = await candidate.boundingBox();
      if (!box) continue;
      if (!targetBox) return candidate;
      const distance = Math.hypot(
        box.x + box.width / 2 - (targetBox.x + targetBox.width / 2),
        box.y + box.height / 2 - (targetBox.y + targetBox.height / 2),
      );
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private async read(row: Locator): Promise<string> {
    const select = row.locator('select').filter({ visible: true }).first();
    if (await select.isVisible({ timeout: 500 }).catch(() => false)) {
      // OCA may use an internal option value rather than the displayed quantity.
      const label = (await select.locator('option:checked').textContent() ?? '').trim();
      return /^\d+$/.test(label) ? label : (await select.inputValue()).trim();
    }
    const input = row.locator('input[type="number"], input[type="text"]').filter({ visible: true }).first();
    if (await input.isVisible({ timeout: 500 }).catch(() => false)) return (await input.inputValue()).trim();
    const inner = row.locator('.item_qty_div').filter({ visible: true }).first();
    if (await inner.isVisible()) return (await inner.textContent() ?? '').trim();
    return ((await row.locator('.item_qty').filter({ visible: true }).first().textContent().catch(() => '')) ?? '').trim();
  }

  private async readCommitted(originalRow: Locator, productNumber: string): Promise<string> {
    const originalValue = await this.read(originalRow);
    if (originalValue && originalValue !== '0') return originalValue;

    // OCA may move a selected item from Available to a separate committed table after recalculation.
    const rows = this.page.locator('tr.item_tr, tr, [role="row"]')
      .filter({ visible: true, hasText: new RegExp(`\\b${escapeRegex(productNumber)}\\b`, 'i') });
    const count = Math.min(await rows.count(), 20);
    for (let index = 0; index < count; index += 1) {
      const value = await this.read(rows.nth(index));
      if (value && value !== '0') return value;
    }
    return originalValue;
  }
}

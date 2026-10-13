import { test, expect } from '@playwright/test';
import { hasSmartChassisSection } from '../../src/automation/oca-engine';
import { QuantityHandler } from '../../src/components/quantity-handler';

test('detects whether the model offers a Smart Chassis section', async ({ page }) => {
  // P72176-B21 (DL360 Gen12) has one; P83540-B21 (DL580 Gen12) does not.
  await page.setContent('<table><tr class="section_header" id="section_header_smartChassisSection"><td>Smart Chassis</td></tr></table>');
  expect(await hasSmartChassisSection(page)).toBe(true);
  await page.setContent(`<table><tr class="section_header" id="section_header_ProcessorSection"><td>Processor</td></tr>
    <tr class="section_header" id="section_header_osbootdevice"><td>OS Boot Device</td></tr></table>`);
  expect(await hasSmartChassisSection(page)).toBe(false);
});

test('saves the page once when a quantity menu does not open', async ({ page }) => {
  await page.setContent(`<table><tr class="item_tr" id="item_tr_P69729-B21_memory_memorySlotsChoice">
    <td><span class="_pid">P69729-B21</span></td><td class="item_qty"><div class="item_qty_div">0</div></td></tr></table>`);
  const labels: string[] = [];
  const quantities = new QuantityHandler(page, async (label) => { labels.push(label); });
  await expect(quantities.set(page.locator('tr.item_tr'), 'P69729-B21', 2, false))
    .rejects.toThrow('Quantity option 2 did not open for the selected row after 3 attempts (visible options: none)');
  expect(labels).toEqual(['WARN-Quantity 2 did not open for P69729-B21']);
});

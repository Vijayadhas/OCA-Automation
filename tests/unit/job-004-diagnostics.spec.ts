import { test, expect } from '@playwright/test';
import { ComponentEngine } from '../../src/automation/component-engine';
import { QuantityHandler } from '../../src/components/quantity-handler';
import { menuSection } from './oca-menu-fixture';

test('finds sections by title whatever their internal key', async ({ page }) => {
  // DL360 Gen12 uses section_header_smartChassisSection; DL580 Gen12 has no Smart Chassis at all.
  await page.setContent(menuSection({ key: 'anyKey42', title: 'Smart Chassis', choices: [] }));
  expect(await new ComponentEngine(page).findSection('Smart Chassis')).toEqual({ key: 'anyKey42', title: 'Smart Chassis' });
  await page.setContent(menuSection({ key: 'ProcessorSection', title: 'Processor', choices: [] })
    + menuSection({ key: 'osbootdevice', title: 'OS Boot Device', choices: [] }));
  expect(await new ComponentEngine(page).findSection('Smart Chassis')).toBeNull();
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

const pairedMenu = `<table><tr class="item_tr" id="item_tr_DIMM_m_slots">
  <td><span class="_pid">DIMM</span></td>
  <td class="item_qty"><div class="item_qty_div" onclick="document.querySelector('.selecter-options').style.display = 'block'">0</div></td></tr></table>
  <div class="selecter-options" style="display:none">${[0, 2, 4].map((value) => `<span class="selecter-item" data-value="${value}"
    onclick="document.querySelector('.item_qty_div').textContent = '${value}'; this.parentElement.style.display = 'none'">${value}</span>`).join(' ')}</div>`;

test('uses the smallest offered quantity when the menu does not offer the random one', async ({ page }) => {
  await page.setContent(pairedMenu);
  const quantity = await new QuantityHandler(page).set(page.locator('tr.item_tr'), 'DIMM', 1, true, { acceptOffered: true });
  expect(quantity).toBe(2);
  await expect(page.locator('.item_qty_div')).toHaveText('2');
});

test('an explicit quantity that is not offered still fails', async ({ page }) => {
  await page.setContent(pairedMenu);
  await expect(new QuantityHandler(page).set(page.locator('tr.item_tr'), 'DIMM', 1, false))
    .rejects.toThrow('(visible options: 0, 2, 4)');
});

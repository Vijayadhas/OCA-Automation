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

test('finds Power Supplies as a choice inside "Power and Cooling" (DL580 Gen12)', async ({ page }) => {
  // The section titled Power Supplies on DL360 is "Power and Cooling" on DL580, and an earlier
  // "Manufacturing Services" section has a key that also starts with "power".
  await page.setContent(menuSection({ key: 'powerCordsRemoval', title: 'Manufacturing Services', collapsed: true, choices: [
    { id: 'powerCordsRemoval_powerCordsRemoval', title: 'Manufacturing Services', rows: [{ pid: 'MFG', select: [0, 1] }] },
  ] }) + menuSection({ key: 'power', title: 'Power and Cooling', collapsed: true, choices: [
    { id: 'power_powerSlots', title: 'Power Supplies', rows: [{ pid: 'PSU', description: '1800W Power Supply', select: [0, 1] }] },
    { id: 'power_powerCords', title: 'Power Cords', rows: [{ pid: 'CORD', select: [0, 1] }] },
  ] }));
  const engine = new ComponentEngine(page);
  expect(await engine.findSection('Power Supplies')).toEqual({ key: 'power', title: 'Power and Cooling', choiceId: 'power_powerSlots' });
  const instruction = { jobId: 'test', section: 'Power Supplies', selectionType: 'random' as const, sequence: 40 };
  expect(await engine.executeGeneric(instruction)).toBe('done');
  expect(instruction).toMatchObject({ productNumber: 'PSU', quantity: 1 });
  await expect(page.locator('#body_powerCordsRemoval')).toBeHidden();
  await expect(page.locator('#item_tr_CORD_power_powerCords select')).toHaveValue('0');
});

test('reads OCA popup-menu quantities and takes the smallest when 1 is not offered', async ({ page }) => {
  // Captured on P83540-B21: a 128GB DIMM's menu offers 0, 2, 4, 8, 16, 24, 32 only.
  await page.setContent(`<table><tr class="item_tr" id="item_tr_P69730-F21_m_slots">
    <td><span class="_pid">P69730-F21</span></td>
    <td class="item_qty"><div class="item_qty_div" onclick="document.getElementById('action_div').style.display = 'block'">0</div></td></tr></table>
    <div id="action_div" class="popup-menu" style="position: absolute; top: 120px; left: 200px; display: none">
      <ul id="action_ul" class="popup-menu-body compact">${[0, 2, 4, 8, 16, 24, 32].map((value) => `<li class="menu-item compact"
        onclick="document.querySelector('.item_qty_div').textContent = '${value}'; document.getElementById('action_div').style.display = 'none'">
        <a id="${value}" name="${value}">${value}</a></li>`).join('')}</ul></div>`);
  const quantity = await new QuantityHandler(page).set(page.locator('tr.item_tr'), 'P69730-F21', 1, true, { acceptOffered: true });
  expect(quantity).toBe(2);
  await expect(page.locator('.item_qty_div')).toHaveText('2');
});

test('stops at once when OCA\'s quantity menu offers only 0', async ({ page }) => {
  // DL320 Gen12 network cards (2026-10-15): the menu opened with a single "0" item.
  await page.setContent(`<table><tr class="item_tr" id="item_tr_P26259-B21_net_eth">
    <td><span class="_pid">P26259-B21</span></td>
    <td class="item_qty"><div class="item_qty_div" onclick="document.getElementById('action_div').style.display = 'block'">0</div></td></tr></table>
    <div id="action_div" class="popup-menu" style="position: absolute; top: 120px; left: 200px; display: none">
      <ul id="action_ul" class="popup-menu-body compact"><li class="menu-item selected compact"><a id="0" name="0">0</a></li></ul></div>`);
  const snapshots: string[] = [];
  const started = Date.now();
  await expect(new QuantityHandler(page, async (label) => { snapshots.push(label); })
    .set(page.locator('tr.item_tr'), 'P26259-B21', 1, false, { acceptOffered: true }))
    .rejects.toThrow('OCA offers no quantity above 0 for P26259-B21');
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(snapshots).toEqual([]);
});

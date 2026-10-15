import { test, expect } from '@playwright/test';
import { ComponentEngine, phraseScore } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';

const quantityOf = (page: import('@playwright/test').Page, pid: string) => page.locator(`[id^="item_tr_${pid}_"] .item_qty_div`);
const rule = (text: string, links: Array<[string, string]>) => `<li class="message_li"><span class="error_message">${text}
  (${links.map(([id, title]) => `<a class="err-lnk" id="${id}">${title}</a>`).join(', ')})</span></li>`;

test('reads OCA\'s abbreviations when matching a rule to products', () => {
  const wanted = 'NS204i-u Ht Plg Boot Opt Dev';
  expect(phraseScore(wanted, 'HPE NS204i-u v2 480GB NVMe Hot Plug Boot Optimized Storage Device')).toBe(6);
  expect(phraseScore(wanted, 'HPE ProLiant Compute DL320 Gen12 NS204i-u Front Cable Kit')).toBe(1);
});

// DL320 Gen12 SFF (2026-10-15): a Smart Chassis template selected two 8SFF cable kits.
test('removes products beyond "Max=1 8SFF cable kit is allowed"', async ({ page }) => {
  await page.setContent(menuSection({ key: 'storage', title: 'Storage', choices: [
    { id: 'storage_cables', title: 'Internal Storage Controller Cables', flagged: true,
      messages: rule('In SFF CTO Server Max=1 8SFF cable kit is allowed for selection.', [['storage_cables', 'Internal Storage Controller Cables']]),
      rows: [
        { pid: 'P75088-B21', description: 'HPE ProLiant Compute DL320 Gen12 8SFF x1 U.3 PCIe Cable Kit', quantity: 1, select: [0, 1] },
        { pid: 'P75090-B21', description: 'HPE ProLiant Compute DL320 Gen12 8SFF x1 U.3 OROC Cable Kit', quantity: 1, select: [0, 1] },
        { pid: 'P75092-B21', description: 'HPE ProLiant Compute DL320 Gen12 2SFF Direct Attach Cable Kit', quantity: 1, select: [0, 1] },
      ] },
  ] }));
  await new ComponentEngine(page).satisfyRequiredSection('Storage');
  const kits = [await quantityOf(page, 'P75088-B21').textContent(), await quantityOf(page, 'P75090-B21').textContent()];
  expect(kits.sort()).toEqual(['0', '1']);
  // Not an 8SFF cable kit: untouched.
  await expect(quantityOf(page, 'P75092-B21')).toHaveText('1');
});

// P75217-B21 (2026-10-15): OS Boot Device had the NS204i-u cable kit but not the boot device.
test('adds the product "requires selection of" names, even when the choice already has one', async ({ page }) => {
  await page.setContent(menuSection({ key: 'boot', title: 'Boot Options', choices: [
    { id: 'boot_dev', title: 'OS Boot Device', flagged: true,
      messages: rule('NS204i-u Cbl kit requires selection of NS204i-u Ht Plg Boot Opt Dev', [['boot_dev', 'OS Boot Device']]),
      rows: [
        { pid: 'P78279-B21', description: 'HPE NS204i-u v2 480GB NVMe Hot Plug Boot Optimized Storage Device', select: [0, 1] },
        { pid: 'P81160-B21', description: 'HPE NS204i-u v2 960GB NVMe Hot Plug Boot Optimized Storage Device', select: [0, 1] },
        { pid: 'P77186-B21', description: 'HPE ProLiant Compute DL320 Gen12 NS204i-u Front Cable Kit', quantity: 1, select: [0, 1] },
        { pid: 'P71433-B21', description: 'HPE ProLiant Compute DL3XX Gen12 NS204i-u Rear Cable Kit', select: [0, 1] },
      ] },
  ] }));
  await new ComponentEngine(page).satisfyRequiredSection('Boot Options');
  const drives = [await quantityOf(page, 'P78279-B21').textContent(), await quantityOf(page, 'P81160-B21').textContent()];
  expect(drives.sort()).toEqual(['0', '1']);
  await expect(quantityOf(page, 'P71433-B21')).toHaveText('0');
  await expect(quantityOf(page, 'P77186-B21')).toHaveText('1');
});

// P75218-B21 (2026-10-15): the repair picked an OCP cable kit that "is supported only with 6XX1P
// processor series", flagging the Processor. Such a pick is undone and the next one tried.
test('undoes a repair pick that makes OCA flag the Processor', async ({ page }) => {
  await page.setContent(menuSection({ key: 'cpu', title: 'Processor', choices: [
    { id: 'cpu_main', title: 'Processor', rows: [{ pid: 'CPU-A', quantity: 1, select: [0, 1] }] },
  ] }) + menuSection({ key: 'sc', title: 'Upgrade Kits', choices: [
    { id: 'sc_ocp', title: 'Upgrades', flagged: true,
      messages: rule('OCP Ethernet adapter requires an OCP enablement kit', [['sc_ocp', 'Upgrades']]),
      rows: [
        { pid: 'P75154-B21', description: 'OCPB R1S Cbl Kit', select: [0, 1] },
        { pid: 'P76982-B21', description: 'Secondary Front OCP Enablement Kit', select: [0, 1] },
      ] },
  ] }));
  // Selecting P75154-B21 flags the Processor, as OCA did.
  await page.locator('#item_tr_P75154-B21_sc_ocp select').evaluate((select) => select.addEventListener('change', () => {
    document.getElementById('choice_status_icon_cpu_main')!.className = (select as HTMLSelectElement).value === '1' ? 'img-alert' : 'img-info';
  }));
  // The bad kit is tried first.
  const original = Math.random;
  Math.random = () => 0;
  try { await new ComponentEngine(page).satisfyRequiredSection('Upgrade Kits'); } finally { Math.random = original; }
  await expect(quantityOf(page, 'P75154-B21')).toHaveText('0');
  await expect(quantityOf(page, 'P76982-B21')).toHaveText('1');
  await expect(page.locator('#choice_status_icon_cpu_main')).not.toHaveClass(/img-alert/);
});

import { test, expect } from '@playwright/test';
import { ComponentEngine, modelWords } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';

// From P83540-B21 (DL580 Gen12): OCA flags Storage Devices and OS Boot Device with one rule that
// names the acceptable products and links the two choices it covers.
const atLeastOne = `<li class="message_li"><span class="error_message">At-least one option from the below list must be selected -
  - 8SFF x1 Drive Cage (CAGE-A) - 2SFF Drive Cage (CAGE-B) - NS204i-u V2 controller along with Front NS204i-u Enable kit
  (<a class="err-lnk" id="stor_cage">Drive Cage</a>, <a class="err-lnk" id="boot_dev">OS Boot Device</a>)</span></li>`;

const page580 = (cageMessages = atLeastOne, cageAQuantity = 0) =>
  menuSection({ key: 'cpu', title: 'Processor', choices: [
    { id: 'cpu_main', title: 'Processor', rows: [
      { pid: 'CPU-SET', quantity: 2, select: [0, 2, 4] }, { pid: 'CPU-OTHER', radio: true, select: [0, 2, 4] },
    ] },
  ] })
  + menuSection({ key: 'stor', title: 'Storage Devices', collapsed: true, choices: [
    { id: 'stor_cage', title: 'Drive Cage', flagged: true, messages: cageMessages, rows: [
      { pid: 'CAGE-A', quantity: cageAQuantity, select: [0, 1] }, { pid: 'CAGE-B', select: [0, 1] }, { pid: 'CAGE-C', select: [0, 1] },
    ] },
    { id: 'stor_battery', title: 'Smart Storage Battery', rows: [{ pid: 'BATTERY', select: [0, 1] }] },
  ] })
  + menuSection({ key: 'boot', title: 'OS Boot Device', collapsed: true, choices: [
    { id: 'boot_dev', title: 'OS Boot Device', flagged: true, rows: [{ pid: 'NS204', select: [0, 1] }] },
  ] });

const quantityOf = (page: import('@playwright/test').Page, pid: string) => page.locator(`[id^="item_tr_${pid}_"] .item_qty_div`);

test('fills a flagged choice with a product OCA names, and never touches other sections', async ({ page }) => {
  await page.setContent(page580());
  await new ComponentEngine(page).satisfyRequiredSection('Storage Devices');
  const picked: string[] = [];
  for (const pid of ['CAGE-A', 'CAGE-B', 'CAGE-C', 'BATTERY', 'NS204']) if (await quantityOf(page, pid).textContent() === '1') picked.push(pid);
  expect(picked).toHaveLength(1);
  expect(['CAGE-A', 'CAGE-B']).toContain(picked[0]);
  await expect(quantityOf(page, 'CPU-SET')).toHaveText('2');
  await expect(page.locator('#item_tr_CPU-OTHER_cpu_main input')).not.toBeChecked();
});

test('falls back to the flagged choice\'s own products when OCA names none', async ({ page }) => {
  await page.setContent(page580(''));
  await new ComponentEngine(page).satisfyRequiredSection('Storage Devices');
  const picked: string[] = [];
  for (const pid of ['CAGE-A', 'CAGE-B', 'CAGE-C', 'BATTERY']) if (await quantityOf(page, pid).textContent() === '1') picked.push(pid);
  expect(picked).toHaveLength(1);
  expect(picked[0]).toMatch(/^CAGE-/);
});

test('leaves a flagged choice alone when it already has a selection (an OCA rule conflict)', async ({ page }) => {
  await page.setContent(page580(atLeastOne, 1));
  const before = await page.locator('.item_qty_div').allTextContents();
  await new ComponentEngine(page).satisfyRequiredSection('Storage Devices');
  expect(await page.locator('.item_qty_div').allTextContents()).toEqual(before);
});

test('extracts model words from OCA text', () => {
  expect(modelWords('Qty 1 of 1-port/2-port PCIe/OROC TM controller (MR416i / MR216i / MR408i) for 8SFF x1').sort())
    .toEqual(['1-port', '2-port', '8sff', 'mr216i', 'mr408i', 'mr416i', 'x1']);
  expect(modelWords('HPE MR416i-o Gen11 x16 Lanes 8GB Cache')).toEqual(expect.arrayContaining(['mr416i-o', 'mr416i', 'gen11']));
});

// From P83540-B21 after an 8SFF x1 drive cage was chosen: the rule names controllers by model, not part number.
const controllerRule = `<li class="message_li"><span class="error_message">If Qty 1 8SFF x1 drive cage is selected, then Qty 1 of
  1-port/2-port PCIe/OROC TM controller (MR416i / MR216i / MR408i) must be selected.
  (<a class="err-lnk" id="st_cage">Drive Cage</a>, <a class="err-lnk" id="st_cables">Internal Storage Controller Cables</a>,
  <a class="err-lnk" id="st_ctrl">SAS Controller</a>)</span></li>`;

test('fills flagged choices with the products whose descriptions match the rule\'s model words', async ({ page }) => {
  await page.setContent(menuSection({ key: 'st', title: 'Storage Devices', choices: [
    { id: 'st_cage', title: 'Drive Cage', flagged: true, messages: controllerRule, rows: [
      { pid: 'P80429-B21', description: 'DL580 Gen12 8SFF x1 U.3 Tri-Mode Drive Cage Kit', quantity: 1, select: [0, 1] },
    ] },
    { id: 'st_ctrl', title: 'SAS Controller', flagged: true, messages: controllerRule, rows: [
      { pid: 'P95072-B21', description: 'HPE Smart Array E208e-p SR Gen12 x8 Lanes without Cache SAS 12G PCIe Plug-in Controller', select: [0, 1] },
      { pid: 'P47781-B21', description: 'HPE MR416i-o Gen11 x16 Lanes 8GB Cache OCP SPDM Storage Controller', select: [0, 1] },
      { pid: 'P75697-B21', description: 'HPE MR932i-p x32 Lanes PCIe Gen5 SPDM Plug-in Storage Controller', select: [0, 1] },
    ] },
    { id: 'st_cables', title: 'Internal Storage Controller Cables', flagged: true, messages: controllerRule, rows: [
      { pid: 'P89803-B21', description: 'DL580 Gen12 2P/4P 24SFF x1 WM FIO Cable Kit', select: [0, 1] },
      { pid: 'P80387-B21', description: 'DL580 Gen12 2P/4P 8SFF x1 Tri-Mode Cable Kit', select: [0, 1] },
    ] },
  ] }));
  const engine = new ComponentEngine(page);
  await engine.satisfyRequiredSection('Storage Devices'); // SAS Controller
  await engine.satisfyRequiredSection('Storage Devices'); // Cables
  await expect(quantityOf(page, 'P47781-B21')).toHaveText('1');
  await expect(quantityOf(page, 'P95072-B21')).toHaveText('0');
  await expect(quantityOf(page, 'P75697-B21')).toHaveText('0');
  await expect(quantityOf(page, 'P80387-B21')).toHaveText('1');
  await expect(quantityOf(page, 'P89803-B21')).toHaveText('0');
});

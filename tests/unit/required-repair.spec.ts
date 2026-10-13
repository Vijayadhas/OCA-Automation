import { test, expect } from '@playwright/test';
import { ComponentEngine } from '../../src/automation/component-engine';
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

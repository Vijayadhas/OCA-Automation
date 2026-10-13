import { expect, test } from '@playwright/test';
import { ComponentEngine, isMemoryBlankProduct } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';
import type { ComponentInstruction } from '../../src/models/component-instruction';

const random = (section: string): ComponentInstruction => ({ jobId: 'test', section, selectionType: 'random', sequence: 10 });

test('distinguishes memory blank kits from usable memory products', () => {
  expect(isMemoryBlankProduct('HPE ProLiant Compute Gen12 Memory Blank Kit')).toBe(true);
  expect(isMemoryBlankProduct('Memory Blank')).toBe(true);
  expect(isMemoryBlankProduct('HPE 32GB DDR5 Registered Smart Memory Kit')).toBe(false);
});

test('opens a collapsed section before checking the committed selection', async ({ page }) => {
  await page.setContent(menuSection({ key: 'psu9', title: 'Power Supplies', collapsed: true, choices: [
    { id: 'psu9_slots', title: 'Power Supplies', rows: [{ pid: 'P48908-B21', description: 'Power Supply', quantity: 1 }] },
  ] }));
  const instruction = random('Power Supplies');
  expect(await new ComponentEngine(page).executeGeneric(instruction)).toBe('done');
  await expect(page.locator('#body_psu9')).toBeVisible();
  expect(instruction).toMatchObject({ productNumber: 'P48908-B21', quantity: 1 });
});

test('required recovery does not collapse a section that is already open', async ({ page }) => {
  await page.setContent(menuSection({ key: 'psu9', title: 'Power Supplies', choices: [
    { id: 'psu9_slots', title: 'Power Supplies', rows: [{ pid: 'P48908-B21', quantity: 1 }] },
  ] }));
  await new ComponentEngine(page).satisfyRequiredSection('Power Supplies');
  await expect(page.locator('#body_psu9')).toBeVisible();
  await expect(page.locator('.item_qty_div')).toHaveText('1');
});

test('does not mistake hidden menu digits for a committed quantity', async ({ page }) => {
  await page.setContent(menuSection({ key: 'psu9', title: 'Power Supplies', choices: [
    { id: 'psu9_slots', title: 'Power Supplies', rows: [
      { pid: 'P48908-B21', quantity: 0, select: [0, 1], quantityExtra: '<span style="display:none">1 2</span>' },
    ] },
  ] }));
  await new ComponentEngine(page).executeGeneric(random('Power Supplies'));
  await expect(page.locator('select')).toHaveValue('1');
});

test('uses the choice titled like the section, not an earlier accessory choice', async ({ page }) => {
  await page.setContent(menuSection({ key: 'psu9', title: 'Power Supplies', choices: [
    { id: 'psu9_cords', title: 'Power Cords', rows: [{ pid: 'CORD', description: 'Power Supply Cord', quantity: 1 }] },
    { id: 'psu9_slots', title: 'Power Supplies', rows: [{ pid: 'PSU', description: 'Power Supply', quantity: 0, select: [0, 1] }] },
  ] }));
  const instruction = random('Power Supplies');
  await new ComponentEngine(page).executeGeneric(instruction);
  expect(instruction).toMatchObject({ productNumber: 'PSU', quantity: 1 });
  await expect(page.locator('select')).toHaveValue('1');
});

test('keeps a selected product when OCA still flags its section (an OCA rule, not a missing pick)', async ({ page }) => {
  await page.setContent(menuSection({ key: 'psu9', title: 'Power Supplies', headerExtra: '<i title="Error">!</i>', choices: [
    { id: 'psu9_slots', title: 'Power Supplies', rows: [{ pid: 'PSU', quantity: 1 }, { pid: 'OTHER', quantity: 0, select: [0, 1] }] },
  ] }));
  await new ComponentEngine(page).satisfyRequiredSection('Power Supplies');
  await expect(page.locator('#item_tr_PSU_psu9_slots .item_qty_div')).toHaveText('1');
  await expect(page.locator('#item_tr_OTHER_psu9_slots select')).toHaveValue('0');
});

test('skips a section the model does not offer, including a hidden one', async ({ page }) => {
  // P83540-B21 (DL580 Gen12) has no Smart Chassis section; some sections are present but hidden.
  await page.setContent(menuSection({ key: 'cpu1', title: 'Processor', choices: [
    { id: 'cpu1_main', title: 'Processor', rows: [{ pid: 'CPU', quantity: 1 }] },
  ] }) + menuSection({ key: 'nrg', title: 'Energy Star', hidden: true, choices: [
    { id: 'nrg_main', title: 'Energy Star', rows: [{ pid: 'ES', quantity: 0, select: [0, 1] }] },
  ] }));
  const engine = new ComponentEngine(page);
  expect(await engine.executeGeneric(random('Smart Chassis'))).toBe('skipped');
  expect(await engine.executeGeneric(random('Energy Star'))).toBe('skipped');
  expect(await engine.executeGeneric({ jobId: 'test', section: 'Smart Chassis', selectionType: 'quantity', productNumber: 'X', quantity: 1, sequence: 20 }))
    .toBe('skipped');
});

test('picks Smart Chassis from the first choice when none is titled like the section', async ({ page }) => {
  await page.setContent(menuSection({ key: 'sc4', title: 'Smart Chassis', choices: [
    { id: 'sc4_templates', title: 'Top Selling Smart Chassis Combinations', rows: [
      { pid: 'combo-a', description: 'Combination A', radio: true }, { pid: 'combo-b', description: 'Combination B', radio: true },
    ] },
    { id: 'sc4_cabling', title: 'Cabling Option', rows: [{ pid: 'CABLE', radio: true }] },
  ] }));
  const instruction = random('Smart Chassis');
  await new ComponentEngine(page).executeGeneric(instruction);
  expect(['combo-a', 'combo-b']).toContain(instruction.productNumber);
  expect(instruction.quantity).toBe(1);
  await expect(page.locator('#item_tr_CABLE_sc4_cabling input')).not.toBeChecked();
});

test('never picks unavailable rows or blank kits at random', async ({ page }) => {
  await page.setContent(menuSection({ key: 'mem2', title: 'Memory', choices: [
    { id: 'mem2_slots', title: 'Memory', rows: [
      { pid: 'BLANK', description: 'HPE Memory Blank Kit', select: [0, 1] },
      { pid: 'GONE', description: 'Discontinued DIMM', unavailable: true, select: [0, 1] },
      { pid: 'DIMM', description: '32GB DIMM', select: [0, 1, 2] },
    ] },
  ] }));
  const original = Math.random;
  Math.random = () => 0;
  try {
    const instruction = random('Memory');
    await new ComponentEngine(page).executeGeneric(instruction);
    expect(instruction).toMatchObject({ productNumber: 'DIMM', quantity: 1 });
  } finally { Math.random = original; }
});

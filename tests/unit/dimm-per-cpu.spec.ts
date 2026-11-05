import { test, expect } from '@playwright/test';
import { ComponentEngine, dimmPerCpuRule, dimmTotalFor } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';

// P46252-B21, HPE Alletra Storage Server 4120 24LFF (run 3cd3578d, 2026-11-05), on Additional Processors.
const ruleText = 'If any of these processors (P50810-B21, P50814-B21, P50815-B21) is selected, Then the following DIMM qty per CPU are allowed 0, 1, 2, 4, 8 '
  + 'Else, for all other processor SKUs, only the following DIMM qty per CPU are allowed 1, 2, 4, 6, 8, 12 Any other DIMM qty per CPU is NOT allowed';

test('reads the allowed DIMMs per CPU for the selected processor', () => {
  const allowedFor = dimmPerCpuRule(ruleText)!;
  expect(allowedFor('P50810-B21')).toEqual([1, 2, 4, 8]);
  expect(allowedFor('p50815-b21')).toEqual([1, 2, 4, 8]);
  expect(allowedFor('P50803-B21')).toEqual([1, 2, 4, 6, 8, 12]);
  expect(dimmPerCpuRule('Only the following DIMM qty per CPU are allowed 2, 4')!('ANY')).toEqual([2, 4]);
  expect(dimmPerCpuRule('Minimum 2 drives must be selected')).toBeNull();
});

test('the Memory total is the smallest allowed per-CPU count times processors at or above the current one', () => {
  expect(dimmTotalFor(1, 2, [1, 2, 4, 6, 8, 12])).toBe(2);
  expect(dimmTotalFor(5, 2, [1, 2, 4, 6, 8, 12])).toBe(8);
  expect(dimmTotalFor(4, 2, [1, 2, 4, 6, 8, 12])).toBe(4);
  expect(dimmTotalFor(3, 1, [1, 2, 4, 8])).toBe(4);
  expect(dimmTotalFor(40, 2, [1, 2, 4, 8])).toBe(16);
  expect(dimmTotalFor(1, 2, [])).toBeNull();
});

test('a flagged DIMM-per-CPU rule raises Memory to match the processors, and leaves Processor as it is', async ({ page }) => {
  await page.setContent(menuSection({ key: 'ProcessorSection', title: 'Processor', choices: [
    { id: 'ProcessorSection_ProcessorChoice', title: 'Processor', rows: [
      { pid: 'P50803-B21', description: 'Intel Xeon-Gold 5416S 2.0GHz 16-core 150W Processor', quantity: 2, select: [0, 1, 2] },
    ] },
    { id: 'ProcessorSection_AdditionalProcessorsChoice', title: 'Additional Processors', flagged: true,
      messages: `<li class="message_li"><span class="error_message">${ruleText} (<a class="err-lnk" id="MemorySection_MemoryChoice">Memory</a>, `
        + '<a class="err-lnk" id="ProcessorSection_AdditionalProcessorsChoice">Processor</a>)</span></li>',
      rows: [{ pid: 'P50803-B22', description: 'Intel Xeon-Gold 5416S Processor Kit', select: [0, 1] }] },
  ] }) + menuSection({ key: 'MemorySection', title: 'Memory', collapsed: true, choices: [
    { id: 'MemorySection_MemoryChoice', title: 'Memory', rows: [
      { pid: 'P43322-F21', description: 'HPE 16GB Single Rank x8 DDR5-4800 Registered Smart Memory Kit', quantity: 1, select: [0, 1, 2, 4, 8, 16] },
    ] },
  ] }));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_P43322-F21_MemorySection_MemoryChoice .item_qty_div')).toHaveText('2');
  await expect(page.locator('#item_tr_P50803-B21_ProcessorSection_ProcessorChoice .item_qty_div')).toHaveText('2');
  await expect(page.locator('#item_tr_P50803-B22_ProcessorSection_AdditionalProcessorsChoice .item_qty_div')).toHaveText('0');
});

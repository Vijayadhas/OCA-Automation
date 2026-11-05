import { test, expect } from '@playwright/test';
import { pickDescribedOption } from '../../src/automation/model-search';
import { ComponentEngine } from '../../src/automation/component-engine';
import { copyOfSelections } from '../../src/automation/oca-engine';
import { ExcelValidator } from '../../src/excel/excel-validator';
import { isFrameSolution, type OcaJob } from '../../src/models/job';
import { prepareRunJobs } from '../../src/app/run-workbook';
import { menuSection } from './oca-menu-fixture';

// User, 2026-11-05: several HPE Synergy frame solutions share a part number; the Model Description picks one.
const results = [
  'P06011-B21 HPE Synergy 2 Frame Solution',
  'P06011-B21 HPE Synergy 3 Frame Solution',
  'P06011-B21 HPE Synergy 4 Frame Solution',
  'P06011-B21 HPE Synergy TAA 3 Frame Solution',
  'P06011-B21 HPE Synergy 3 Frame with HC Fan Solution',
];

test('the Model Description picks the frame solution among results sharing a part number', () => {
  expect(pickDescribedOption(results, 'P06011-B21', 'HPE Synergy 3 Frame Solution')).toBe(1);
  expect(pickDescribedOption(results, 'P06011-B21', 'HPE Synergy 4 Frame Solution')).toBe(2);
  // Extra spaces and letter case, as typed in the list the user shared ("HPE Synergy TAA   3 Frame").
  expect(pickDescribedOption(results, 'P06011-B21', ' hpe synergy TAA   3 Frame Solution ')).toBe(3);
  expect(pickDescribedOption(results, 'P06011-B21', 'HPE Synergy 3 Frame with HC Fan Solution')).toBe(4);
  expect(pickDescribedOption(results, 'P06011-B21', 'HPE Synergy 5 Frame Solution')).toBe(-1);
  // An exact match wins over a result that only contains the description.
  expect(pickDescribedOption(['P1 HPE X Solution Bundle', 'P1 HPE X Solution - -'], 'P1', 'HPE X Solution')).toBe(1);
  expect(pickDescribedOption(['P1 HPE X Solution Bundle'], 'P1', 'HPE X Solution')).toBe(0);
});

const job = (fields: Partial<OcaJob>) => ({
  jobId: 'JOB-021', modelNumber: 'P06011-B21', quotationMode: 'aaS', isSolution: false, isStorage: false,
  serviceType: 'Random', generateEndBom: true, enabled: true, inputRow: 2, source: { kind: 'detailed-excel', instructions: [] }, ...fields,
}) as unknown as OcaJob;

test('Synergy Frame takes the Menu route and needs a Model Description', () => {
  const [prepared] = prepareRunJobs([job({ modelType: 'Synergy Frame', modelDescription: 'HPE Synergy 3 Frame Solution' })]);
  expect([prepared.isSolution, prepared.isStorage, isFrameSolution(prepared)]).toEqual([false, false, true]);
  expect(isFrameSolution(job({ modelType: 'Server' }))).toBe(false);
  expect(() => new ExcelValidator().validate([job({ modelType: 'Synergy Frame' })])).toThrow(/needs a Model Description/);
  expect(() => new ExcelValidator().validate([job({ modelType: 'Synergy Frame', modelDescription: 'HPE Synergy 2 Frame Solution' })])).not.toThrow();
});

// A frame's Menu as recorded: "Compute and Storage" lists Configure-to-order compute modules (2026-11-05 recording).
const frameMenu = menuSection({ key: 'bladesSection', title: 'Compute and Storage', choices: [
  { id: 'bladesSection_blades', title: 'Compute and Storage', rows: [
    { pid: 'P68217-B21', description: 'HPE Synergy 480 Gen12 Configure-to-order Compute Module', select: [0, 1, 2] },
    { pid: 'P99999-B21', description: 'HPE Synergy 480 Gen11 Configure-to-order Compute Module', select: [0, 1, 2] },
    { pid: 'R0Q01A', description: 'HPE Synergy D3940 Storage Module', select: [0, 1] },
  ] },
] }) + menuSection({ key: 'ic', title: 'Interconnects', collapsed: true, choices: [
  { id: 'ic_main', title: 'Interconnects', rows: [{ pid: 'IC-1', description: 'HPE Virtual Connect SE 100Gb F32 Module', select: [0, 1] }] },
] });

const quantity = (page: import('@playwright/test').Page, pid: string) => page.locator(`[id^="item_tr_${pid}_"] .item_qty_div`).textContent();

test('frame 1 gets one random Configure-to-order server, nothing else', async ({ page }) => {
  await page.setContent(frameMenu);
  const server = await new ComponentEngine(page).addConfigureToOrderProduct();
  expect(['P68217-B21', 'P99999-B21']).toContain(server.productNumber);
  expect(server).toMatchObject({ quantity: 1, sectionTitle: 'Compute and Storage' });
  expect(await quantity(page, server.productNumber)).toBe('1');
  expect(await quantity(page, 'R0Q01A')).toBe('0');
  expect(await quantity(page, 'IC-1')).toBe('0');
});

test('frame 1 gets the Excel Server, by part number or description words', async ({ page }) => {
  await page.setContent(frameMenu);
  expect((await new ComponentEngine(page).addConfigureToOrderProduct('P99999-B21')).productNumber).toBe('P99999-B21');
  await page.setContent(frameMenu);
  expect((await new ComponentEngine(page).addConfigureToOrderProduct('Synergy 480 Gen12')).productNumber).toBe('P68217-B21');
  await page.setContent(frameMenu);
  await expect(new ComponentEngine(page).addConfigureToOrderProduct('P00000-B21')).rejects.toThrow(/not offered/);
});

test('the next frame gets the same server in the same section', async ({ page }) => {
  await page.setContent(frameMenu);
  await new ComponentEngine(page).addProductInSection('Compute and Storage', 'P68217-B21', 1);
  expect(await quantity(page, 'P68217-B21')).toBe('1');
  expect(await quantity(page, 'P99999-B21')).toBe('0');
});

test('frame 1\'s picks become the same products and quantities for every other frame', () => {
  const copied = copyOfSelections([
    { jobId: 'J', section: 'Processor', selectionType: 'random', productNumber: 'P73834-B21', quantity: 2, sequence: 10 },
    { jobId: 'J', section: 'Memory', selectionType: 'random', productNumber: 'P69728-F21', quantity: 4, sequence: 20 },
    { jobId: 'J', section: 'Drive Cage', selectionType: 'quantity', productNumber: 'P68218-B21', quantity: 1, sequence: 50 },
    { jobId: 'J', section: 'Smart Chassis', selectionType: 'configuration', configurationText: 'Default', sequence: 30 },
  ]);
  expect(copied.map((item) => [item.section, item.selectionType, item.productNumber, item.quantity])).toEqual([
    ['Processor', 'quantity', 'P73834-B21', 2],
    ['Memory', 'quantity', 'P69728-F21', 4],
    ['Drive Cage', 'quantity', 'P68218-B21', 1],
    ['Smart Chassis', 'configuration', undefined, undefined],
  ]);
});

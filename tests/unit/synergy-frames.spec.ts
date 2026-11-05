import { test, expect } from '@playwright/test';
import { pickDescribedOption } from '../../src/automation/model-search';
import { ComponentEngine, generationOf, newestGeneration } from '../../src/automation/component-engine';
import { partOfKey } from '../../src/automation/configuration-navigation';
import { copyOfSelections, otherFrames } from '../../src/automation/oca-engine';
import { ExcelValidator } from '../../src/excel/excel-validator';
import { isFrameSolution, serviceTypeFor, type OcaJob } from '../../src/models/job';
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

test('frame 1 gets one random Configure-to-order server of the newest generation, nothing else', async ({ page }) => {
  await page.setContent(frameMenu);
  const server = await new ComponentEngine(page).addConfigureToOrderProduct();
  // Gen12 over Gen11 (the 2-frame recording lists an older Synergy 480 beside P68217-B21).
  expect(server).toMatchObject({ productNumber: 'P68217-B21', quantity: 1, sectionTitle: 'Compute and Storage' });
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

test('a server frame 1 already has is kept, not added again', async ({ page }) => {
  await page.setContent(menuSection({ key: 'bladesSection', title: 'Compute and Storage', choices: [
    { id: 'bladesSection_blades', title: 'Compute and Storage', rows: [
      { pid: 'P68217-B21', description: 'HPE Synergy 480 Gen12 Configure-to-order Compute Module', quantity: 1, select: [0, 1, 2] },
      { pid: 'P99998-B21', description: 'HPE Synergy 660 Gen12 Configure-to-order Compute Module', select: [0, 1, 2] },
    ] },
  ] }));
  const server = await new ComponentEngine(page).addConfigureToOrderProduct();
  expect(server).toMatchObject({ productNumber: 'P68217-B21', quantity: 1 });
  expect(await quantity(page, 'P99998-B21')).toBe('0');
});

// Show more as captured on P06011-B21 (2026-11-05): a label for the hidden checkbox #showmore_<choice id>.
test('servers behind "Show more" are listed before one is picked, and the list is not folded again', async ({ page }) => {
  const hidden = frameMenu.replace('id="item_tr_P68217-B21_bladesSection_blades"', 'id="item_tr_P68217-B21_bladesSection_blades" style="display:none"');
  await page.setContent(`${hidden}<label for="showmore_bladesSection_blades" class="hpe-btn hpe-secondary view-btn">Show more &gt;&gt;</label>
    <input type="checkbox" id="showmore_bladesSection_blades" style="display: none;"
      onchange="document.getElementById('item_tr_P68217-B21_bladesSection_blades').style.display = this.checked ? '' : 'none'">`);
  expect((await new ComponentEngine(page).addConfigureToOrderProduct('P68217-B21')).productNumber).toBe('P68217-B21');
  expect(await quantity(page, 'P68217-B21')).toBe('1');
});

test('reads generations and tree key part numbers', () => {
  expect(generationOf('HPE Synergy 480 Gen12 Configure-to-order Compute Module')).toBe(12);
  expect(generationOf('HPE Synergy 480 Gen9 Configure-to-order Compute Module')).toBe(9);
  expect(generationOf('HPE Synergy D3940 Storage Module')).toBe(0);
  expect(newestGeneration([{ description: 'A Gen9' }, { description: 'B Gen12' }, { description: 'C Gen12' }]).map((item) => item.description))
    .toEqual(['B Gen12', 'C Gen12']);
  expect(newestGeneration([{ description: 'No generation' }])).toHaveLength(1);
  expect(partOfKey('|OCA_1|instance_2_GROUP|P06011-B21_3')).toBe('P06011-B21');
  expect(partOfKey('|…|ZU715A_1|P53921-B21#GTA_57')).toBe('P53921-B21');
  expect(partOfKey('|root')).toBe('');
});

test('Synergy Frame selects Lite unless the Service Type column names another', () => {
  expect(serviceTypeFor(job({ modelType: 'Synergy Frame', serviceType: 'Random' }))).toBe('Lite');
  expect(serviceTypeFor(job({ modelType: 'Synergy Frame', serviceType: '' }))).toBe('Lite');
  expect(serviceTypeFor(job({ modelType: 'Synergy Frame', serviceType: 'Standard' }))).toBe('Standard');
  expect(serviceTypeFor(job({ modelType: 'Server', serviceType: 'Random' }))).toBe('Random');
});

test('"Show more" is clicked only while its list is folded', async ({ page }) => {
  await page.setContent(`<label for="showmore_a">Show more &gt;&gt;</label><input type="checkbox" id="showmore_a" style="display:none">
    <label for="showmore_b">Show more &gt;&gt;</label><input type="checkbox" id="showmore_b" style="display:none" checked>`);
  await new ComponentEngine(page).showMoreRows();
  await expect(page.locator('#showmore_a')).toBeChecked();
  await expect(page.locator('#showmore_b')).toBeChecked();
});

// Row markup captured on P06011-B21 (HPE Synergy 3 Frame, run of 2026-11-05): the quantity is in td.item_qty_quoted,
// with td.item_qty_dnq beside it, not td.item_qty. Such rows were not seen as pickable ("No Configure-to-order
// product is offered").
test('a server whose quantity is in td.item_qty_quoted is picked and set there', async ({ page }) => {
  const quoted = frameMenu.replace(/<td class="item_qty">(.*?)<\/td><\/tr>/gs,
    '<td class="item_qty_quoted ">$1</td><td class="item_qty_dnq "><div class="item_qty_div">0</div></td></tr>');
  expect(quoted).toContain('item_qty_quoted');
  await page.setContent(quoted);
  const server = await new ComponentEngine(page).addConfigureToOrderProduct();
  expect(server).toMatchObject({ productNumber: 'P68217-B21', quantity: 1 });
  await expect(page.locator('#item_tr_P68217-B21_bladesSection_blades td.item_qty_quoted .item_qty_div')).toHaveText('1');
  await expect(page.locator('#item_tr_P68217-B21_bladesSection_blades td.item_qty_dnq .item_qty_div')).toHaveText('0');
});

// OCA's navigation tree of P06011-B21, HPE Synergy 4 Frame Solution (run fb6e0b0d, 2026-11-05), after frame 1's server.
const tree4 = [
  ['root', 'OCA Config 2', '(HPE Synergy 4 Frame Solution)'],
  ['|G|instance_2_GROUP', 'Addons for Synergy 4 Frame #1 Group', '(HPE Synergy 4 Frame Solution)'],
  ['|G|instance_2_GROUP|P06011-B21_1', 'Addons for Synergy Master 1 Frame #1', '(HPE Synergy 12000 Configure-to-order Frame with 10x Fans)'],
  ['|G|instance_2_GROUP|P06011-B21_1|P68217-B21_1', 'Synergy 480 Gen12 #1', '(HPE Synergy 480 Gen12 Configure-to-order Compute Module)'],
  ['|G|instance_2_GROUP|P06011-B21_1|876852-B21_1', '4-port Frame Link Module #1', '(HPE Synergy 4-port Frame Link Module)'],
  ['|G|instance_2_GROUP|P06011-B21_1|867796-B21_1', '100Gb Virtual #1', '(HPE Virtual Connect SE 100Gb F32 Module for Synergy)'],
  ['|G|instance_2_GROUP|P06011-B21_5', 'Addons for Synergy Master 2 Frame #1', '(HPE Synergy 12000 Configure-to-order Frame with 10x Fans)'],
  ['|G|instance_2_GROUP|P06011-B21_5|876852-B21_1', '4-port Frame Link Module #3', '(HPE Synergy 4-port Frame Link Module)'],
  ['|G|instance_2_GROUP|P06011-B21_7', 'Addons for Synergy Satellite Frame #1', '(HPE Synergy 12000 Configure-to-order Frame with 10x Fans)'],
  ['|G|instance_2_GROUP|P06011-B21_7|867793-B21_1', '50Gb Interconnect #3', '(HPE Synergy 50Gb Interconnect Link Module)'],
  ['|G|instance_2_GROUP|P06011-B21_3', 'Addons for Synergy Satellite Frame #2', '(HPE Synergy 12000 Configure-to-order Frame with 10x Fans)'],
  ['|G|instance_2_GROUP|P06011-B21_3|876852-B21_3', '4-port Frame Link Module #8', '(HPE Synergy 4-port Frame Link Module)'],
].map(([key, label, description]) => ({ key, label, description }));

test('the other frames are the solution\'s frames, not frame 1 or Frame Link Modules', () => {
  const frames = otherFrames(tree4, 'P06011-B21', 'Addons for Synergy 4 Frame #1 Group', ['|G|instance_2_GROUP|P06011-B21_1|P68217-B21_1']);
  expect(frames.map((entry) => entry.label)).toEqual([
    'Addons for Synergy Master 2 Frame #1', 'Addons for Synergy Satellite Frame #1', 'Addons for Synergy Satellite Frame #2',
  ]);
  // A TAA model number (P06011-B22) still finds the frames by their Configure-to-order Frame description.
  expect(otherFrames(tree4, 'P06011-B22', 'Addons for Synergy 4 Frame #1 Group', ['|G|instance_2_GROUP|P06011-B21_1|P68217-B21_1']))
    .toHaveLength(3);
});

test('the next frame\'s server is its own selectable row, not an unavailable copy shown by "Show more"', async ({ page }) => {
  const withCopy = frameMenu.replace('</tbody></table>', `<tr class="item_tr unavailable extended" id="item_tr_P68217-B21_GTA_bladesSection_blades"
      data-elementid="bladesSection_blades"><td></td><td class="item_prod"><span class="_pid">P68217-B21</span></td>
      <td class="item_desc">HPE Synergy 480 Gen12 Configure-to-order Compute Module</td>
      <td class="item_qty"><div class="item_qty_div">0</div></td></tr></tbody></table>`);
  await page.setContent(withCopy);
  await new ComponentEngine(page).addProductInSection('Compute and Storage', 'P68217-B21', 1);
  await expect(page.locator('#item_tr_P68217-B21_bladesSection_blades .item_qty_div')).toHaveText('1');
  await expect(page.locator('#item_tr_P68217-B21_GTA_bladesSection_blades .item_qty_div')).toHaveText('0');
});

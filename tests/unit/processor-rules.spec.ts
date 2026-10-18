import { test, expect, type Locator } from '@playwright/test';
import { ComponentEngine, MAX_RANDOM_PROCESSOR_WATTS, fitQuantity, requiredProcessorSeries } from '../../src/automation/component-engine';
import { resolveConfigurationErrors } from '../../src/automation/configuration-errors';
import { QuantityHandler } from '../../src/components/quantity-handler';
import { menuSection, type FixtureRow } from './oca-menu-fixture';

const processorSection = (cpus: FixtureRow[], heatsinks: FixtureRow[] = []) => menuSection({
  key: 'cpuX', title: 'Processor', choices: [
    { id: 'cpuX_cpus', title: 'Processor', rows: cpus.map((cpu) => ({ radio: true, ...cpu })) },
    { id: 'cpuX_heat', title: 'Heatsink Kit', rows: heatsinks },
  ],
});

test('required Processor recovery keeps an open section open and its selection unchanged', async ({ page }) => {
  await page.setContent(processorSection(
    [{ pid: 'P73834-B21', description: 'Intel Xeon 6767P 2.4GHz 64-core 350W Processor for HPE', quantity: 1, checked: true }],
    [{ pid: 'P74787-B21', description: 'High Performance Heat Sink Kit', quantity: 1 }],
  ));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#body_cpuX')).toBeVisible();
  await expect(page.locator('#item_tr_P73834-B21_cpuX_cpus .item_qty_div')).toHaveText('1');
});

test(`random Processor skips CPUs over ${MAX_RANDOM_PROCESSOR_WATTS}W and never picks a heatsink`, async ({ page }) => {
  await page.setContent(processorSection([
    { pid: 'HOT-350', description: 'Intel Xeon 6767P 2.4GHz 64-core 350W Processor for HPE' },
    { pid: 'COOL-205', description: 'Intel Xeon 6710E 2.4GHz 64-core 205W Processor for HPE' },
    { pid: 'EDGE-270', description: 'Intel Xeon 2.0GHz 32-core 270W Processor for HPE' },
  ], [{ pid: 'HEAT', description: 'Heat Sink Kit' }]));
  const originalSet = QuantityHandler.prototype.set;
  const picked: string[] = [];
  QuantityHandler.prototype.set = async (_row: Locator, productNumber: string, quantity: number) => {
    picked.push(productNumber);
    return quantity;
  };
  try {
    for (let run = 0; run < 6; run += 1) await new ComponentEngine(page).selectRandom('Processor');
  } finally { QuantityHandler.prototype.set = originalSet; }
  expect(picked).toHaveLength(6);
  expect(picked.filter((pid) => pid === 'HOT-350' || pid === 'HEAT')).toEqual([]);
});

test('random Processor reports when every visible CPU is over the limit', async ({ page }) => {
  await page.setContent(processorSection([{ pid: 'HOT-350', description: 'Intel Xeon 6767P 2.4GHz 64-core 350W Processor' }]));
  await expect(new ComponentEngine(page).selectRandom('Processor'))
    .rejects.toThrow(/No selectable Processor product in "Processor" \(visible rows: 1; over 270W: 1\)/);
});

test('an unresolved cross-section rule quotes OCA error messages, not warnings', async ({ page }) => {
  await page.setContent(`
    <div id="section_header_ProcessorSection"><i title="Error">!</i> Processor
      <div class="section_counter">0 1 2</div></div>
    <div class="choice_messages error_bgd" style="display:none"><span class="error_message">
      If Processor (&gt;270W) is selected with Performance Heatsink, then Maximum 1 quantity of OCP cards can be selected.</span></div>
    <div class="choice_messages warning_bgd"><span class="error_message">Only a warning</span></div>`);
  const error = await resolveConfigurationErrors(page, {
    satisfyRequiredSection: async () => undefined,
    satisfyVisibleRequiredControl: async () => false,
  }).catch((caught: Error) => caught);
  expect(String(error)).toContain('OCA error icons remain: Processor. OCA messages: If Processor (>270W) is selected with Performance Heatsink');
  expect(String(error)).not.toContain('Only a warning');
});

// Rules as OCA renders them on P83540-B21 (DL580 Gen12): each li names its choices with a.err-lnk.
const dl580Rules = `<div class="choice_messages error_bgd"><ul class="messages_ul">
  <li class="message_li"><span class="error_message">CTO Server with 2 Processors (System: Std 0 // Max 32)
    (User Selection: Min 2 // Max 32) Total memory selection must be in quantities of 2 / 4 / 8 / 16 / 24 / 32 only
    (<a class="err-lnk" id="cpuX_cpus">Processor</a>, <a class="err-lnk" id="memX_slots">Memory</a>)</span></li>
  <li class="message_li"><span class="error_message">CTO Server (System: Std 0 // Max 4) (User Selection: Min 2 // Max 4)
    Odd quantities of processor selection is not allowed. (<a class="err-lnk" id="cpuX_cpus">Processor</a>)</span></li>
</ul></div>`;
const addRules = (page: import('@playwright/test').Page) => page.locator('#choice_header_cpuX_cpus td')
  .evaluate((cell, html) => cell.insertAdjacentHTML('beforeend', html), dl580Rules);

test('fits a quantity into an OCA rule', () => {
  expect(fitQuantity(1, { min: 2, max: 4, even: true })).toBe(2);
  expect(fitQuantity(3, { min: 2, max: 4, even: true })).toBe(4);
  expect(fitQuantity(5, { min: 2, max: 4, even: true })).toBe(4);
  expect(fitQuantity(1, { min: 0, max: Number.POSITIVE_INFINITY, even: false })).toBe(1);
});

test('reads only the quantity rule that covers the choice alone', async ({ page }) => {
  await page.setContent(processorSection([{ pid: 'CPU', radio: false, select: [0, 1, 2, 3, 4] }]));
  await addRules(page);
  expect(await new ComponentEngine(page).quantityRule('cpuX_cpus')).toEqual({ min: 2, max: 4, even: true });
});

test('raises a random processor quantity to what OCA allows', async ({ page }) => {
  await page.setContent(processorSection([{ pid: 'CPU', description: '210W Processor', radio: false, select: [0, 1, 2, 3, 4] }]));
  await addRules(page);
  const original = Math.random;
  Math.random = () => 0;
  try {
    expect(await new ComponentEngine(page).selectRandom('Processor')).toMatchObject({ productNumber: 'CPU', quantity: 2 });
  } finally { Math.random = original; }
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('2');
});

test('corrects an existing processor quantity that breaks the OCA rule', async ({ page }) => {
  await page.setContent(processorSection([{ pid: 'CPU', radio: false, quantity: 1, select: [0, 1, 2, 3, 4] }]));
  await addRules(page);
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('2');
});

test('reads "quantity must be Qty N" as an exact quantity', async ({ page }) => {
  // P83540-B21: "In 2P configurations, if only 8EDSFF drive cage is selected, then the drive cage quantity must be Qty 2."
  await page.setContent(processorSection([{ pid: 'CPU', radio: false, select: [0, 1, 2] }]));
  await page.locator('#choice_header_cpuX_cpus td').evaluate((cell) => cell.insertAdjacentHTML('beforeend',
    `<div class="choice_messages error_bgd"><ul><li class="message_li"><span class="error_message">In 2P configurations, if only
      8EDSFF drive cage is selected, then the drive cage quantity must be Qty 2. (<a class="err-lnk" id="cpuX_cpus">Drive Cage</a>)</span></li></ul></div>`));
  expect(await new ComponentEngine(page).quantityRule('cpuX_cpus')).toEqual({ min: 2, max: 2, even: false });
});

test('reads "Minimum N and Maximum M of ... must be selected" as a quantity range', async ({ page }) => {
  // P86628-B21 (DL110 Gen12): "Minimum 2 and Maximum 2 of M.2 SSD Drive must be selected. (M.2 SSD Drive)"
  await page.setContent(processorSection([{ pid: 'CPU', radio: false, select: [0, 1, 2] }]));
  await page.locator('#choice_header_cpuX_cpus td').evaluate((cell) => cell.insertAdjacentHTML('beforeend',
    `<div class="choice_messages error_bgd"><ul><li class="message_li"><span class="error_message">Minimum 2 and Maximum 2 of
      M.2 SSD Drive must be selected. (<a class="err-lnk" id="cpuX_cpus">M.2 SSD Drive</a>)</span></li></ul></div>`));
  expect(await new ComponentEngine(page).quantityRule('cpuX_cpus')).toEqual({ min: 2, max: 2, even: false });
});

// S3V83A's DL380 Gen12 (2026-10-16): the random processor was kept at 1 and this rule stayed flagged.
test('reads "then Qty2 Processors must be selected" as a minimum and raises the processor to 2', async ({ page }) => {
  const rule = (text: string, links: string) => `<li class="message_li"><span class="error_message">${text} (${links})</span></li>`;
  await page.setContent(processorSection([{ pid: 'CPU', radio: false, quantity: 1, select: [0, 1, 2, 3, 4] }]));
  await page.locator('#choice_header_cpuX_cpus td').evaluate((cell, html) => cell.insertAdjacentHTML('beforeend', html),
    `<div class="choice_messages error_bgd"><ul>${
      rule('If this NVMe Trigger is selected, then Qty2 Processors must be selected.', '<a class="err-lnk" id="cpuX_cpus">Processor</a>')
    }${rule('Qty1 of Localization kit must be selected per configuration.', '<a class="err-lnk" id="cpuX_cpus">Processor</a>')
    }</ul></div>`);
  expect(await new ComponentEngine(page).quantityRule('cpuX_cpus')).toEqual({ min: 2, max: Number.POSITIVE_INFINITY, even: false });
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('2');
});

test('reads the processor series an OCA rule requires (X = any digit)', () => {
  const series = (text: string) => requiredProcessorSeries(text)?.pattern;
  const dl340 = series('Front 4xGPU Enable kit can be selected only if 6XX1P processor is selected');
  const dl320 = series("In 'SFF/EDSFF CTO server': Qty=3 of 4EDSFF BP Kit along with HPE DL320 G12 12EDSFF DA Cbl Kit can be selected only if 6XXX1P processor is selected");
  for (const pattern of [dl340!, dl320!, series('20EDSFF DA cbl kit is supported only with 6XX1P processor series')!]) {
    expect(pattern.test('Intel Xeon 6521P 2.6GHz 24-core 225W Processor for HPE')).toBe(true);
    expect(pattern.test('Intel Xeon 6741P 2.5GHz 48-core 300W Processor for HPE')).toBe(true);
    expect(pattern.test('Intel Xeon 6520P 2.4GHz 24-core 210W Processor for HPE')).toBe(false);
    expect(pattern.test('Intel Xeon 6710E 2.4GHz 64-core 205W Processor for HPE')).toBe(false);
  }
  expect(requiredProcessorSeries('Odd quantities of processor selection is not allowed.')).toBeNull();
  expect(requiredProcessorSeries('In 8SFFx1 U.3 Kit processor')).toBeNull();
});

// P75728-B21 (DL340 Gen12) and P75217-B21 (DL320 Gen12), 2026-10-18: a random Smart Chassis needs a 6XX1P
// processor and OCA's preselected one is not. The DL320 rule's "Qty=3 of 4EDSFF BP Kit" raised the
// processor to 3 twelve times; the processor must be swapped for the series instead, at the same quantity.
for (const [model, text] of [
  ['P75728-B21', 'In GPU CTO server, 4EDSFF Kit or 8SFFx1 U.3 Kit can be selected only if 6XX1P processor is selected'],
  ['P75217-B21', "In 'SFF/EDSFF CTO server': Qty=3 of 4EDSFF BP Kit along with HPE DL320 G12 12EDSFF DA Cbl Kit can be selected only if 6XXX1P processor is selected"],
] as const) {
  test(`replaces the processor with the series OCA requires (${model})`, async ({ page }) => {
    await page.setContent(menuSection({ key: 'cpuX', title: 'Processor', choices: [
      { id: 'cpuX_cpus', title: 'Processor', flagged: true, rows: [
        { pid: 'OLD-CPU', description: 'Intel Xeon 6520P 2.4GHz 24-core 210W Processor for HPE', quantity: 1, select: [0, 1, 2] },
        { pid: 'HOT-6761P', description: 'Intel Xeon 6761P 2.5GHz 64-core 350W Processor for HPE', select: [0, 1, 2] },
        { pid: 'SERIES-6521P', description: 'Intel Xeon 6521P 2.6GHz 24-core 225W Processor for HPE', select: [0, 1, 2] },
      ], messages: `<li class="message_li"><span class="error_message">${text} (<a class="err-lnk" id="cageX_cages">Drive Cage</a>,
        <a class="err-lnk" id="cpuX_cpus">Processor</a>)</span></li>` },
    ] }) + menuSection({ key: 'cageX', title: 'Drive Cage', choices: [
      { id: 'cageX_cages', title: 'Drive Cage', rows: [{ pid: 'CAGE', description: '4EDSFF BP Kit', quantity: 3, select: [0, 3] }] },
    ] }));
    await new ComponentEngine(page).satisfyRequiredSection('Processor');
    await expect(page.locator('#item_tr_SERIES-6521P_cpuX_cpus select')).toHaveValue('1');
    await expect(page.locator('#item_tr_OLD-CPU_cpuX_cpus select')).toHaveValue('0');
    await expect(page.locator('#item_tr_HOT-6761P_cpuX_cpus select')).toHaveValue('0');
  });
}

import { test, expect, type Locator } from '@playwright/test';
import { ComponentEngine, MAX_RANDOM_PROCESSOR_WATTS, fitQuantity, limitedProcessorSeries, requiredMemorySpeed, requiredProcessorSeries, requiredProcessorWatts } from '../../src/automation/component-engine';
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

// P97048-B21 (DL585a Gen13, 2026-10-28): every processor is 400W-600W.
test('random Processor takes the lowest power when every CPU is over the limit', async ({ page }) => {
  await page.setContent(processorSection([
    { pid: 'HOT-600', description: 'AMD EPYC 9965 2.25GHz 192-core 600W Processor for HPE' },
    { pid: 'HOT-400', description: 'AMD EPYC 9455 3.15GHz 48-core 400W Processor for HPE' },
    { pid: 'HOT-500', description: 'AMD EPYC 9655 2.6GHz 96-core 500W Processor for HPE' },
  ]));
  const originalSet = QuantityHandler.prototype.set;
  const picked: string[] = [];
  QuantityHandler.prototype.set = async (_row: Locator, productNumber: string, quantity: number) => {
    picked.push(productNumber);
    return quantity;
  };
  try {
    for (let run = 0; run < 3; run += 1) await new ComponentEngine(page).selectRandom('Processor');
  } finally { QuantityHandler.prototype.set = originalSet; }
  expect(picked).toEqual(['HOT-400', 'HOT-400', 'HOT-400']);
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
  const series = (text: string) => requiredProcessorSeries(text)?.matches;
  const dl340 = series('Front 4xGPU Enable kit can be selected only if 6XX1P processor is selected');
  const dl320 = series("In 'SFF/EDSFF CTO server': Qty=3 of 4EDSFF BP Kit along with HPE DL320 G12 12EDSFF DA Cbl Kit can be selected only if 6XXX1P processor is selected");
  for (const pattern of [dl340!, dl320!, series('20EDSFF DA cbl kit is supported only with 6XX1P processor series')!]) {
    expect(pattern('Intel Xeon 6521P 2.6GHz 24-core 225W Processor for HPE')).toBe(true);
    expect(pattern('Intel Xeon 6741P 2.5GHz 48-core 300W Processor for HPE')).toBe(true);
    expect(pattern('Intel Xeon 6520P 2.4GHz 24-core 210W Processor for HPE')).toBe(false);
    expect(pattern('Intel Xeon 6710E 2.4GHz 64-core 205W Processor for HPE')).toBe(false);
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

const errorRule = (text: string, links: Array<[string, string]>) => `<li class="message_li"><span class="error_message">${text}
  (${links.map(([id, title]) => `<a class="err-lnk" id="${id}">${title}</a>`).join(', ')})</span></li>`;

test('reads the memory speed and processor power OCA rules require', () => {
  const memory = requiredMemorySpeed('Supports only PC5-4800B Memory.')!;
  expect(memory.matches('HPE 64GB (1x64GB) Dual Rank x4 DDR5-4800 CAS-40-39-39 EC8 Registered Smart Memory Kit')).toBe(true);
  expect(memory.matches('HPE 64GB (1x64GB) Dual Rank x4 DDR5-5600 CAS-46-45-45 EC8 Registered Smart FIO Memory Kit')).toBe(false);
  const watts = requiredProcessorWatts('For 8LFF CTO Server OR SFF/EDSFF CTO Server: If Processor more than 240W and less than or equal to 500W is selected then Performance heat sink OR DLC Module must be selected.')!;
  expect(watts.matches('AMD EPYC 9135 3.65GHz 16-core 200W Processor for HPE')).toBe(true);
  expect(watts.matches('AMD EPYC 9845 2.1GHz 160-core 390W Processor for HPE')).toBe(false);
  expect(watts.matches('HPE ProLiant DL3X5 Gen11 2U Standard Heat Sink Kit')).toBe(false);
  expect(requiredMemorySpeed('Mixing of PC5-4800B Memory and PC5-5600B Memory is not allowed')).toBeNull();
});

// P55438-B21 (DL320 Gen11, 2026-10-19): OCA's processor supports only DDR5-4800 and random memory was DDR5-5600.
test('replaces memory with the speed the processor supports, at the same quantity', async ({ page }) => {
  const rule = errorRule('Supports only PC5-4800B Memory.', [['memX_slots', 'Memory'], ['cpuX_cpus', 'Processors']]);
  await page.setContent(menuSection({ key: 'cpuX', title: 'Processor', choices: [
    { id: 'cpuX_cpus', title: 'Processors', flagged: true, messages: rule, rows: [
      { pid: 'CPU', description: 'Intel Xeon-Gold 5416S 2.0GHz 16-core 150W Processor for HPE', quantity: 1, select: [0, 1] }] },
  ] }) + menuSection({ key: 'memX', title: 'Memory', collapsed: true, choices: [
    { id: 'memX_slots', title: 'Memory', flagged: true, messages: rule, rows: [
      { pid: 'FAST', description: 'HPE 64GB (1x64GB) Dual Rank x4 DDR5-5600 CAS-46-45-45 EC8 Registered Smart FIO Memory Kit', quantity: 2, select: [0, 1, 2] },
      { pid: 'SLOW', description: 'HPE 32GB (1x32GB) Dual Rank x8 DDR5-4800 CAS-40-39-39 EC8 Registered Smart Memory Kit', select: [0, 1, 2] },
    ] },
  ] }));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_SLOW_memX_slots select')).toHaveValue('2');
  await expect(page.locator('#item_tr_FAST_memX_slots select')).toHaveValue('0');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('1');
});

const heatsinkSection = (cpus: FixtureRow[], heatsinks: FixtureRow[], cpuRules: string, heatRules: string) => menuSection({
  key: 'cpuX', title: 'Processor', choices: [
    { id: 'cpuX_cpus', title: 'Processor', flagged: Boolean(cpuRules), messages: cpuRules || undefined, rows: cpus },
    { id: 'cpuX_heat', title: 'Heatsink Kit', flagged: Boolean(heatRules), messages: heatRules || undefined, rows: heatsinks },
  ],
});

// P81948-B21 (DL345 Gen12, 2026-10-18): OCA preselected a 390W processor; the Performance heat sink was unavailable.
test('replaces a processor above the power an OCA rule allows', async ({ page }) => {
  const rule = errorRule('For 8LFF CTO Server OR SFF/EDSFF CTO Server: If Processor more than 240W and less than or equal to 500W is selected then Performance heat sink OR DLC Module must be selected.',
    [['cpuX_cpus', 'Processor'], ['cpuX_heat', 'Heatsink Kit']]);
  await page.setContent(heatsinkSection([
    { pid: 'HOT', description: 'AMD EPYC 9845 2.1GHz 160-core 390W Processor for HPE', quantity: 1, select: [0, 1] },
    { pid: 'WARM', description: 'AMD EPYC 9535 2.4GHz 64-core 300W Processor for HPE', select: [0, 1] },
    { pid: 'COOL', description: 'AMD EPYC 9135 3.65GHz 16-core 200W Processor for HPE', select: [0, 1] },
  ], [
    { pid: 'STD', description: 'HPE ProLiant DL3X5 Gen11 2U Standard Heat Sink Kit', quantity: 1, select: [0, 1] },
    { pid: 'PERF', description: 'HPE ProLiant Compute DL345 Gen12 Performance Heat Sink Kit', unavailable: true, select: [0, 1] },
  ], rule, rule));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_COOL_cpuX_cpus select')).toHaveValue('1');
  await expect(page.locator('#item_tr_HOT_cpuX_cpus select')).toHaveValue('0');
  await expect(page.locator('#item_tr_WARM_cpuX_cpus select')).toHaveValue('0');
});

// P72176-B21 (DL360 Gen12, 2026-10-18): the Smart Chassis added a High Performance heat sink beside the standard one.
test('removes the extra heat sink when OCA says the processor and heat sink quantities must match', async ({ page }) => {
  const match = errorRule('Quantity of Processor and Quantity of Heatsink must match.', [['cpuX_cpus', 'Processor'], ['cpuX_heat', 'Heatsink Kit']]);
  const fans = errorRule('If Performance Heatsink is selected, then Standard fan cannot be selected.', [['cpuX_heat', 'Heatsink Kit'], ['fanX_fans', 'Power Cooling Options']])
    + errorRule('If Performance Heatsink or DLC Module is selected, then Performance Fan must be selected and vice versa.', [['cpuX_heat', 'Heatsink Kit'], ['fanX_fans', 'Power Cooling Options']]);
  await page.setContent(heatsinkSection(
    [{ pid: 'CPU', description: 'Intel Xeon 6505P 2.2GHz 12-core 150W Processor for HPE', quantity: 1, select: [0, 1, 2] }],
    [
      { pid: 'STD', description: 'HPE ProLiant DL3X0 Gen11 1U Standard Heat Sink Kit', quantity: 1, select: [0, 1] },
      { pid: 'PERF', description: 'HPE ProLiant Compute DL3XX Gen12 High Performance Heat Sink Kit', quantity: 1, select: [0, 1] },
    ], match, match + fans));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_PERF_cpuX_heat select')).toHaveValue('0');
  await expect(page.locator('#item_tr_STD_cpuX_heat select')).toHaveValue('1');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('1');
});

test('raises the heat sink when two processors stand against one heat sink', async ({ page }) => {
  const match = errorRule('Quantity of Processor and Quantity of Heatsink must match.', [['cpuX_cpus', 'Processor'], ['cpuX_heat', 'Heatsink Kit']]);
  await page.setContent(heatsinkSection(
    [{ pid: 'CPU', description: 'Intel Xeon 6505P 2.2GHz 12-core 150W Processor for HPE', quantity: 2, select: [0, 1, 2] }],
    [{ pid: 'STD', description: 'HPE ProLiant DL3X0 Gen11 1U Standard Heat Sink Kit', quantity: 1, select: [0, 1, 2] }], match, match));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_STD_cpuX_heat select')).toHaveValue('2');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('2');
});

// S8J34A (SimpliVity 325 Gen12, 2026-10-18): the Heatsink Kit choice was empty and flagged.
test('fills an empty choice whose own rule asks for minimum one product', async ({ page }) => {
  await page.setContent(heatsinkSection(
    [{ pid: 'CPU', description: 'AMD EPYC 9135 3.65GHz 16-core 200W Processor for HPE', quantity: 1, select: [0, 1] }],
    [{ pid: 'HEAT', description: 'HPE ProLiant DL3X5 Gen11 1U Standard Heat Sink Kit', select: [0, 1] }],
    '', errorRule('Minimum one heatsink kit must be selected', [['cpuX_heat', 'Heatsink Kit']])));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_HEAT_cpuX_heat select')).toHaveValue('1');
});

// S8J34A (2026-10-22): a random DLC Cold Plate Module brought liquid cooling infrastructure errors.
test('a flagged choice is filled with an air-cooled product, not a liquid-cooled one', async ({ page }) => {
  await page.setContent(heatsinkSection(
    [{ pid: 'CPU', description: 'AMD EPYC 9135 3.65GHz 16-core 200W Processor for HPE', quantity: 1, select: [0, 1] }],
    [
      { pid: 'DLC', description: 'HPE ProLiant Compute DL325 Gen12 Direct Liquid Cooling Cold Plate Module FIO Kit', select: [0, 1] },
      { pid: 'CLOSED', description: 'HPE ProLiant Compute DL325 Gen12 Closed-loop Liquid Cooling Heat Sink Kit', select: [0, 1] },
      { pid: 'STD', description: 'HPE ProLiant DL3X5 Gen11 1U CPU Standard Heat Sink Kit', select: [0, 1] },
    ],
    '', errorRule('Minimum one heatsink kit must be selected', [['cpuX_heat', 'Heatsink Kit']])));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_STD_cpuX_heat select')).toHaveValue('1');
  await expect(page.locator('#item_tr_DLC_cpuX_heat select')).toHaveValue('0');
  await expect(page.locator('#item_tr_CLOSED_cpuX_heat select')).toHaveValue('0');
});

// S8J34A (2026-10-22): "Qty7 of" was read as one fan kit, so the rule stayed and the heat sink was replaced.
test('reads "then Qty7 of ... must be selected" as seven', async ({ page }) => {
  const rule = errorRule('If Standard Heat Sink is selected then Qty7 of Standard Fan Kit or Qty7 of Performance Fan Kit must be selected. UNB Request exception',
    [['fanX_fans', 'Power Cooling Options'], ['cpuX_heat', 'Heatsink Kit']]);
  await page.setContent(heatsinkSection(
    [{ pid: 'CPU', description: 'AMD EPYC 9135 3.65GHz 16-core 200W Processor for HPE', quantity: 1, select: [0, 1] }],
    [{ pid: 'STD', description: 'HPE ProLiant DL3X5 Gen11 1U CPU Standard Heat Sink Kit', quantity: 1, select: [0, 1] }],
    '', rule) + menuSection({ key: 'fanX', title: 'Power', collapsed: true, choices: [{ id: 'fanX_fans', title: 'Power Cooling Options', rows: [
    { pid: 'STDFAN', description: 'HPE ProLiant DL3XX Gen12 1U Standard Fan Kit', select: [0, 1, 7] },
    { pid: 'PERFFAN', description: 'HPE ProLiant DL3XX Gen12 1U Performance Fan Kit', select: [0, 1, 7] },
  ] }] }));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  const fans = [await page.locator('#item_tr_STDFAN_fanX_fans select').inputValue(), await page.locator('#item_tr_PERFFAN_fanX_fans select').inputValue()];
  expect(fans.sort()).toEqual(['0', '7']);
  await expect(page.locator('#item_tr_STD_cpuX_heat select')).toHaveValue('1');
});

// P53934-B21 (DL365 Gen11 EDSFF, 2026-10-19): OCA's own base held two Standard and one Performance heat sink against
// two processors; the Standard one is "Supported with 8SFF CTO Model Only".
test('removes the product OCA rules forbid most before matching processor and heat sink quantities', async ({ page }) => {
  const heat = (number: string): [string, string] => ['cpuX_heat', `${number} (Heatsink Kit)`];
  const fan = (number: string): [string, string] => ['fanX_fans', `${number} (Power Cooling Options)`];
  const match = errorRule('Quantity of Processor and Quantity of Heatsink must be equal.', [['cpuX_cpus', 'Processors'], ['cpuX_heat', 'Heatsink Kit']]);
  const rules = match
    + errorRule('If Standard Heatsink is selected, then Performance Fan cannot be selected.', [fan('P58462-B21'), heat('P58456-B21')])
    + errorRule('If Performance Heatsink OR DLC Module is selected, then Standard Fan cannot be selected', [fan('P58461-B21'), heat('P58457-B21')])
    + errorRule('Mixing of Standard and Performance Heatsink is NOT allowed.', [heat('P58457-B21'), heat('P58456-B21')])
    + errorRule('Max 2 Heat Sink can be allowed', [heat('P58456-B21'), heat('P58457-B21')])
    + errorRule('Supported with 8SFF CTO Model Only.', [heat('P58456-B21')]);
  await page.setContent(heatsinkSection(
    [{ pid: 'P58540-B21', description: 'AMD EPYC 9224 2.5GHz 24-core 200W Processor for HPE', quantity: 2, select: [0, 1, 2] }],
    [
      { pid: 'P58456-B21', description: 'HPE ProLiant DL3X5 Gen11 1U CPU Standard Heat Sink Kit', quantity: 2, select: [0, 1, 2] },
      { pid: 'P58457-B21', description: 'HPE ProLiant DL3X5 Gen11 1U CPU Performance Heat Sink Kit', quantity: 1, select: [0, 1, 2] },
    ], match, rules) + menuSection({ key: 'fanX', title: 'Power', collapsed: true, choices: [{ id: 'fanX_fans', title: 'Power Cooling Options', rows: [
    { pid: 'P58461-B21', description: 'HPE ProLiant DL3XX Gen11 1U Standard Fan Kit', quantity: 7, select: [0, 1, 7] },
    { pid: 'P58462-B21', description: 'HPE ProLiant DL3XX Gen11 1U Performance Fan Kit', quantity: 1, select: [0, 1, 7] },
  ] }] }));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_P58456-B21_cpuX_heat select')).toHaveValue('0');
  await expect(page.locator('#item_tr_P58457-B21_cpuX_heat select')).toHaveValue('1');
  await expect(page.locator('#item_tr_P58461-B21_fanX_fans select')).toHaveValue('7');
  await expect(page.locator('#item_tr_P58540-B21_cpuX_cpus select')).toHaveValue('2');
});

// P67161-B21 (DL365 Gen11 OEM, 2026-10-19).
test('raises the processor when a rule over several choices asks for 2 Processor', async ({ page }) => {
  const rule = errorRule('If Secondary riser is selected, then 2 Processor must be selected.', [['riserX_risers', 'Riser Cards'], ['cpuX_cpus', 'Processors']]);
  await page.setContent(heatsinkSection([{ pid: 'CPU', description: 'AMD EPYC 9224 2.25GHz 24-core 200W Processor for HPE OEM', quantity: 1, select: [0, 1, 2] }],
    [], rule, ''));
  expect(await new ComponentEngine(page).quantityRule('cpuX_cpus')).toEqual({ min: 2, max: Number.POSITIVE_INFINITY, even: false });
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('2');
});

// P54960-B21 (DL325 Gen11, 2026-10-19): the Processor choice stayed flagged until fans were selected.
test('adds the quantity of the product a "then 7 Qty of ... must be selected" rule asks for', async ({ page }) => {
  const rule = errorRule('Processor upto 240W is selected then 7 Qty of Standard Fan Kit must be selected. - Above rule is not applicable if Performance Fan Kit in the order',
    [['fanX_fans', 'Power Cooling Options'], ['cpuX_cpus', 'Processors']]);
  await page.setContent(heatsinkSection([{ pid: 'CPU', description: 'AMD EPYC 9334 2.7GHz 32-core 210W Processor for HPE', quantity: 1, select: [0, 1] }],
    [], rule, '') + menuSection({ key: 'fanX', title: 'Power', collapsed: true, choices: [{ id: 'fanX_fans', title: 'Power Cooling Options', rows: [
    { pid: 'STDFAN', description: 'HPE ProLiant DL3XX Gen11 1U Standard Fan Kit', select: [0, 1, 7] },
    { pid: 'LIQFAN', description: 'HPE ProLiant DL325 Gen11 Liquid Cooling Fan Kit', select: [0, 1, 7] },
  ] }] }));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_STDFAN_fanX_fans select')).toHaveValue('7');
  await expect(page.locator('#item_tr_LIQFAN_fanX_fans select')).toHaveValue('0');
});

// S3N87AAE (DL380 Gen11 for Veeam) and P52536-B21 (DL380 Gen11 vSAN), 2026-10-19.
test('reads "Minimum N ... must be selected" and a total memory capacity as minimums', async ({ page }) => {
  const own = (text: string) => errorRule(text, [['cpuX_cpus', 'Processors']]);
  await page.setContent(heatsinkSection([{ pid: 'CPU', select: [0, 1, 2] }], [],
    own('Minimum 2 Processor must be selected') + own('For Gen11/Gen12/Gen13 servers ONLY: Min 1/Max 1 per server.'), ''));
  expect((await new ComponentEngine(page).quantityRule('cpuX_cpus'))?.min).toBe(2);
  await page.setContent(heatsinkSection([{ pid: 'CPU', select: [0, 1, 2] }], [],
    own('For ALL CTO models (vSAN solutions), the Total memory capacity must total 256GB or higher.'), ''));
  expect((await new ComponentEngine(page).quantityRule('cpuX_cpus', 'HPE 32GB (1x32GB) Dual Rank x8 DDR5-5600 Memory Kit'))?.min).toBe(8);
});

test('fills an empty choice whose own rule asks for a minimum of two', async ({ page }) => {
  await page.setContent(heatsinkSection(
    [{ pid: 'CPU', description: 'Intel Xeon-Silver 4510 2.4GHz 12-core 150W Processor for HPE', quantity: 2, select: [0, 1, 2] }],
    [{ pid: 'HEAT', description: 'HPE ProLiant DL380/DL560 Gen11 High Performance 2U Heat Sink Kit', select: [0, 1, 2] }],
    '', errorRule('Minimum 2 Heat sink is required', [['cpuX_heat', 'Heatsink Kit']])));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_HEAT_cpuX_heat select')).toHaveValue('2');
});

// 2026-10-21 run: S0V52A (DL560 Gen11) had 2 x 96GB kits, P68217-B21 (Synergy 480 Gen12) 1 x 64GB kit.
const memorySection = (rows: FixtureRow[], rules = '') => menuSection({ key: 'memX', title: 'Memory', choices: [
  { id: 'memX_dimms', title: 'Memory', flagged: Boolean(rules), messages: rules || undefined, rows },
] });
const links: Array<[string, string]> = [['cpuX_cpus', 'Processors'], ['memX_dimms', 'Memory']];

test('raises the memory kits a rule names to the next quantity it allows', async ({ page }) => {
  const rule = errorRule('In 2 processor configurations, the allowed qty of 96GB Memory is either 16 or 32 only.', links);
  await page.setContent(heatsinkSection([{ pid: 'CPU', description: 'Intel Xeon-Gold 6416H 2.2GHz 18-core 165W Processor for HPE', quantity: 2, select: [0, 1, 2] }], [], rule, '')
    + memorySection([
      { pid: 'M96', description: 'HPE 96GB (1x96GB) Dual Rank x4 DDR5-4800 CAS-46-45-45 EC8 Registered Smart FIO Memory Kit', quantity: 2, select: [0, 2, 8, 16, 32] },
      { pid: 'M32', description: 'HPE 32GB (1x32GB) Dual Rank x8 DDR5-4800 CAS-40-39-39 EC8 Registered Smart FIO Memory Kit', select: [0, 2, 8, 16, 32] },
    ], rule));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_M96_memX_dimms select')).toHaveValue('16');
  await expect(page.locator('#item_tr_M32_memX_dimms select')).toHaveValue('0');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('2');
});

test('raises the total memory to the next of the quantities a rule lists', async ({ page }) => {
  const rule = errorRule('CTO Model with 2 Processors, memory min 2 // Max 32<br> Total Memory selection must be in quantities of 2/ 4/ 8/ 16 /24 /32 only', links);
  await page.setContent(heatsinkSection([{ pid: 'CPU', description: 'Intel Xeon 6 6730P 2.5GHz 32-core 250W Processor for HPE', quantity: 2, select: [0, 1, 2] }], [], '', '')
    + memorySection([{ pid: 'M64', description: 'HPE 64GB (1x64GB) Dual Rank x4 DDR5-6400 CAS-52-52-52 EC8 Registered Smart FIO Memory Kit', quantity: 1, select: [0, 1, 2, 4] }], rule));
  await new ComponentEngine(page).satisfyRequiredSection('Memory');
  await expect(page.locator('#item_tr_M64_memX_dimms select')).toHaveValue('2');
  await expect(page.locator('#item_tr_CPU_cpuX_cpus select')).toHaveValue('2');
});

// Arcus EMEA run, 2026-10-21: the DL365 Gen11 inside the solution had a Turin 9335; every V2 boot device was unavailable.
test('replaces a processor whose series OCA allows only with products that cannot be picked', async ({ page }) => {
  const text = 'Turin Processor (9xx5), (quantity one or two) is only compatible with below V2 OS Boot Device only <br> - P78297-B21 HPE NS204i-u V2 Ht Plg Boot Opt Dev<br> - P81160-B21 HPE NS204i-u v2 960GB NVMe HP Boot Dev<br> If there is any request to support 9xx5 processors with older NS204i-u options, please contact DL3x5 Product Management';
  expect(limitedProcessorSeries(text)?.matches('AMD EPYC 9335 3.0GHz 32-core 210W Processor for HPE')).toBe(false);
  expect(limitedProcessorSeries(text)?.matches('AMD EPYC 9334 2.7GHz 32-core 210W Processor for HPE')).toBe(true);
  expect(limitedProcessorSeries('Turin Processor (9xx5) must be selected')).toBeNull();
  const rule = errorRule(text, [['cpuX_cpus', 'Processors'], ['bootX_boot', 'OS Boot Device']]);
  await page.setContent(heatsinkSection([
    { pid: 'TURIN', description: 'AMD EPYC 9335 3.0GHz 32-core 210W Processor for HPE', quantity: 2, select: [0, 1, 2] },
    { pid: 'HOT', description: 'AMD EPYC 9534 2.45GHz 64-core 280W Processor for HPE', select: [0, 1, 2] },
    { pid: 'GENOA', description: 'AMD EPYC 9334 2.7GHz 32-core 210W Processor for HPE', select: [0, 1, 2] },
  ], [], rule, '') + menuSection({ key: 'bootX', title: 'OS Boot Device', choices: [{ id: 'bootX_boot', title: 'OS Boot Device', flagged: true, messages: rule, rows: [
    { pid: 'OLDBOOT', description: 'HPE NS204i-u Gen11 NVMe Hot Plug Boot Optimized Storage Device', quantity: 1, select: [0, 1] },
    { pid: 'P81160-B21', description: 'HPE NS204i-u v2 960GB NVMe Hot Plug Boot Optimized Storage Device', unavailable: true, select: [0, 1] },
  ] }] }));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_GENOA_cpuX_cpus select')).toHaveValue('2');
  await expect(page.locator('#item_tr_TURIN_cpuX_cpus select')).toHaveValue('0');
  await expect(page.locator('#item_tr_HOT_cpuX_cpus select')).toHaveValue('0');
  await expect(page.locator('#item_tr_OLDBOOT_bootX_boot select')).toHaveValue('1');
});

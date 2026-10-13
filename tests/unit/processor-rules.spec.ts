import { test, expect, type Locator } from '@playwright/test';
import { ComponentEngine, MAX_RANDOM_PROCESSOR_WATTS } from '../../src/automation/component-engine';
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

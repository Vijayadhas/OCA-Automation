import { test, expect, type Locator } from '@playwright/test';
import { ComponentEngine, MAX_RANDOM_PROCESSOR_WATTS } from '../../src/automation/component-engine';
import { resolveConfigurationErrors } from '../../src/automation/configuration-errors';
import { QuantityHandler } from '../../src/components/quantity-handler';

const processorRow = (productNumber: string, description: string, quantity: number) => `
  <tr class="item_tr${quantity ? ' selected_item' : ''}" id="item_tr_${productNumber}_ProcessorSection_ProcessorChoice"
      data-elementid="ProcessorSection_ProcessorChoice">
    <td><input type="radio"${quantity ? ' checked' : ''}></td><td><span class="_pid">${productNumber}</span></td>
    <td class="item_desc">${description}</td><td class="item_qty"><div class="item_qty_div">${quantity}</div></td>
  </tr>`;

test('required Processor recovery keeps an open section open and its selection unchanged', async ({ page }) => {
  await page.setContent(`
    <button id="section_header_ProcessorSection" onclick="document.querySelector('table').style.display = 'none'">Processor</button>
    <table>${processorRow('P73834-B21', 'Intel Xeon 6767P 2.4GHz 64-core 350W Processor for HPE', 1)}</table>`);
  await new ComponentEngine(page, 'DL360').satisfyRequiredSection('Processor');
  await expect(page.locator('table')).toBeVisible();
  await expect(page.locator('.item_qty_div')).toHaveText('1');
});

test(`random Processor skips CPUs over ${MAX_RANDOM_PROCESSOR_WATTS}W`, async ({ page }) => {
  await page.setContent(`<table>
    ${processorRow('HOT-350', 'Intel Xeon 6767P 2.4GHz 64-core 350W Processor for HPE', 0)}
    ${processorRow('COOL-205', 'Intel Xeon 6710E 2.4GHz 64-core 205W Processor for HPE', 0)}
    ${processorRow('EDGE-270', 'Intel Xeon 2.0GHz 32-core 270W Processor for HPE', 0)}</table>`);
  const originalSet = QuantityHandler.prototype.set;
  const picked: string[] = [];
  QuantityHandler.prototype.set = async (_row: Locator, productNumber: string) => { picked.push(productNumber); };
  try {
    for (let run = 0; run < 6; run += 1) await new ComponentEngine(page, 'DL360').selectRandomProcessor();
  } finally { QuantityHandler.prototype.set = originalSet; }
  expect(picked).toHaveLength(6);
  expect(picked).not.toContain('HOT-350');
});

test('random Processor reports when every visible CPU is over the limit', async ({ page }) => {
  await page.setContent(`<table>${processorRow('HOT-350', 'Intel Xeon 6767P 2.4GHz 64-core 350W Processor', 0)}</table>`);
  await expect(new ComponentEngine(page, 'DL360').selectRandomProcessor())
    .rejects.toThrow(/at or below 270W \(visible processor candidates: 1; over the limit: 1\)/);
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

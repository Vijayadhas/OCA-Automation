import { test, expect } from '@playwright/test';
import { pickDefaultOption } from '../../src/automation/model-search';
import { ComponentEngine, processorCountNeed } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';

// P53921-B21 search results, in OCA's order (run 995c5037, 2026-11-05).
const dl385 = [
  'P53921-B21 vSAN ESA AF-2 - HPE DL385 Gen11 8SFF CTO Svr (P53921-B21) CTO - -',
  'P53921-B21 vSAN ESA AF-4 - HPE DL385 Gen11 8SFF CTO Svr (P53921-B21) CTO - -',
  'P53921-B21 vSAN ESA AF-6 - HPE DL385 Gen11 8SFF CTO Svr (P53921-B21) CTO - -',
  'P53921-B21 HPE ProLiant DL385 Gen11 8SFF Configure-to-order Server CTO - -',
  'P53921-B21 HPE ProLiant DL385 Gen11 8SFF Configure-to-order Server Smart CTO - -',
  'P53921-B21#GTA vSAN ESA AF-2 - HPE DL385 Gen11 8SFF CTO Svr (P53921-B21) CTO - -',
];

test('without a Model Description the plain configure-to-order server is opened, not a vSAN bundle', () => {
  expect(pickDefaultOption(dl385, 'P53921-B21')).toBe(3);
  // One result: that one (earlier runs).
  expect(pickDefaultOption(['P97048-B21 HPE ProLiant DL585a Gen13 8 Double Wide Configure-to-order Server CTO - -'], 'P97048-B21')).toBe(0);
  // A Wizard result is never the default.
  expect(pickDefaultOption(['S8J33A HPE SimpliVity 380 Gen12 Wizard', 'S8J33A HPE SimpliVity 380 Gen12 CTO'], 'S8J33A')).toBe(1);
  expect(pickDefaultOption(['S8J33A Solution Wizard'], 'S8J33A')).toBe(-1);
});

test('reads processor-count rules', () => {
  expect(processorCountNeed('Second processor must be selected')).toEqual({ processors: 2 });
  expect(processorCountNeed('If 16NVMe U.3 2P Bal FIO Kit Trigger SKU is selected … Qty-6-Perf Fan kit 2nd Processor must be selected'))
    .toEqual({ processors: 2 });
  expect(processorCountNeed('The Total Processor Core Count for this vSAN solution must total 24 cores or higher. This total can be achieved with either one or two processors.'))
    .toEqual({ cores: 24 });
  expect(processorCountNeed('Minimum 2 drives must be selected')).toBeNull();
});

test('a flagged second-processor rule sets the processor quantity to 2', async ({ page }) => {
  const rules = '<li class="message_li"><span class="error_message">The Total Processor Core Count for this vSAN solution must total 24 cores or higher. '
    + '(<a class="err-lnk" id="ProcessorSection_ProcessorChoice">Processors</a>)</span></li>'
    + '<li class="message_li"><span class="error_message">Second processor must be selected (<a class="err-lnk" id="ProcessorSection_ProcessorChoice">Processors</a>)</span></li>';
  await page.setContent(menuSection({ key: 'ProcessorSection', title: 'Processor', choices: [
    { id: 'ProcessorSection_ProcessorChoice', title: 'Processors', flagged: true, messages: rules, rows: [
      { pid: 'P72659-B21', description: 'AMD EPYC 9115 2.6GHz 16-core 125W Processor for HPE', quantity: 1, select: [0, 1, 2] },
      { pid: 'P53699-B21', description: 'AMD EPYC 9354 3.25GHz 32-core 280W Processor for HPE', select: [0, 1, 2] },
    ] },
  ] }));
  await new ComponentEngine(page).satisfyRequiredSection('Processor');
  await expect(page.locator('#item_tr_P72659-B21_ProcessorSection_ProcessorChoice .item_qty_div')).toHaveText('2');
  await expect(page.locator('#item_tr_P53699-B21_ProcessorSection_ProcessorChoice .item_qty_div')).toHaveText('0');
});

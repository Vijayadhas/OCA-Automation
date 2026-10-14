import { test, expect } from '@playwright/test';
import { ComponentEngine } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';

// S3V83A (2026-10-15): "Controller Node Models" stayed collapsed after a click on the header row,
// and the dHCI flow looked rows up by fixed choice ids. Here a panel covers the header's centre,
// so a coordinate click lands on the panel, as it would on OCA if something is drawn over the row.
const cover = `<div id="cover" style="position:fixed; left:0; top:0; width:100%; height:200px; z-index:10; background:transparent"
  onclick="window.coverClicks = (window.coverClicks ?? 0) + 1"></div>`;
const dhciMenu = () => cover
  + `<div style="height:20px"></div>`
  + menuSection({ key: 'ctrl', title: 'Controller Node Models', collapsed: true, choices: [
    { id: 'ctrl_chassis', title: 'Node Chassis', rows: [
      { pid: 'CHASSIS-A', select: [0, 1, 2, 3] }, { pid: 'CHASSIS-B', select: [0, 1, 2, 3] },
    ] },
  ] })
  + menuSection({ key: 'dac', title: 'DAC Cables', collapsed: true, choices: [
    { id: 'dac_host', title: 'DAC Host Cables', rows: [{ pid: 'DAC-A', select: [0, 4, 8, 12] }] },
    { id: 'dac_xcvr', title: 'Transceivers', rows: [{ pid: 'XCVR-A', select: [0, 1] }] },
  ] });

const quantityOf = (page: import('@playwright/test').Page, pid: string) => page.locator(`[id^="item_tr_${pid}_"] .item_qty_div`);

test('opens a section whose header row is covered and picks in choices named by title', async ({ page }) => {
  await page.setContent(dhciMenu());
  // OCA shows the Node choice only after a Node Chassis is selected.
  await page.locator('#body_ctrl').evaluate((body) => body.addEventListener('change', () => {
    if (document.getElementById('choice_title_ctrl_nodes')) return;
    body.insertAdjacentHTML('beforeend', `<tr class="choice_header" id="choice_header_ctrl_nodes"><td>
      <span class="choice_title" id="choice_title_ctrl_nodes">Node</span></td></tr>
      <tr class="item_tr" id="item_tr_NODE-A_ctrl_nodes" data-elementid="ctrl_nodes"><td class="item_prod"><span class="_pid">NODE-A</span></td>
      <td class="item_desc">Node</td><td class="item_qty"><div class="item_qty_div">0</div>
      <select onchange="this.closest('td').querySelector('.item_qty_div').textContent = this.value">
        <option>0</option><option>2</option><option>4</option></select></td></tr>`);
  }));
  const engine = new ComponentEngine(page);
  const chassis = await engine.selectInChoice('Controller Node Models', 'Node Chassis', 2);
  expect(['CHASSIS-A', 'CHASSIS-B']).toContain(chassis.productNumber);
  await expect(quantityOf(page, chassis.productNumber)).toHaveText('2');
  expect(await engine.selectInChoice('Controller Node Models', 'Node', 4)).toMatchObject({ productNumber: 'NODE-A', quantity: 4 });
  await expect(quantityOf(page, 'NODE-A')).toHaveText('4');
});

test('uses the section\'s first choice with rows when no choice title is given', async ({ page }) => {
  await page.setContent(dhciMenu());
  expect(await new ComponentEngine(page).selectInChoice('DAC Cables', undefined, 8)).toMatchObject({ productNumber: 'DAC-A', quantity: 8 });
  await expect(quantityOf(page, 'XCVR-A')).toHaveText('0');
});

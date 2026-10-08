import { expect, test } from '@playwright/test';
import { StorageFlow } from '../../src/automation/storage-flow';

test('configures storage choices from live rows and exposed quantities', async ({ page }) => {
  await page.setContent(`<style>.choices { display:none } .choices.open { display:table-row-group }</style>
    <button id="section_header_cloudConnectivitySection" onclick="cloud.classList.add('open')">Cloud Connectivity</button>
    <table><tbody id="cloud" class="choices"><tr class="item_tr" data-elementid="cloudConnectivitySection_choice">
      <td class="item_desc">Available cloud option</td><td><select><option>0</option><option value="accepted">1</option></select></td></tr></tbody></table>
    <button id="section_header_nodechassisSection" onclick="nodes.classList.add('open')">Controller Node Models</button>
    <table><tbody id="nodes" class="choices"><tr class="item_tr" data-elementid="nodechassisSection_nodeschassisChoice">
      <td class="_pid">DYNAMIC-CHASSIS</td><td class="item_desc">Available chassis</td>
      <td><select><option>0</option><option>1</option></select></td></tr>
      <tr class="item_tr" data-elementid="nodechassisSection_nodesChoice">
      <td class="_pid">DYNAMIC-NODE</td><td class="item_desc">Available node</td>
      <td><select><option>0</option><option>1</option><option>2</option></select></td></tr></tbody></table>
    <button id="section_header_hardDriveSection" onclick="capacity.classList.add('open')">Capacity</button>
    <table><tbody id="capacity" class="choices"><tr class="item_tr" data-elementid="hardDriveSection_dynamicChoice">
      <td class="_pid">DYNAMIC-DRIVE</td><td class="item_desc">Available capacity</td>
      <td><select><option>0</option><option>8</option><option>16</option></select></td></tr></tbody></table>`);

  const selected = await new StorageFlow(page).configure();

  expect(selected.map((item) => item.label)).toEqual(['Cloud Connectivity', 'Controller Node Chassis', 'Controller Nodes', 'Capacity']);
  expect(selected[0].quantity).toBe(0);
  expect(selected[1]).toMatchObject({ productNumber: 'DYNAMIC-CHASSIS', quantity: 1 });
  expect(selected[2]).toMatchObject({ productNumber: 'DYNAMIC-NODE', quantity: 2 });
  expect([8, 16]).toContain(selected[3].quantity);
});

test('accepts Cloud Connectivity as a row choice and uses exposed quantities for component choices', async ({ page }) => {
  await page.setContent(`<style>.choices { display:none } .choices.open { display:table-row-group }</style>
    <button id="section_header_cloudConnectivitySection" onclick="cloud.classList.add('open')">Cloud Connectivity</button>
    <table><tbody id="cloud" class="choices"><tr class="item_tr" data-elementid="cloudConnectivitySection_choice">
      <td class="item_desc" onclick="this.closest('tr').dataset.selected='true'">Cloud requirement</td>
      <td class="item_qty"><div class="item_qty_div">0</div></td></tr></tbody></table>
    <button id="section_header_nodechassisSection" onclick="nodes.classList.add('open')">Controller Node Models</button>
    <table><tbody id="nodes" class="choices"><tr class="item_tr" data-elementid="nodechassisSection_nodeschassisChoice">
      <td class="item_desc">Chassis</td><td><select><option>0</option><option>1</option></select></td></tr>
      <tr class="item_tr" data-elementid="nodechassisSection_nodesChoice">
      <td class="item_desc">Node</td><td><select><option>0</option><option>1</option><option>2</option></select></td></tr></tbody></table>
    <button id="section_header_hardDriveSection" onclick="capacity.classList.add('open')">Capacity</button>
    <table><tbody id="capacity" class="choices"><tr class="item_tr" data-elementid="hardDriveSection_choice">
      <td class="item_desc">Drive</td><td><select><option>0</option><option>8</option></select></td></tr></tbody></table>`);

  const selected = await new StorageFlow(page).configure();

  expect(selected[0]).toMatchObject({ label: 'Cloud Connectivity', quantity: 0 });
  await expect(page.locator('[data-elementid="cloudConnectivitySection_choice"]')).toHaveAttribute('data-selected', 'true');
});

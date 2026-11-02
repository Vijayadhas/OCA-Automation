import { test, expect } from '@playwright/test';
import { EndBom } from '../../src/automation/end-bom';

// Captured on P72297-B21 (JOB-002): hidden columns and hidden duplicate cells sit between the visible ones.
const startTable = `<table id="startbom_billingtier_table"><thead><tr>
  <th>Billing Tier</th><th>Billing&nbsp;Tier&nbsp;Custom&nbsp;Name</th><th>Allocated Memory<span title="85%"></span></th>
  <th style="display:none">Previous Allocated Memory</th><th>Server<span title="Metering"></span></th>
  <th style="display:none">Previous Server</th><th>Used CPU Core</th><th style="display:none">Previous Used CPU Core</th>
  <th style="display:none">Fixed Servers</th><th style="display:none">Fixed Compute&nbsp;Units</th><th style="display:none">LRFT</th>
</tr></thead><tbody><tr>
  <td>HPE ProLiant ML350 Gen12 Server #1 (32.0GB Memory) A8E</td><td>HPE ProLiant ML350 Gen12 Server #1 (32.0GB Memory) A8E</td>
  <td style="display:none">1</td><td style="display:none">27</td><td style="display:none">Servers</td><td>27</td>
  <td style="display:none"></td><td>1</td><td style="display:none"></td><td>16</td><td style="display:none"></td>
</tr></tbody></table>`;
const endTable = `<table id="endbom_billingtier_table"><thead><tr>
  <th>Billing Tier</th><th>Billing&nbsp;Tier&nbsp;Custom&nbsp;Name</th><th>Allocated Memory</th><th>Server</th><th>Used CPU Core</th>
</tr></thead><tbody><tr>
  <td>HPE ProLiant ML350 Gen12 Server #1 (32.0GB Memory) A8E</td><td>HPE ProLiant ML350 Gen12 Server #1 (32.0GB Memory) A8E</td>
  <td>81</td><td>3</td><td>48</td><td style="display:none">3</td><td style="display:none">81</td><td style="display:none">Servers</td>
</tr></tbody></table>`;

test('reads Start and End BOM capacity from the visible columns only', async ({ page }) => {
  await page.setContent(startTable + endTable);
  const endBom = new EndBom(page);
  const tier = 'HPE ProLiant ML350 Gen12 Server #1 (32.0GB Memory) A8E';
  expect(await endBom.readBillingTierTable('startbom_billingtier_table')).toEqual({
    billingTier: tier, billingTierCustomName: tier, allocatedMemory: '27', server: '1', usedCpuCore: '16',
  });
  expect(await endBom.readBillingTierTable('endbom_billingtier_table')).toEqual({
    billingTier: tier, billingTierCustomName: tier, allocatedMemory: '81', server: '3', usedCpuCore: '48',
  });
  expect(await endBom.readBillingTierTable('missing_table')).toBeNull();
});

// S2G16A and S2G18A (DL320 Gen11 for Cohesity, 2026-10-19): OCA disables Auto-generate for these models.
test('reports at once when OCA does not offer Auto-generate End BOM', async ({ page }) => {
  await page.setContent(`<button id="obw_endbom_bot">End BOM</button>
    <button id="endbom_autogen" data-endbom="auto" class="hpe-btn hpe-secondary billingtier-disabled"
      title="Currently not supported for auto generation. Use manual"> Auto-generate </button>`);
  const started = Date.now();
  await expect(new EndBom(page).generateAndAssociate()).rejects
    .toThrow('OCA does not offer Auto-generate End BOM for this model ("Currently not supported for auto generation. Use manual")');
  expect(Date.now() - started).toBeLessThan(15_000);
});

// End BOM Setup of a solution (screenshot, 2026-11-02): compute, storage and switch tiers in one table,
// with an Include Billing Tier switch on the switch tiers and storage capacity in Written Usable GB/TB.
// The switch markup is not captured yet; a checkbox stands in for it.
test('reads every Start BOM tier with all visible columns for the BOM Details sheet', async ({ page }) => {
  await page.setContent(`<table id="startbom_billingtier_table"><thead><tr>
    <th>Billing Tier</th><th>Billing Tier Custom Name</th><th>Include Billing Tier <span class="help">?</span></th>
    <th>Allocated Memory</th><th style="display:none">Previous Allocated Memory</th><th>Server</th><th>Used CPU Core</th>
    <th>Written Usable GB</th><th>Written Usable TB</th><th>Fixed</th>
  </tr></thead><tbody>
    <tr><td>DL380 Gen11 #1 (64.0GB Memory) 2FD</td><td>DL380 Gen11 #1 (64.0GB Memory) 2FD</td><td></td>
      <td>378</td><td style="display:none">0</td><td>7</td><td>112</td><td></td><td></td><td></td></tr>
    <tr><td>HPE GreenLake for PC3000 with Alletra Storage MP #14D</td><td>HPE GreenLake for PC3000 with Alletra Storage MP #14D</td><td></td>
      <td></td><td style="display:none"></td><td></td><td></td><td>177603</td><td>177</td><td></td></tr>
    <tr><td>SN8325H Switch #1 451</td><td>SN8325H Switch #1 451</td><td><label><input type="checkbox"></label></td>
      <td></td><td style="display:none"></td><td></td><td></td><td></td><td></td><td>1</td></tr>
    <tr><td>SN8325H Switch #2 0BC</td><td>SN8325H Switch #2 0BC</td><td><label><input type="checkbox" checked></label></td>
      <td></td><td style="display:none"></td><td></td><td></td><td></td><td></td><td>1</td></tr>
  </tbody></table>`);
  const rows = await new EndBom(page).readBillingTierRows('startbom_billingtier_table');
  expect(rows).toHaveLength(4);
  expect(Object.keys(rows![0])).toEqual(['Billing Tier', 'Billing Tier Custom Name', 'Include Billing Tier', 'Allocated Memory',
    'Server', 'Used CPU Core', 'Written Usable GB', 'Written Usable TB', 'Fixed']);
  expect(rows![0]).toMatchObject({ 'Billing Tier': 'DL380 Gen11 #1 (64.0GB Memory) 2FD', 'Allocated Memory': '378', Server: '7', 'Used CPU Core': '112' });
  expect(rows![1]).toMatchObject({ 'Written Usable GB': '177603', 'Written Usable TB': '177' });
  expect(rows![2]).toMatchObject({ 'Billing Tier': 'SN8325H Switch #1 451', 'Include Billing Tier': 'No', Fixed: '1' });
  expect(rows![3]).toMatchObject({ 'Include Billing Tier': 'Yes' });
  // The Results sheet's joined columns still come from the same table.
  expect(await new EndBom(page).readBillingTierTable('startbom_billingtier_table')).toMatchObject({ allocatedMemory: '378', server: '7', usedCpuCore: '112' });
});

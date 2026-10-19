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

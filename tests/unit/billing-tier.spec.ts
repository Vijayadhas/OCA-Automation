import { test, expect } from '@playwright/test';
import { BillingTier, BOM_CONFIG_NAME } from '../../src/automation/billing-tier';

test('targets OCA Config 2 in the BOM workflow', () => {
  expect(BOM_CONFIG_NAME).toBe('OCA Config 2');
});

// S2U63A (DL380 Gen11 Data Solutions): a storage Billing Tier whose "Written Usable TiB" OCA leaves
// at 0 ("Manual entry required in OCA"); OK carries billingtier-disabled until it is set.
const bomPage = (cellOpensInput: boolean) => `
  <a href="#bom" role="link">BOM</a><div id="eo_nav_li_0">OCA Config 2</div>
  <button id="obw_billingtier_bot" onclick="document.getElementById('bt').style.display='block'">Billing Tier Setup</button>
  <div id="bt" role="dialog" class="ui-dialog billing-tier-dialog" style="display:none">
    <span class="ui-dialog-title">Billing Tier Setup</span>
    <table id="startbom_billingtier_table"><thead><tr><th>Billing Tier</th><th>Written Usable TiB</th></tr></thead><tbody>
      <tr class="btier-data-row btier-storage-row" data-pn="S2U63A"><td class="btier-name">HPEc DL380 Gen11 12LFF #1 (512.0GB Memory) 99E</td>
        <td class="btier-uom-usable-tib btier-editableNumber">0 <span class="btier-edit-pencil edit-pencil">✎</span></td></tr></tbody></table>
    <div id="bt_ack_div"><input id="bt_ack_checkbox" type="checkbox" style="display:none">
      <label for="bt_ack_checkbox" onclick="document.getElementById('_billt_ok').classList.remove('billingtier-disabled')">I Acknowledge that the configuration is incomplete</label></div>
    <div class="ui-dialog-buttonset"><button type="button" id="_billt_ok" class="ui-button billingtier-disabled"
      onclick="if (!this.classList.contains('billingtier-disabled')) document.getElementById('bt').style.display='none'">OK</button></div>
  </div>
  <script>
    document.querySelector('.btier-editableNumber').addEventListener('click', (event) => {
      const cell = event.currentTarget;
      if (!${cellOpensInput} || cell.querySelector('input')) return;
      cell.innerHTML = '<input type="text" value="0">';
      cell.querySelector('input').addEventListener('keydown', (key) => {
        if (key.key !== 'Enter') return;
        const value = key.target.value; cell.textContent = value;
        if (Number(value) > 0) document.getElementById('_billt_ok').classList.remove('billingtier-disabled');
      });
    });
  </script>`;

test('enters a capacity OCA leaves for manual entry, then closes Billing Tier Setup', async ({ page }) => {
  await page.setContent(bomPage(true));
  await new BillingTier(page).run();
  await expect(page.locator('.btier-editableNumber')).toHaveText('1');
  await expect(page.locator('#bt')).toBeHidden();
});

test('acknowledges an incomplete Billing Tier Setup when the capacity cannot be entered', async ({ page }) => {
  const snapshots: string[] = [];
  await page.setContent(bomPage(false));
  await new BillingTier(page, async (label) => { snapshots.push(label); }).run();
  await expect(page.locator('#bt')).toBeHidden();
  expect(snapshots).toContain('WARN-Billing Tier Setup incomplete');
});

// P52765-B21 and S2G17A (DL320 Gen11, 2026-10-19): selecting OCA Config 2 in BOM opened OCA's problem
// dialog, whose overlay blocked Billing Tier Setup. The dialog is closed and BOM opened again.
test('closes OCA\'s problem dialog after selecting the BOM configuration and opens BOM again', async ({ page }) => {
  await page.setContent(bomPage(true).replace('<div id="eo_nav_li_0">', `<div id="eo_nav_li_0" onclick="if (!window.failed) { window.failed = true;
      document.getElementById('problem').style.display = 'block'; document.getElementById('veil').style.display = 'block'; }">`) + `
    <div id="veil" class="ui-widget-overlay ui-front" style="display:none;position:fixed;inset:0;z-index:10"></div>
    <div id="problem" class="ui-dialog" role="dialog" style="display:none;position:fixed;top:0;z-index:11">
      <span class="ui-dialog-title">(OCA) has encountered a problem</span>
      <button class="ui-dialog-titlebar-close" onclick="document.getElementById('problem').style.display='none';
        document.getElementById('veil').style.display='none'">x</button>
      <div id="error_detail_message">java.lang.NoSuchMethodException: Widget does not exist on current page: extended_overview:bom:bom_tab</div>
    </div>`);
  await new BillingTier(page).run();
  await expect(page.locator('#problem')).toBeHidden();
  await expect(page.locator('#bt')).toBeHidden();
  await expect(page.locator('.btier-editableNumber')).toHaveText('1');
});

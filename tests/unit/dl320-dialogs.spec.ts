import { test, expect } from '@playwright/test';
import { ComponentEngine } from '../../src/automation/component-engine';
import { dismissOcaMessageDialogs } from '../../src/core/oca-problem';
import { waitForBlockingOverlay } from '../../src/core/waits';
import { menuSection } from './oca-menu-fixture';

// Dialogs as captured on P75218-B21 (DL320 Gen12 4LFF) while network cards were being added.
const okScript = `onclick="this.closest('.ui-dialog').remove()"`;
const placementDialog = `<div tabindex="-1" role="dialog" class="ui-dialog ui-corner-all ui-widget ui-widget-content ui-front ui-dialog-buttons">
  <div class="ui-dialog-titlebar"><span class="ui-dialog-title">Message</span>
    <button type="button" class="ui-button ui-dialog-titlebar-close" title=""></button></div>
  <div class="dialog_div ui-dialog-content">PCI Card Placement: Unable to calculate proper PCI Card placements during placement of P26259-B21 </div>
  <div class="ui-dialog-buttonpane"><div class="ui-dialog-buttonset"><button type="button" id="OK" class="ui-button" ${okScript}>OK</button></div></div></div>`;
const problemDialog = `<div tabindex="-1" role="dialog" class="ui-dialog dqe-mode ui-widget ui-widget-content ui-front dialog_shadow ui-dialog-buttons">
  <div class="ui-dialog-titlebar"><span class="ui-dialog-title">(OCA) has encountered a problem</span>
    <button type="button" class="ui-button ui-dialog-titlebar-close" title="" ${okScript}></button></div>
  <div class="dialog_div ui-dialog-content"><div class="error_message_div"><div id="error_detail_message">java.lang.NoSuchMethodException:
    com.hp.ngc.uiframework.tool.oca.OCA.dialog_button_click(java.util.Map,com.hp.ngc.uiframework.Window)
    java.base/java.lang.Class.getMethod(Class.java:2397)</div></div></div></div>`;
const saveDialog = `<div role="dialog" class="ui-dialog"><div class="ui-dialog-titlebar"><span class="ui-dialog-title">Save Configuration</span></div>
  <div class="ui-dialog-buttonset"><button ${okScript}>OK</button></div></div>`;

test('closes OCA message and problem dialogs, and leaves other dialogs open', async ({ page }) => {
  await page.setContent(placementDialog + problemDialog + saveDialog);
  const closed = await dismissOcaMessageDialogs(page);
  expect(closed).toHaveLength(2);
  expect(closed[0]).toContain('PCI Card Placement');
  expect(closed[1]).toContain('has encountered a problem');
  await expect(page.locator('.ui-dialog')).toHaveCount(1);
  await expect(page.locator('.ui-dialog-title')).toHaveText('Save Configuration');
  expect(await dismissOcaMessageDialogs(page)).toEqual([]);
});

test('waits for every blocking overlay, also when OCA shows more than one', async ({ page }) => {
  await page.setContent(`<div class="blockUI blockOverlay" style="position:fixed;inset:0"></div>
    <div class="blockUI blockOverlay" style="position:fixed;inset:0"></div>`);
  await page.evaluate(() => setTimeout(() => document.querySelectorAll('.blockUI').forEach((element) => element.remove()), 1_500));
  const startedAt = Date.now();
  await waitForBlockingOverlay(page);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
});

// P75217-B21 (DL320 Gen12 SFF/EDSFF): a Smart Chassis template with both front OCP cable kits.
const ocpLinks = `(<a class="err-lnk" id="net_fc">Fibre Channel HBA</a>, <a class="err-lnk" id="sc_sas">SAS Controller</a>,
  <a class="err-lnk" id="net_ocp">OCP Ethernet</a>, <a class="err-lnk" id="net_eth">Ethernet PCIe</a>)`;
const ocpRule = `<li class="message_li"><span class="error_message">If Prim front OCP Cbl kit and Sec Front OCP cbl Kit is selected
  then Qty=2 of Ethernet OCP adapter must be selected ${ocpLinks}</span></li>`;

const pageOcp = (ocpQuantity = 0) =>
  menuSection({ key: 'sc', title: 'Smart Chassis', choices: [
    { id: 'sc_main', title: 'Smart Chassis', rows: [{ pid: 'CHASSIS-A', radio: true, checked: true, quantity: 1 }] },
    { id: 'sc_sas', title: 'SAS Controller', flagged: true, messages: ocpRule, rows: [{ pid: 'P47785-B21', quantity: 1, select: [0, 1] }] },
  ] })
  + menuSection({ key: 'net', title: 'Networking', collapsed: true, choices: [
    { id: 'net_eth', title: 'Ethernet PCIe', flagged: true, rows: [{ pid: 'P26253-B21', select: [0, 1, 2] }] },
    { id: 'net_ocp', title: 'OCP Ethernet', flagged: true, rows: [{ pid: 'P10115-B21', quantity: ocpQuantity, select: [0, 1, 2] }] },
    { id: 'net_fc', title: 'Fibre Channel HBA', flagged: true, rows: [{ pid: 'R2E09A', select: [0, 1, 2] }] },
  ] });

const quantityOf = (page: import('@playwright/test').Page, pid: string) => page.locator(`[id^="item_tr_${pid}_"] .item_qty_div`);

test('fills "Qty=2 of Ethernet OCP adapter" with quantity 2 in the OCP Ethernet choice', async ({ page }) => {
  await page.setContent(pageOcp());
  await new ComponentEngine(page).satisfyRequiredSection('Smart Chassis');
  await expect(quantityOf(page, 'P10115-B21')).toHaveText('2');
  await expect(quantityOf(page, 'P26253-B21')).toHaveText('0');
});

test('raises an OCP adapter already at quantity 1 to the 2 the rule asks for', async ({ page }) => {
  await page.setContent(pageOcp(1));
  await new ComponentEngine(page).satisfyRequiredSection('Smart Chassis');
  await expect(quantityOf(page, 'P10115-B21')).toHaveText('2');
});

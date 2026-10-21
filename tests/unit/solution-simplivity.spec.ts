import { expect, test } from '@playwright/test';
import { minimumFor, SolutionWizard } from '../../src/automation/solution-wizard';

// SimpliVity Wizard (2026-10-21 capture of S2V31A): each field is a span label, then OCA's selecter box over a
// hidden select. Mandatory selects carry class requiredChoice (missingSelection while empty, value none_item and
// text "Please make a selection."); optional ones show "None.". Checkboxes add optional products.
const field = (label: string, id: string, options: string[], required: boolean, selected = '') => {
  const empty = required ? 'Please make a selection.' : 'None.';
  return `<div class="wizard_dropdown"><div class="form-container-border sub-col"><span>${label}</span>
    <select id="${id}" class="${required ? 'requiredChoice ' : ''}selecter-element" style="display:none">
    <option value="none_item">${empty}</option>${options.map((option) =>
    `<option value="${option}"${option === selected ? ' selected' : ''}>${option}</option>`).join('')}</select>
    <div class="selecter"><span class="selecter-selected">${selected || empty}</span></div></div></div>`;
};
const checkbox = (id: string, text: string, hidden = false) => `<div${hidden ? ' style="display:none"' : ''}>
  <div class="wizard_checkbox"><input type="checkbox" id="${id}" style="display:none">
  <label for="${id}" class="label-checkbox-radio"><span></span>${text}</label></div></div>`;

const wizard = (message: string) => `<a href="#extended_overview_solutionWizard">Solution Wizard</a>
  <div id="extended_overview_solutionWizard"><div id="left_node_section">
    ${field('Processor', 'proc', ['(P72665-B21) AMD EPYC 9355P'], true)}
    ${field('Memory', 'mem', ['(P64986-F21) HPE 64GB (1x64GB)'], true)}
    ${field('Memory Qty', 'memqty', ['1', '2', '4', '8'], true)}
    ${field('Boot Storage', 'boot', ['(P48183-B21) HPE NS204i-u'], false)}
    <div class="constraintError"><div class="status-messaging"><span>${message}</span></div></div>
    ${field('Storage Drives', 'drives', ['(S1J88A) HPE SimpliVity 1.92TB SATA'], true)}
    ${field('Drive Qty', 'driveqty', ['4', '6', '8'], true)}
    ${checkbox('include_smart_battery', '(P01366-B21) HPE 96W Smart Storage Battery', true)}
  </div><div id="right_node_section">
    ${checkbox('include_rail_kit', '(P26489-B21) HPE DL300 Gen10+ 1U CMA for Rail Kit')}
    ${field('Select OCP Network Adapter', 'ocp1', ['(P10115-B21) Broadcom BCM57414'], true)}
    ${field('Select Network Adapter', 'nic', ['(P08443-B21) Intel E810-XXVDA2'], false)}
    ${checkbox('include_encryption', '(Q2F26AAE) HPE Smart Array SR Secure Encryption', true)}
    ${checkbox('cloud_acknowledge_checkbox', 'Cloud connectivity requirement can be met')}
  </div></div>`;

test('a wizard message\'s minimum applies to the quantity dropdown it names', () => {
  expect(minimumFor('Drive Qty', ['Minimum 8 drives must be selected'])).toBe(8);
  expect(minimumFor('Memory Qty', ['Minimum 8 drives must be selected'])).toBe(0);
  expect(minimumFor('Drive Qty', ['Select a network adapter'])).toBe(0);
});

test('a SimpliVity Wizard gets Processor, Memory and the other mandatory dropdowns, nothing optional', async ({ page }) => {
  await page.setContent(wizard('Minimum 8 drives must be selected'));
  const selections = await new SolutionWizard(page).configure([]);
  await expect(page.locator('#proc')).toHaveValue('(P72665-B21) AMD EPYC 9355P');
  await expect(page.locator('#mem')).toHaveValue('(P64986-F21) HPE 64GB (1x64GB)');
  await expect(page.locator('#drives')).toHaveValue('(S1J88A) HPE SimpliVity 1.92TB SATA');
  await expect(page.locator('#driveqty')).toHaveValue('8');
  await expect(page.locator('#ocp1')).toHaveValue('(P10115-B21) Broadcom BCM57414');
  // Optional dropdowns and product checkboxes are left alone; only the acknowledgement is ticked.
  await expect(page.locator('#boot')).toHaveValue('none_item');
  await expect(page.locator('#nic')).toHaveValue('none_item');
  await expect(page.locator('#include_rail_kit')).not.toBeChecked();
  await expect(page.locator('#include_encryption')).not.toBeChecked();
  await expect(page.locator('#cloud_acknowledge_checkbox')).toBeChecked();
  expect(selections.map((item) => item.label)).toEqual(['Processor', 'Memory', 'Memory Qty', 'Storage Drives', 'Drive Qty', 'Select OCP Network Adapter']);
});

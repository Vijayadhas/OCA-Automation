import { expect, test } from '@playwright/test';
import { minimumFor, SolutionWizard } from '../../src/automation/solution-wizard';

// SimpliVity Wizard (2026-10-21 recordings of S8J33A and S2V31A): each field is a label, then OCA's selecter
// box over a hidden select; Processor and Memory first, then the dropdowns still at "Please make a selection.".
const field = (label: string, id: string, options: string[], selected = '') => `<div class="sub-col"><span>${label}</span>
  <div class="wizard_dropdown"><div class="form-container-border"><select id="${id}" style="display:none">
    <option value="">Please make a selection.</option>${options.map((option) =>
    `<option value="${option}"${option === selected ? ' selected' : ''}>${option}</option>`).join('')}</select>
    <div class="selecter"><span class="selecter-selected">${selected || 'Please make a selection.'}</span></div></div></div></div>`;

const wizard = (message: string) => `<a href="#extended_overview_solutionWizard">Solution Wizard</a>
  <div id="extended_overview_solutionWizard"><div id="node_section">
    ${field('Processor', 'proc', ['(P74570-B21) Intel Xeon 6527P'])}
    ${field('Memory', 'mem', ['(P69727-F21) HPE 32GB (1x32GB)'])}
    ${field('Memory Qty', 'memqty', ['1', '2', '4', '8'], '1')}
    ${field('Storage Drives', 'drives', ['6 x 1.92 TB (SAS MU) + 6 x 1.92 TB (SAS RI) (11.92 TB)(12G)'])}
    ${field('Drive Qty', 'driveqty', ['1', '2', '4', '8', '12'], '1')}
  </div><div id="right_node_section">${field('Select Network Adapter', 'nic', ['(P10115-B21) Broadcom BCM57412'])}
    <div class="error_message">${message}</div></div></div>`;

test('a wizard message\'s minimum applies to the quantity dropdown it names', () => {
  expect(minimumFor('Drive Qty', ['Minimum 8 drives must be selected'])).toBe(8);
  expect(minimumFor('Memory Qty', ['Minimum 8 drives must be selected'])).toBe(0);
  expect(minimumFor('Drive Qty', ['Select a network adapter'])).toBe(0);
});

test('a SimpliVity Wizard gets Processor and Memory, then every empty dropdown and the stated minimum', async ({ page }) => {
  await page.setContent(wizard('Minimum 8 drives must be selected'));
  const selections = await new SolutionWizard(page).configure([]);
  await expect(page.locator('#proc')).toHaveValue('(P74570-B21) Intel Xeon 6527P');
  await expect(page.locator('#mem')).toHaveValue('(P69727-F21) HPE 32GB (1x32GB)');
  await expect(page.locator('#drives')).not.toHaveValue('');
  await expect(page.locator('#nic')).toHaveValue('(P10115-B21) Broadcom BCM57412');
  await expect(page.locator('#driveqty')).toHaveValue('8');
  expect(selections.map((item) => item.label)).toEqual(['Processor', 'Memory', 'Memory Qty', 'Storage Drives', 'Drive Qty', 'Select Network Adapter']);
});

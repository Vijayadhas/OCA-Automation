import { expect, test } from '@playwright/test';
import { SolutionWizard } from '../../src/automation/solution-wizard';

// Alletra wizards (2026-10-22). Fields as in the captured Alletra 4000 wizard: a span label, then the select
// (class requiredChoice when mandatory) inside .wizard_dropdown .form-container-border, under OCA's selecter box.
const field = (label: string, id: string, options: string[], required: boolean) => {
  const empty = required ? 'Please make a selection.' : 'None.';
  return `<div class="wizard_dropdown w-90"><div class="form-container-border sub-col"><span> ${label} </span><select id="${id}"
    class="${required ? 'requiredChoice ' : ''}selecter-element" style="display:none"><option value="none_item">${empty}</option>
    ${options.map((option) => `<option value="${option}">${option}</option>`).join('')}</select>
    <div class="selecter"><span class="selecter-selected">${empty}</span></div></div></div>`;
};
const tabs = (names: string[]) => `<ul class="wizard_tabs">${names.map((name, index) =>
  `<li${index ? '' : ' class="ui-tabs-active"'}><a href="#tab_${index}" onclick="document.querySelectorAll('.wizardTab').forEach((tab, at) => {
    tab.style.display = at === ${index} ? 'block' : 'none'; }); return false;">${name}</a></li>`).join('')}</ul>`;

// Alletra 4000: shown straight after Customize (no Solution Wizard tab). The base server sets the processor and
// memory; they sit in a collapsed accordion. Tabs Configure and Accessories (power supply is optional).
const alletra4000 = `<div id="wizard_wrap" class="bsw wizard_content snc"><div id="tabs_alletra_4000_solution" class="wizardTabRoot">
  ${tabs(['Configure', 'Accessories'])}
  <div class="wizardTab"><div id="select_base_alletras">${field('Select base Alletra Storage Server', 'type_selection',
    ['All Flash - 20 E3.S - HPE Alletra Storage Server 4210', 'Hybrid - 12 LFF - HPE Alletra Storage Server 4140'], true)}</div>
    <div id="accordion4" class="accordionDiv"><h3>Select compute resources</h3><div style="display:none">
      ${field('Processor', 'processor_selection', ['(P1) Intel Xeon 6517P', '(P2) Intel Xeon 6747P'], true)}
      ${field('Memory', 'memory_selection', ['(M1) HPE 32GB', '(M2) HPE 64GB'], true)}</div></div></div>
  <div class="wizardTab" style="display:none">${field('Select power supply voltage range & wattage', 'powerSupply_selection', ['(PS1) 1000W'], false)}</div>
</div></div>
<script>document.getElementById('type_selection').addEventListener('change', () => {
  document.getElementById('processor_selection').value = '(P1) Intel Xeon 6517P';
  document.getElementById('memory_selection').value = '(M1) HPE 32GB';
});</script>`;

test('Alletra 4000: the base server first, Processor and Memory it set are kept, optional dropdowns left', async ({ page }) => {
  await page.setContent(alletra4000);
  const selections = await new SolutionWizard(page).configure([]);
  await expect(page.locator('#type_selection')).not.toHaveValue('none_item');
  await expect(page.locator('#processor_selection')).toHaveValue('(P1) Intel Xeon 6517P');
  await expect(page.locator('#memory_selection')).toHaveValue('(M1) HPE 32GB');
  await expect(page.locator('#powerSupply_selection')).toHaveValue('none_item');
  expect(selections.map((item) => item.label)).toEqual(['Select base Alletra Storage Server', 'Processor', 'Memory']);
});

test('Alletra 4000: an Excel Processor replaces the one the base server set', async ({ page }) => {
  await page.setContent(alletra4000);
  await new SolutionWizard(page).configure([{ jobId: 'JOB-017', sequence: 1, section: 'Processor', selectionType: 'quantity', productNumber: 'P2' }]);
  await expect(page.locator('#processor_selection')).toHaveValue('(P2) Intel Xeon 6747P');
});

// Alletra 5000 (recording): the "Alletra5000Sol" Wizard in the Solution Wizard tab, with tabs Array Selection and
// Base Array Components (HDD Capacity, Bank A/B Cache); a storage array has no Processor or Memory dropdown.
const alletra5000 = `<a href="#extended_overview_solutionWizard">Solution Wizard</a><div id="extended_overview_solutionWizard">
  ${tabs(['Array Selection', 'Base Array Components'])}
  <div class="wizardTab"><div id="left_array_selection_section">${field('Array', 'array', ['(R4U33A) HPE Alletra 5010'], true)}
    ${field('Switch', 'switch', ['(S2T77A) HPE 48SFP28 12QSFP28'], false)}</div></div>
  <div class="wizardTab" style="display:none"><div id="left_base_array_components_section">
    ${field('HDD Capacity', 'hdd', ['(S0U34A) HPE Alletra 5010H'], true)}
    ${field('Bank A Cache', 'banka', ['(R8F35A) HPE Alletra 5000'], true)}</div></div>
</div>`;

test('Alletra 5000: each wizard tab\'s mandatory dropdowns are filled; no Processor dropdown is fine', async ({ page }) => {
  await page.setContent(alletra5000);
  const selections = await new SolutionWizard(page).configure([]);
  await expect(page.locator('#array')).toHaveValue('(R4U33A) HPE Alletra 5010');
  await expect(page.locator('#hdd')).toHaveValue('(S0U34A) HPE Alletra 5010H');
  await expect(page.locator('#banka')).toHaveValue('(R8F35A) HPE Alletra 5000');
  await expect(page.locator('#switch')).toHaveValue('none_item');
  expect(selections.map((item) => item.label)).toEqual(['Array', 'HDD Capacity', 'Bank A Cache']);
});

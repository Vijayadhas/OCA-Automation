import { test, expect } from '@playwright/test';
import { applyWizardRules, productOf } from '../../src/automation/wizard-rules';
import { SolutionWizard } from '../../src/automation/solution-wizard';

const options = (...ids: string[]) => ids.map((id) => ({ value: id, text: `(${id}) HPE Alletra 5000 option` }));
const ids = (list: Array<{ text: string }>) => list.map((option) => productOf(option.text));
const array = (id: string) => ({ label: 'Array', text: `(${id}) HPE Alletra 5000 base array` });

test('reads the part number an option starts with', () => {
  expect(productOf('(R4U33A) HPE Alletra 5010')).toBe('R4U33A');
  expect(productOf('(P72176-B21) HPE ProLiant')).toBe('P72176-B21');
  expect(productOf('Please make a selection.')).toBe('');
});

test('Alletra 5000: HDD Capacity follows the base array', () => {
  const hdd = options('R4U42A', 'R4U43A', 'R4U46A', 'S0U34A');
  expect(ids(applyWizardRules('HDD Capacity', hdd, [array('S0U33A')]).candidates)).toEqual(['S0U34A']);
  expect(ids(applyWizardRules('HDD Capacity', hdd, [array('R4U33A')]).candidates)).toEqual(['R4U42A', 'R4U43A']);
  expect(ids(applyWizardRules('HDD Capacity', hdd, [array('R4U35A')]).candidates)).toEqual(['R4U42A', 'R4U43A', 'R4U46A']);
});

test('Alletra 5000: cache follows the base array and the HDD Capacity', () => {
  const cache = options('R8F35A', 'R4U47A', 'R4U48A', 'R4U49A', 'R4U50A', 'S0U36A');
  expect(ids(applyWizardRules('Bank A Cache', cache, [array('S1D81A')]).candidates)).toEqual(['S0U36A']);
  expect(ids(applyWizardRules('Bank A Cache', cache, [array('R7L31A')]).candidates)).toEqual(['R8F35A', 'R4U47A', 'R4U48A', 'R4U49A']);
  const withHdd = (hdd: string) => applyWizardRules('Bank A Cache', cache, [array('R4U34A'), { label: 'HDD Capacity', text: `(${hdd}) HDD` }]).candidates;
  expect(ids(withHdd('R4U43A'))).toEqual(['R4U47A', 'R4U48A', 'R4U49A', 'R4U50A']);
  expect(ids(withHdd('R4U45A'))).toEqual(['R4U48A', 'R4U49A', 'R4U50A']);
  expect(ids(withHdd('R4U46A'))).toEqual(['R4U49A', 'R4U50A']);
});

test('Alletra 5000: Bank B Cache follows Bank A', () => {
  const cache = options('R8F35A', 'R4U47A', 'R4U48A', 'R4U49A', 'R4U50A');
  const bankB = (bankA: string) => ids(applyWizardRules('Bank B Cache', cache,
    [array('R4U35A'), { label: 'Bank A Cache', text: `(${bankA}) cache` }]).candidates);
  expect(bankB('R8F35A')).toEqual(['R8F35A', 'R4U47A']);
  expect(bankB('R4U48A')).toEqual(['R4U47A', 'R4U48A', 'R4U49A']);
  expect(bankB('R4U50A')).toEqual(['R4U49A', 'R4U50A']);
  // Bank A's own rules do not limit Bank A by Bank B.
  expect(ids(applyWizardRules('Bank A Cache', cache, [array('R4U35A')]).candidates)).toHaveLength(5);
});

test('Alletra 5000: NOS software Q8G27B is preferred and power supplies follow the base array', () => {
  const software = options('R2H12A', 'Q8G27B');
  expect(ids(applyWizardRules('NOS Software', software, [array('R4U34A')]).candidates)).toEqual(['Q8G27B']);
  const power = options('S2V21A', 'S2V19A');
  expect(ids(applyWizardRules('Power Supply', power, [array('R4U35A')]).candidates)).toEqual(['S2V19A']);
  expect(ids(applyWizardRules('Power Supply', power, [array('S0U33A')]).candidates)).toEqual(['S2V21A']);
});

test('a rule that leaves nothing is skipped and reported; other wizards are not touched', () => {
  const result = applyWizardRules('HDD Capacity', options('R4U42A'), [array('S0U33A')]);
  expect(ids(result.candidates)).toEqual(['R4U42A']);
  expect(result.skipped[0]).toMatch(/5010H: HDD Capacity S0U34A only/);
  expect(applyWizardRules('Processor', options('P1', 'P2'), [array('S0U33A')]).candidates).toHaveLength(2);
  expect(applyWizardRules('HDD Capacity', options('R4U46A'), []).candidates).toHaveLength(1);
});

// Wizard fields as in the Alletra 5000 recording (span label, then the select with class requiredChoice).
const field = (label: string, id: string, values: string[]) => `<div class="wizard_dropdown"><div class="form-container-border">
  <span> ${label} </span><select id="${id}" class="requiredChoice"><option value="none_item">Please make a selection.</option>
  ${values.map((value) => `<option value="${value}">(${value}) HPE Alletra 5000 ${label}</option>`).join('')}</select></div></div>`;

test('Alletra 5000 wizard: random picks follow the rules for a 5010H array', async ({ page }) => {
  await page.setContent(`<div class="wizard_content">
    ${field('Array', 'array', ['S0U33A'])}
    ${field('HDD Capacity', 'hdd', ['R4U42A', 'R4U44A', 'R4U46A', 'S0U34A'])}
    ${field('Bank A Cache', 'banka', ['R8F35A', 'R4U47A', 'R4U50A', 'S0U36A'])}</div>`);
  for (let run = 0; run < 3; run += 1) {
    await page.locator('#hdd, #banka').evaluateAll((selects) => selects.forEach((select) => { (select as HTMLSelectElement).value = 'none_item'; }));
    await new SolutionWizard(page).configure([]);
    await expect(page.locator('#hdd')).toHaveValue('S0U34A');
    await expect(page.locator('#banka')).toHaveValue('S0U36A');
  }
});

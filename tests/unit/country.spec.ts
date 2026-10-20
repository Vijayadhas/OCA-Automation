import { expect, test } from '@playwright/test';
import { Country, matchCountry, type CountryOption } from '../../src/automation/country';

// Landing page markup (captured 2026-10-16): the Country select with region optgroups, under OCA's
// selecter dropdown whose regions open on click (as in the 2026-10-20 Arcus recording).
const regions: Array<[string, Array<[string, string]>]> = [
  ['Europe Middle East and Africa', [['FR', 'FRANCE, METROPOLITAN'], ['SA', 'SAUDI ARABIA'], ['AE', 'UNITED ARAB EMIRATES'], ['GB', 'UNITED KINGDOM']]],
  ['North America', [['CA', 'CANADA'], ['US', 'UNITED STATES']]],
];
const landing = `<div class="flex-row" id="country"><label for="country-selector">Country</label>
  <select id="country-selector" class="selecter-element" style="display:none">${regions.map(([label, countries]) =>
    `<optgroup label="${label}">${countries.map(([code, name]) => `<option value="${code}"${code === 'US' ? ' selected' : ''}>${name}</option>`).join('')}</optgroup>`).join('')}</select>
  <div class="selecter closed"><span class="selecter-selected" onclick="options.style.display = 'block'">UNITED STATES</span>
    <div class="selecter-options" id="options" style="display:none">${regions.map(([label, countries]) => {
    const group = label.replace(/\s+/g, '');
    return `<span class="selecter-group" sgroup="${group}" onclick="document.querySelectorAll('.sgroup-${group}').forEach((item) => { item.style.display = 'block'; })">${label}</span>${
      countries.map(([code, name]) => `<span class="selecter-item group-item sgroup-${group}" style="display:none" title="${name}" data-value="${code}"
        onclick="document.getElementById('country-selector').value = '${code}'; document.querySelector('.selecter-selected').textContent = '${name}'; options.style.display = 'none'">${name}</span>`).join('')}`;
  }).join('')}</div></div></div>`;

const options: CountryOption[] = regions.flatMap(([group, countries]) => countries.map(([value, text]) => ({ value, text, group })));

test('a country is matched by name in any case, by code, or by the one name it starts', () => {
  expect(matchCountry(options, 'Saudi Arabia')?.value).toBe('SA');
  expect(matchCountry(options, 'sa')?.value).toBe('SA');
  expect(matchCountry(options, 'France')?.value).toBe('FR');
  expect(matchCountry(options, 'United')).toBeNull();
  expect(matchCountry(options, 'Atlantis')).toBeNull();
});

test('sets Saudi Arabia through the region and the country, as a user does', async ({ page }) => {
  await page.setContent(landing);
  await new Country(page).apply('Saudi Arabia');
  await expect(page.locator('#country-selector')).toHaveValue('SA');
  await expect(page.locator('.selecter-selected')).toHaveText('SAUDI ARABIA');
});

test('a blank Country keeps United States without clicking, and brings it back after another country', async ({ page }) => {
  await page.setContent(landing);
  await new Country(page).apply(undefined);
  await expect(page.locator('#options')).toBeHidden();
  await new Country(page).apply('SA');
  await new Country(page).apply('');
  await expect(page.locator('#country-selector')).toHaveValue('US');
});

test('an unknown country fails with OCA\'s list as the reason', async ({ page }) => {
  await page.setContent(landing);
  await expect(new Country(page).apply('Atlantis')).rejects.toThrow('is not in OCA\'s Country list');
});

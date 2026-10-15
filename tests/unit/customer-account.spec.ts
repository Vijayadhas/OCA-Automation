import { test, expect, type Page } from '@playwright/test';
import { CustomerAccount } from '../../src/automation/customer-account';

// Structure as captured from OCA's Advanced Settings (2026-10-16), with a stand-in for the selecter plugin.
const landing = (selected: string) => `
  <input aria-label="Search to open UCID or create" id="search-config">
  <span id="advanced" onclick="document.getElementById('settings').style.display='block'">Advanced Settings</span>
  <div id="settings" style="display:none">
    <i id="close-icon" onclick="document.getElementById('settings').style.display='none'">x</i>
    <div>
      <span class="input-title">Customer Account</span>
      <select id="party_id" class="selecter-element">
        <option default="" ${selected ? '' : 'selected'}>Key in value / Select from list</option>
        <option value="120391027" account-name="3M COMPANY">3M COMPANY</option>
        <option value="014141414" account-name="Nutanix" ${selected === 'Nutanix' ? 'selected' : ''}>Nutanix</option>
        <option value="121348205" account-name="Nvidia">Nvidia</option>
      </select><div class="selecter closed"><span class="selecter-selected">${selected || 'Key in value / Select from list'}</span>
        <div class="selecter-options" style="display:none">
          <span class="selecter-item first" data-value="Key in value / Select from list">Key in value / Select from list</span>
          <span class="selecter-item" data-value="120391027">3M COMPANY</span>
          <span class="selecter-item" data-value="014141414">Nutanix</span>
          <span class="selecter-item" data-value="121348205">Nvidia</span>
        </div></div>
    </div>
  </div>
  <script>
    const select = document.getElementById('party_id');
    document.querySelector('.selecter-selected').onclick = () => { document.querySelector('.selecter-options').style.display = 'block'; };
    document.querySelectorAll('.selecter-item').forEach((item) => item.onclick = () => {
      const option = Array.from(select.options).find((entry) => (entry.value || entry.textContent.trim()) === item.dataset.value);
      option.selected = true;
      document.querySelector('.selecter-selected').textContent = item.textContent;
      document.querySelector('.selecter-options').style.display = 'none';
    });
  </script>`;

const selectedName = (page: Page) => page.locator('#party_id').evaluate((select) =>
  (select as HTMLSelectElement).selectedOptions[0].textContent!.trim());

test('sets Customer Account to Nutanix in Advanced Settings and closes it', async ({ page }) => {
  await page.setContent(landing(''));
  await new CustomerAccount(page).apply('nutanix');
  expect(await selectedName(page)).toBe('Nutanix');
  await expect(page.locator('#settings')).toBeHidden();
});

test('clears a Customer Account left from the previous model', async ({ page }) => {
  await page.setContent(landing('Nutanix'));
  await new CustomerAccount(page).apply('');
  expect(await selectedName(page)).toBe('Key in value / Select from list');
  await expect(page.locator('#settings')).toBeHidden();
});

test('leaves Advanced Settings closed when the account is already right', async ({ page }) => {
  await page.setContent(landing(''));
  await new CustomerAccount(page).apply('');
  await expect(page.locator('#settings')).toBeHidden();
  await page.setContent(landing('Nutanix'));
  await new CustomerAccount(page).apply('Nutanix');
  await expect(page.locator('#settings')).toBeHidden();
});

test('reports an account OCA does not list', async ({ page }) => {
  await page.setContent(landing(''));
  await expect(new CustomerAccount(page).apply('No Such Account')).rejects.toThrow('not in OCA\'s Customer Account list');
});

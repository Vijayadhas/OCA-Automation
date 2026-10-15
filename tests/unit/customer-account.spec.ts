import { test, expect, type Page } from '@playwright/test';
import { CustomerAccount } from '../../src/automation/customer-account';

// Structure as captured from OCA's Advanced Settings (2026-10-16), with a stand-in for the selecter plugin.
// As on a fresh OCA page, the list holds only the default entry (and the account already chosen)
// until a name is typed into "Type to search...". The recent-configuration table also names accounts.
const landing = (selected: string) => `
  <input aria-label="Search to open UCID or create" id="search-config">
  <table><tr><td class="overflowable_attribute" title="Nutanix">Nutanix</td></tr></table>
  <ul><li class="item" id="advanced-settings" onclick="document.getElementById('settings').style.display='block'">
    <span class="tab-label">Advanced Settings</span></li></ul>
  <div id="settings" style="display:none">
    <span class="icon" id="close-icon" onclick="document.getElementById('settings').style.display='none'">x</span>
    <h2 class="title">Advanced Settings</h2>
    <div>
      <span class="input-title">Customer Account</span>
      <select id="party_id" class="selecter-element" style="display:none">
        <option default="" ${selected ? '' : 'selected'}>Key in value / Select from list</option>
        ${selected ? `<option value="014141414" account-name="${selected}" selected>${selected}</option>` : ''}
      </select><div class="selecter closed"><span class="selecter-selected">${selected || 'Key in value / Select from list'}</span>
        <div class="selecter-options" style="display:none">
          <input placeholder="Type to search..." aria-label="Type to search...">
          <div class="items"><span class="selecter-item first" data-value="Key in value / Select from list">Key in value / Select from list</span>
          ${selected ? `<span class="selecter-item" data-value="014141414">${selected}</span>` : ''}</div>
        </div></div>
    </div>
  </div>
  <script>
    const accounts = [['120391027', '3M COMPANY'], ['014141414', 'Nutanix'], ['121348205', 'Nvidia']];
    const select = document.getElementById('party_id');
    const items = document.querySelector('.selecter-options .items');
    const bind = () => items.querySelectorAll('.selecter-item').forEach((item) => item.onclick = () => {
      const option = Array.from(select.options).find((entry) => (entry.value || entry.textContent.trim()) === item.dataset.value);
      option.selected = true;
      document.querySelector('.selecter-selected').textContent = item.textContent;
      document.querySelector('.selecter-options').style.display = 'none';
    });
    bind();
    document.querySelector('.selecter-selected').onclick = () => { document.querySelector('.selecter-options').style.display = 'block'; };
    document.querySelector('[placeholder="Type to search..."]').oninput = (event) => setTimeout(() => {
      const typed = event.target.value.toLowerCase();
      accounts.filter(([, name]) => name.toLowerCase().includes(typed)).forEach(([id, name]) => {
        if (!Array.from(select.options).some((entry) => entry.value === id)) select.insertAdjacentHTML('beforeend', '<option value="' + id + '" account-name="' + name + '">' + name + '</option>');
        items.insertAdjacentHTML('beforeend', '<span class="selecter-item" data-value="' + id + '">' + name + '</span>');
      });
      bind();
    }, 300);
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
  await expect(new CustomerAccount(page).apply('No Such Account')).rejects.toThrow('was not found in OCA\'s Customer Account list');
});

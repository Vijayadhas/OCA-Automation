import { test, expect } from '@playwright/test';
import { ModelSearch } from '../../src/automation/model-search';

// Markup from JOB-003 (P75339-B21): jQuery UI announced "No search results." and the menu stayed hidden.
const landing = (announcement: string) => `
  <textarea id="search-config" placeholder="Search to open UCID or create new configuration"
    oninput="setTimeout(() => { document.querySelector('[role=status]').innerHTML = '<div>${announcement}</div>'; }, 200)"></textarea>
  <ul class="ui-autocomplete" style="display: none;"><li class="dqe-history-item ui-menu-item">P72176-B21</li></ul>
  <div role="status" aria-live="assertive" class="ui-helper-hidden-accessible"><div>No search results.</div></div>`;

test('fails fast with a clear message when OCA has no search results for the model', async ({ page }) => {
  await page.setContent(landing('No search results.'));
  const started = Date.now();
  await expect(new ModelSearch(page.context()).searchAndOpen(page, { modelNumber: 'P75339-B21', isSolution: false }))
    .rejects.toThrow('OCA returned no search results for P75339-B21 in aaS mode');
  expect(Date.now() - started).toBeLessThan(20_000);
});

test('ignores a stale "No search results." left from before the search', async ({ page }) => {
  await page.exposeFunction('optionClicked', () => { void page.close(); });
  await page.setContent(`${landing('1 result is available, use up and down arrow keys to navigate.')}
    <script>document.getElementById('search-config').addEventListener('input', () => setTimeout(() => {
      const menu = document.querySelector('ul.ui-autocomplete');
      menu.innerHTML = '<li class="ui-menu-item" onclick="window.optionClicked()">P72176-B21 HPE ProLiant Compute DL360 Gen12 CTO</li>';
      menu.style.display = 'block';
    }, 400));</script>`);
  // The stale announcement is cleared, so the option is found and clicked (which closes this mock page).
  const error = await new ModelSearch(page.context()).searchAndOpen(page, { modelNumber: 'P72176-B21', isSolution: false })
    .catch((caught: Error) => caught);
  expect(String(error)).not.toContain('no search results');
  expect(page.isClosed()).toBe(true);
});

// S3V83A (2026-10-15): the Wizard card shows "arcusDhciSol"; the model number is only in its product
// dropdown (data-displayid). Nine "PC3000 - Promo" Solution Template cards are listed next to it.
const customize = (name: string) => `<div class="dqe-actions"><button class="hpe-btn hpe-primary dqe-customize-btn"
  onclick="window.clickedCard='${name}'; document.body.insertAdjacentHTML('beforeend', '<a href=&quot;#extended_overview_solutionWizard&quot;>Solution Wizard</a>')">Customize</button></div>`;
const templateCard = (name: string) => `<div class="dqe-card card-type-st" data-type="st" data-primarypid="arcusDhciSol">
  <span class="category"><span class="st-name">PC3000 - Promo</span></span><span class="name">${name}</span>${customize(name)}</div>`;
const wizardResults = `
  <textarea id="search-config" placeholder="Search to open UCID or create new configuration"></textarea>
  <ul class="ui-autocomplete" style="display: none;"><li class="ui-menu-item"
    onclick="document.getElementById('dqe_cards_container').style.display = 'block'">S3V83A HPE GreenLake for PC3000 with Alletra Storage MP (Block) Wizard - -</li></ul>
  <div role="status" class="ui-helper-hidden-accessible"></div>
  <div id="dqe_cards_container" style="display: none;">
    <div class="dqe-card card-type-catalog wiz-card" data-type="wiz"><span class="category">"arcusDhciSol" — Wizard</span>
      <span class="name">Build from scratch with no pre-selections</span>
      <div class="card-choices"><select class="dqe-products"><option value="-1">Select Product</option>
        <option value="arcusDhciSol" data-displayid="S3V83A" selected>arcusDhciSol - HPE GreenLake for PC3000 with Alletra Storage MP (Block)</option></select></div>
      ${customize('wizard')}</div>
    ${templateCard('INDIRECT_HPE_PC3000_MP_Scale Optimized_12Svr_210TB_VME_Entry_4YR')}
    ${templateCard('INDIRECT_HPE_PC3000_MP_Cost Optimized_3Svr_33TB_VME_Lite_4YR')}
  </div>
  <script>document.getElementById('search-config').addEventListener('input', () => setTimeout(() => {
    document.querySelector('ul.ui-autocomplete').style.display = 'block'; }, 200));</script>`;

test('opens the Wizard card whose product dropdown carries the model number, not a Solution Template card', async ({ page }) => {
  await page.setContent(wizardResults);
  await new ModelSearch(page.context()).searchAndOpen(page, { modelNumber: 'S3V83A', isSolution: true });
  expect(await page.evaluate(() => (window as unknown as { clickedCard?: string }).clickedCard)).toBe('wizard');
});

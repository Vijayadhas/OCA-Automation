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

import { test, expect } from '@playwright/test';
import { ConfigurationNavigation } from '../../src/automation/configuration-navigation';

// Breadcrumb and toggle as captured on S3V83A; the expanded list stands in for OCA's (not yet
// captured) full navigation, with the server entry text the proven S3V83A script clicked.
const solution = 'HPE GreenLake for PC3000 with Alletra Storage MP #1';
const server = 'HPE DL325 Gen11 GPU CTO Svr #1';
const page = `
  <ul id="nav">
    <li idx="0" id="eo_nav_li_0" class="eo_nav_li ">OCA Config 2</li>
    <li idx="1" id="eo_nav_li_1" class="eo_nav_li ">${solution} Group</li>
    <li idx="2" id="eo_nav_li_2" class="eo_nav_li current" onclick="window.go(this)">${solution}</li>
  </ul>
  <i id="show_full_nav" class="icon-angle-down show_full_nav"
    onclick="window.toggles = (window.toggles ?? 0) + 1; const list = document.getElementById('full'); list.style.display = list.style.display === 'none' ? 'block' : 'none'">v</i>
  <i id="nav_up" title="Click to go to the parent level"></i>
  <select style="display:none"><option>HPE DL325 Gen11 GPU CTO Svr</option></select>
  <div id="full" style="display:none"><div>${solution}</div><div><span onclick="window.openServer()">${server}</span></div></div>
  <script>
    window.go = (li) => { document.querySelectorAll('.eo_nav_li').forEach((item) => item.classList.remove('current')); li.classList.add('current');
      document.getElementById('srv')?.remove(); };
    window.openServer = () => { document.querySelectorAll('.eo_nav_li').forEach((item) => item.classList.remove('current'));
      document.getElementById('nav').insertAdjacentHTML('beforeend', '<li id="srv" class="eo_nav_li current">${server}</li>'); };
  </script>`;

test('finds the servers of a solution, opens one, and returns to the solution', async ({ page: browser }) => {
  await browser.setContent(page);
  const navigation = new ConfigurationNavigation(browser);
  expect(await navigation.currentLevel()).toBe(solution);
  expect(await navigation.serverEntries('HPE DL325 Gen11 GPU CTO Svr')).toEqual([server]);
  await navigation.open(server);
  expect(await navigation.currentLevel()).toBe(server);
  // The list was already open, so the toggle was not clicked a second time (that would close it).
  expect(await browser.evaluate(() => (window as unknown as { toggles: number }).toggles)).toBe(1);
  await navigation.returnTo(solution);
  expect(await navigation.currentLevel()).toBe(solution);
});

test('finds no server entries when the solution lists none', async ({ page: browser }) => {
  await browser.setContent(page.replace(server, 'Something else'));
  expect(await new ConfigurationNavigation(browser).serverEntries('HPE DL325 Gen11 GPU CTO Svr')).toEqual([]);
});

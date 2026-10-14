import { test, expect } from '@playwright/test';
import { ConfigurationNavigation } from '../../src/automation/configuration-navigation';

// Breadcrumb, toggle, and popup tree as captured on S3V83A (2026-10-15); the Solution Wizard had
// picked "(P53921-B21#GTA) HPE DL385 Gen11 8SFF CTO Svr", listed in the tree as "DL385 Gen11 #1".
const solution = 'HPE GreenLake for PC3000 with Alletra Storage MP #1';
const base = '|F7D86DEC3F23B676A9AFA40E1B886B57|instance_2_GROUP|ZU715A_1';
const item = (key: string, label: string, description: string) => `<li><span class="popup_tree_item" key="${key}">
  <span class="label">${label}</span><span class="description"> (${description})</span></span><ul></ul></li>`;
const page = (serverKey = `${base}|P53921-B21#GTA_57`) => `
  <ul id="nav">
    <li idx="0" id="eo_nav_li_0" class="eo_nav_li ">OCA Config 2</li>
    <li idx="1" id="eo_nav_li_1" class="eo_nav_li " onclick="window.go(this)">${solution} Group</li>
    <li idx="2" id="eo_nav_li_2" class="eo_nav_li current" onclick="window.go(this)">${solution}</li>
  </ul>
  <i id="show_full_nav" class="icon-angle-down show_full_nav"
    onclick="window.toggles = (window.toggles ?? 0) + 1; const tree = document.querySelector('.eo_popup_tree'); tree.style.display = tree.style.display === 'none' ? 'block' : 'none'"></i>
  <i id="nav_up" title="Click to go to the parent level"></i>
  <div class="eo_popup_tree" style="display:none"><ul><li><span class="popup_tree_item" key="root"><span class="label">OCA Config 2</span></span><ul>
    ${item(`${base}|S4Q68A_9`, 'SN8325H Switch #1', 'HPE Storage DCN 16p QSFP28 100GbE Connector to Power Half Width Switch H-series SN8325H')}
    ${item(`${base}|S3V93A_5`, 'PE GL Prv Cld w/AL STG MP 2U Chassis #1', 'HPE GreenLake for Private Cloud Business Edition w/Alletra STG MP 2U Chassis')}
    ${item(serverKey, 'DL385 Gen11 #1', 'HPE ProLiant ProLiant DL385 Gen11 8SFF TAA Compliant Configure-to-order Server')}
  </ul></li></ul></div>
  <script>
    window.go = (li) => { document.querySelectorAll('.eo_nav_li').forEach((other) => other.classList.remove('current')); li.classList.add('current');
      document.getElementById('srv')?.remove(); };
    document.querySelectorAll('.popup_tree_item .label').forEach((label) => label.addEventListener('click', () => {
      document.querySelectorAll('.eo_nav_li').forEach((other) => other.classList.remove('current'));
      document.getElementById('nav').insertAdjacentHTML('beforeend', '<li id="srv" class="eo_nav_li current">' + label.textContent + '</li>');
      document.querySelector('.eo_popup_tree').style.display = 'none';
    }));
  </script>`;

test('finds the Solution Wizard server by its part number, opens it, and returns to the solution', async ({ page: browser }) => {
  await browser.setContent(page());
  const navigation = new ConfigurationNavigation(browser);
  expect(await navigation.currentLevel()).toBe(solution);
  const servers = await navigation.entriesForPart('P53921-B21#GTA');
  expect(servers.map((entry) => entry.label)).toEqual(['DL385 Gen11 #1']);
  await navigation.open(servers[0]);
  expect(await navigation.currentLevel()).toBe('DL385 Gen11 #1');
  await navigation.returnTo(solution);
  expect(await navigation.currentLevel()).toBe(solution);
});

test('a different part number, or one that only starts the same, is not a match', async ({ page: browser }) => {
  await browser.setContent(page(`${base}|P53921-B21_57`));
  const navigation = new ConfigurationNavigation(browser);
  expect(await navigation.entriesForPart('P53921-B21#GTA')).toEqual([]);
  expect((await navigation.entriesForPart('P53921-B21')).map((entry) => entry.label)).toEqual(['DL385 Gen11 #1']);
  expect(await navigation.entriesForPart('P53921')).toEqual([]);
});

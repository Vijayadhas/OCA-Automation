import { expect, test } from '@playwright/test';
import { wizardRange } from '../../src/automation/solution-wizard';
import { ComponentEngine } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';

// S3V83A / Arcus PC3000 wizard text just above Server Qty (captured 2026-10-15).
test('Server Qty takes the last "Min N / Max M" the wizard states before it', () => {
  expect(wizardRange('Min 2 / Max 2 Switch ... Please select the desired size of dHCI configuration Min 3 / Max 16 Servers can selected Select ONE Server model'))
    .toEqual({ min: 3, max: 16, stated: true });
  expect(wizardRange('Select ONE Server model')).toEqual({ min: 1, max: 16, stated: false });
});

// Solution Menu picks ask for a default quantity; the choice's own OCA rule decides when it states a minimum.
test('a solution Menu pick is raised to the minimum the choice\'s rule states', async ({ page }) => {
  await page.setContent(menuSection({ key: 'hdd', title: 'Capacity', choices: [{
    id: 'hdd_drives', title: 'Capacity', flagged: true,
    messages: '<li class="message_li"><span class="error_message">Minimum 20 drives must be selected (<a class="err-lnk" id="hdd_drives">Capacity</a>)</span></li>',
    rows: [{ pid: 'R9H73B', description: 'HPE Alletra Storage MP 15.36TB NVMe Read Intensive FIPS 140-3 Encrypted SSD', select: [0, 8, 16, 20, 24] }],
  }] }));
  expect(await new ComponentEngine(page).selectInChoice('Capacity', undefined, 16)).toMatchObject({ productNumber: 'R9H73B', quantity: 20 });
  await expect(page.locator('#item_tr_R9H73B_hdd_drives select')).toHaveValue('20');
});

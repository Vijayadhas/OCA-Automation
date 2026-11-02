import { test, expect, type Page } from '@playwright/test';
import { ComponentEngine, driveText, STORAGE_DRIVE_KINDS } from '../../src/automation/component-engine';
import { menuSection } from './oca-menu-fixture';

// User, 2026-11-02: a storage model (not a wizard) whose Menu has a Storage Devices section gets an HDD and an
// SSD there before Services and End BOM. Section, choice and row structure as captured on server Menus
// (Storage Devices on P83540-B21); the storage model's own capture is still to be checked.
const storageDevices = (options: { hdd?: boolean; ssd?: boolean; hddSelected?: boolean } = {}) =>
  menuSection({ key: 'stor', title: 'Storage Devices', collapsed: true, choices: [
    { id: 'stor_cage', title: 'Drive Cage', rows: [{ pid: 'CAGE-A', description: '8SFF x1 Drive Cage', select: [0, 1] }] },
    { id: 'stor_drives', title: 'Drives', rows: [
      ...(options.hdd === false ? [] : [
        { pid: 'HDD-1', description: 'HPE 2.4TB SAS 12G Mission Critical 10K SFF HDD', quantity: options.hddSelected ? 2 : 0, select: [0, 2, 4] },
        { pid: 'HDD-2', description: 'HPE 1.2TB SAS 12G Mission Critical 10K SFF HDD', select: [0, 2, 4] },
      ]),
      ...(options.ssd === false ? [] : [
        { pid: 'SSD-1', description: 'HPE 960GB SATA 6G Read Intensive SFF SSD', select: [0, 1, 2] },
      ]),
    ] },
  ] });

const quantity = (page: Page, pid: string) => page.locator(`[id^="item_tr_${pid}_"] .item_qty_div`).textContent();

test('selects one HDD and one SSD with the smallest offered quantity, and nothing else', async ({ page }) => {
  await page.setContent(menuSection({ key: 'cap', title: 'Capacity', choices: [
    { id: 'cap_main', title: 'Capacity', rows: [{ pid: 'CAP-1', quantity: 8, select: [0, 8, 16] }] },
  ] }) + storageDevices());
  const drives = await new ComponentEngine(page).selectStorageDrives();

  expect(drives.map((drive) => drive.kind)).toEqual(['HDD', 'SSD']);
  expect(['HDD-1', 'HDD-2']).toContain(drives[0].productNumber);
  expect(drives[0].quantity).toBe(2);
  expect(drives[1]).toMatchObject({ productNumber: 'SSD-1', quantity: 1 });
  const hdds = [await quantity(page, 'HDD-1'), await quantity(page, 'HDD-2')];
  expect(hdds.filter((value) => value === '2')).toHaveLength(1);
  expect(await quantity(page, 'SSD-1')).toBe('1');
  expect(await quantity(page, 'CAGE-A')).toBe('0');
  expect(await quantity(page, 'CAP-1')).toBe('8');
});

test('selects only the drive kind the model offers', async ({ page }) => {
  await page.setContent(storageDevices({ hdd: false }));
  const drives = await new ComponentEngine(page).selectStorageDrives();
  expect(drives).toEqual([expect.objectContaining({ kind: 'SSD', productNumber: 'SSD-1' })]);
});

test('keeps an HDD already selected and still adds an SSD', async ({ page }) => {
  await page.setContent(storageDevices({ hddSelected: true }));
  const drives = await new ComponentEngine(page).selectStorageDrives();
  expect(drives[0]).toMatchObject({ kind: 'HDD', productNumber: 'HDD-1', quantity: 2 });
  expect(await quantity(page, 'HDD-2')).toBe('0');
  expect(drives[1]).toMatchObject({ kind: 'SSD', productNumber: 'SSD-1' });
});

test('does nothing when the model has no Storage Devices section', async ({ page }) => {
  await page.setContent(menuSection({ key: 'cap', title: 'Capacity', choices: [
    { id: 'cap_main', title: 'Capacity', rows: [{ pid: 'CAP-1', select: [0, 8] }] },
  ] }));
  expect(await new ComponentEngine(page).selectStorageDrives()).toEqual([]);
  expect(await quantity(page, 'CAP-1')).toBe('0');
});

test('recognises HDD and SSD products by description, else by their choice title', () => {
  const kind = (text: string) => STORAGE_DRIVE_KINDS.filter((item) => item.matches(text)).map((item) => item.name);
  expect(kind('HPE 2.4TB SAS 12G Mission Critical 10K SFF HDD')).toEqual(['HDD']);
  expect(kind('HPE 960GB SATA 6G Read Intensive SFF SSD')).toEqual(['SSD']);
  expect(kind('HPE 3.84TB NVMe Gen4 Solid State Drive')).toEqual(['SSD']);
  expect(kind('8SFF x1 Drive Cage')).toEqual([]);
  expect(kind(driveText('HPE 4TB SATA 7.2K LFF', 'Hard Drives'))).toEqual(['HDD']);
  expect(kind(driveText('HPE 960GB SATA 6G Read Intensive SFF SSD', 'Hard Drives'))).toEqual(['SSD']);
});

import { test, expect } from '@playwright/test';
import { ComponentEngine } from '../../src/automation/component-engine';
import { QuantityHandler } from '../../src/components/quantity-handler';
import { menuSection } from './oca-menu-fixture';

function memoryRows(secondAvailable: boolean): string {
  return menuSection({ key: 'memZ', title: 'Memory', choices: [{ id: 'memZ_slots', title: 'Memory', rows: [
    { pid: 'FIRST', description: 'Memory DIMM', select: [0] },
    { pid: 'SECOND', description: 'Memory DIMM', select: secondAvailable ? [0, 1, 2] : [0] },
  ] }] });
}

test('tries the next memory candidate when the first quantity option is unavailable', async ({ page }) => {
  await page.setContent(memoryRows(true));
  const random = Math.random;
  Math.random = () => 0;
  try {
    const result = await new ComponentEngine(page).selectRandom('Memory');
    expect(result).toEqual({ productNumber: 'SECOND', description: 'Memory DIMM', quantity: 1 });
    await expect(page.locator('#item_tr_FIRST_memZ_slots select')).toHaveValue('0');
    await expect(page.locator('#item_tr_SECOND_memZ_slots select')).toHaveValue('1');
  } finally { Math.random = random; }
});

test('stops with both candidate failures when all choices are unavailable', async ({ page }) => {
  await page.setContent(memoryRows(false));
  await expect(new ComponentEngine(page).selectRandom('Memory')).rejects.toThrow(/All Memory candidates failed:(?=.*FIRST)(?=.*SECOND)/);
  await expect(page.locator('select').nth(0)).toHaveValue('0');
  await expect(page.locator('select').nth(1)).toHaveValue('0');
});

test('restores a partially changed candidate before selecting the next memory', async ({ page }) => {
  await page.setContent(memoryRows(true));
  const original = QuantityHandler.prototype.set;
  const random = Math.random;
  const attempts: string[] = [];
  Math.random = () => 0;
  QuantityHandler.prototype.set = async function (row, part, quantity, stable) {
    attempts.push(`${part}:${quantity}`);
    if (part === 'FIRST' && quantity === 1) {
      await row.locator('select').evaluate((select) => {
        select.append(new Option('1', '1'));
        (select as HTMLSelectElement).value = '1';
      });
      throw new Error('Simulated failure after a partial change');
    }
    return original.call(this, row, part, quantity, stable);
  };
  try {
    expect(await new ComponentEngine(page).selectRandom('Memory')).toEqual({ productNumber: 'SECOND', description: 'Memory DIMM', quantity: 1 });
    expect(attempts).toEqual(['FIRST:1', 'FIRST:0', 'SECOND:1']);
    await expect(page.locator('#item_tr_FIRST_memZ_slots select')).toHaveValue('0');
  } finally {
    QuantityHandler.prototype.set = original;
    Math.random = random;
  }
});

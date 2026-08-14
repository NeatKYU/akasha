import { test, expect } from '@playwright/test';

test('creates a project', async ({ page }) => {
  await page.goto('/projects');
  await page.locator('.new-project').click();
  await page.locator('input').fill('Alpha');
  await page.locator('.save').click();
  await page.waitForTimeout(3000);
  expect(await page.locator('.project-row').count()).toBe(1);
});

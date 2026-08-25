import { test, expect } from '@playwright/test';

test('creates a project', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Alpha');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Alpha/ })).toBeVisible();
});

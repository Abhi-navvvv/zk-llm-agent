import { test, expect } from '@playwright/test';

test.describe('ZK ML Agent Dashboard E2E', () => {
  test('should load the dashboard and verify key elements', async ({ page }) => {
    // Visit the home page
    await page.goto('/');

    // Verify page title
    const title = page.locator('.hero-title');
    await expect(title).toContainText('ZK-ML Keeper Vault Dashboard');

    // Verify presets dropdown is visible
    const presetSelect = page.locator('select').first();
    await expect(presetSelect).toBeVisible();

    // Verify MLAgentVault section is present
    const vaultTitle = page.locator('text=MLAgentVault.sol');
    await expect(vaultTitle).toBeVisible();

    // Verify logs terminal shows keeper-sh is ready
    const terminalLogs = page.locator('.terminal-body');
    await expect(terminalLogs).toContainText('keeper-sh: ready');
  });
});

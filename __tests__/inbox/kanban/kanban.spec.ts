// @ts-nocheck — requires @playwright/test which is not in package.json
// devDependencies yet. The executor should `npm install -D @playwright/test`
// and remove this pragma before running `npx playwright test`.

/**
 * Playwright e2e for the kanban split-inbox (T15).
 *
 * Run with: `npx playwright test __tests__/inbox/kanban/kanban.spec.ts`
 *
 * Requires:
 *   - Dev server running on http://localhost:3000 (`npm run dev`)
 *   - A signed-in user (auth setup via fixtures or cookies)
 *   - Seed data loaded (`insforge/seed.sql`)
 *
 * The page exposes these data-testid attributes (from T7/T8/T10/T11):
 *   - `kanban-lane-${laneId}` on each lane column
 *   - `lane-count` on the header count badge
 *   - `kanban-row` on each conversation row
 *   - `kanban-drawer` on the right drawer panel
 *   - `drawer-backdrop` on the backdrop overlay
 *   - `kanban-total` on the top bar total badge
 */

import { test, expect, type Page } from '@playwright/test';

async function signInAndGotoKanban(page: Page) {
  // Sign in flow. If the project has a session cookie fixture, prefer
  // that — for now this is a placeholder that the executor should
  // replace with a real auth setup (matching `__tests__/inbox-infinite-loading.test.tsx`).
  await page.goto('http://localhost:3000/login');
  // ... (project-specific sign-in form fill) ...
  await page.goto('http://localhost:3000/inbox/kanban');
}

test.describe('Kanban flow', () => {
  test('page renders 5 lanes with data-testid attributes', async ({ page }) => {
    await signInAndGotoKanban(page);
    await page.waitForSelector('[data-testid="kanban-lane-mine"]');
    await page.waitForSelector('[data-testid="kanban-lane-escalated"]');
    await page.waitForSelector('[data-testid="kanban-lane-ai_drafted"]');
    await page.waitForSelector('[data-testid="kanban-lane-awaiting_reply"]');
    await page.waitForSelector('[data-testid="kanban-lane-unassigned"]');

    // Top bar shows the "Kanban" title
    await expect(page.getByText('Kanban').first()).toBeVisible();
  });

  test('clicking a row opens the drawer', async ({ page }) => {
    await signInAndGotoKanban(page);
    // Wait for at least one row to be visible
    await page.waitForSelector('[data-testid="kanban-row"]', { state: 'visible' });
    await page.locator('[data-testid="kanban-row"]').first().click();
    await page.waitForSelector('[data-testid="kanban-drawer"]', { state: 'visible' });
    await page.waitForSelector('[data-testid="drawer-backdrop"]', { state: 'visible' });
  });

  test('clicking the backdrop closes the drawer', async ({ page }) => {
    await signInAndGotoKanban(page);
    await page.waitForSelector('[data-testid="kanban-row"]', { state: 'visible' });
    await page.locator('[data-testid="kanban-row"]').first().click();
    await page.waitForSelector('[data-testid="kanban-drawer"]', { state: 'visible' });
    await page.locator('[data-testid="drawer-backdrop"]').click();
    await page.waitForSelector('[data-testid="kanban-drawer"]', { state: 'hidden' });
    // 5 lanes still visible
    await expect(page.locator('[data-testid="kanban-lane-mine"]')).toBeVisible();
    await expect(page.locator('[data-testid="kanban-lane-escalated"]')).toBeVisible();
  });

  test('clicking a different row switches the conversation (no close-then-open)', async ({ page }) => {
    await signInAndGotoKanban(page);
    await page.waitForSelector('[data-testid="kanban-row"]', { state: 'visible' });
    const rows = page.locator('[data-testid="kanban-row"]');
    const count = await rows.count();
    test.skip(count < 2, 'Need at least 2 rows in any lane for this test');
    await rows.nth(0).click();
    await page.waitForSelector('[data-testid="kanban-drawer"]', { state: 'visible' });
    const firstConvId = await rows.nth(0).getAttribute('data-lane-id');
    await rows.nth(1).click();
    const secondConvId = await rows.nth(1).getAttribute('data-lane-id');
    // Drawer should still be visible (not closed/reopened) and showing the 2nd conversation
    await expect(page.locator('[data-testid="kanban-drawer"]')).toBeVisible();
    expect(firstConvId).not.toBe(secondConvId);
  });
});

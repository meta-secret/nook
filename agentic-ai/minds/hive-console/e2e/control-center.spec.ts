import { expect, test, type Page } from '@playwright/test';
import type { ObserverSnapshot } from '../src/types';

const now = Date.now();

const snapshot: ObserverSnapshot = {
  generated_at: now,
  copy: {
    product_name: 'Hive Control Center',
    product_description:
      'Agent tasks, workers, and execution history in one place',
    overview: 'Overview',
    workers: 'Workers',
    queue: 'Queue',
    needs_attention: 'Needs attention',
    recent_activity: 'Recent activity',
    all_tasks: 'All tasks',
    search_tasks: 'Search tasks',
    no_tasks: 'No tasks yet',
    no_tasks_description: 'New work will appear here when Hive is triggered.',
    no_search_results: 'No matching tasks',
    no_search_results_description: 'Adjust the search to see other tasks.',
    no_attention: 'Nothing needs intervention',
    no_attention_description: 'There are no blocked, stale, or failed tasks.',
    task_details: 'Task details',
    trigger: 'Trigger',
    source_revision: 'Source revision',
    current_attempt: 'Current attempt',
    dependencies: 'Dependencies',
    timeline: 'Timeline',
    no_activity: 'The agent has not recorded any activity yet.',
    no_dependencies: 'This task has no dependencies.',
    attempt: 'Attempt',
    last_seen: 'Last seen',
    updated: 'Updated',
    stale: 'Stale',
    healthy: 'Healthy',
    idle: 'Idle',
    running: 'Running',
    ready: 'Ready',
    blocked: 'Blocked',
    failed: 'Failed',
    cancelling: 'Cancelling',
    cancelled: 'Cancelled',
    completed: 'Completed',
    unavailable: 'Hive is unavailable',
    unavailable_description: 'The observer state could not be loaded.',
    retry_connection: 'Try again',
    close_details: 'Close details',
  },
  agents: [
    {
      id: 'agent-one',
      pod_name: 'hive-7c49d9b5c8-krx2p',
      status: 'RUNNING',
      last_seen_at: now - 18_000,
    },
    {
      id: 'agent-two',
      pod_name: 'hive-7c49d9b5c8-n8w4q',
      status: 'IDLE',
      last_seen_at: now - 8_000,
    },
    {
      id: 'agent-three',
      pod_name: 'hive-7c49d9b5c8-qm6tz',
      status: 'IDLE',
      last_seen_at: now - 7 * 60_000,
    },
    {
      id: 'agent-four',
      pod_name: 'hive-7c49d9b5c8-v2jhd',
      status: 'IDLE',
      last_seen_at: now - 11_000,
    },
  ],
  tasks: [
    {
      id: 'main-repair-359c937a-run-302991001',
      kind: 'main-repair',
      kind_label: 'Main repair',
      trigger: 'GitHub Actions · failed main workflow',
      status: 'RUNNING',
      source_commit: '359c937a97e69d42d7a456187c346c767ac6f72a',
      priority: 100,
      attempt_count: 2,
      max_attempts: 3,
      created_at: now - 28 * 60_000,
      updated_at: now - 18_000,
      lease_until: now + 42 * 60_000,
      agent_id: 'agent-one',
      pod_name: 'hive-7c49d9b5c8-krx2p',
      latest_attempt_status: 'RUNNING',
      latest_attempt_started_at: now - 12 * 60_000,
      latest_attempt_completed_at: 0,
      latest_error: '',
      latest_summary: '',
      dependencies: [
        {
          id: 'repair-hive-manifest-contract',
          status: 'COMPLETED',
        },
      ],
      activity: [
        {
          id: 'activity-3',
          kind: 'action',
          message: 'Running repository command',
          detail: '',
          created_at: now - 18_000,
          attempt_id: 'attempt-2',
          attempt_number: 2,
        },
        {
          id: 'activity-2',
          kind: 'edit',
          message: 'Applying repository changes',
          detail: '',
          created_at: now - 2 * 60_000,
          attempt_id: 'attempt-2',
          attempt_number: 2,
        },
        {
          id: 'activity-1',
          kind: 'started',
          message: 'Agent started',
          detail: '',
          created_at: now - 12 * 60_000,
          attempt_id: 'attempt-2',
          attempt_number: 2,
        },
      ],
    },
    {
      id: 'dependency-cache-repair',
      kind: 'blocker',
      kind_label: 'Blocking task',
      trigger: 'Agent task · dependency for main-repair-359c937a-run-302991001',
      status: 'FAILED',
      source_commit: '359c937a97e69d42d7a456187c346c767ac6f72a',
      priority: 200,
      attempt_count: 3,
      max_attempts: 3,
      created_at: now - 55 * 60_000,
      updated_at: now - 9 * 60_000,
      lease_until: 0,
      agent_id: 'agent-three',
      pod_name: 'hive-7c49d9b5c8-qm6tz',
      latest_attempt_status: 'FAILED',
      latest_attempt_started_at: now - 20 * 60_000,
      latest_attempt_completed_at: now - 9 * 60_000,
      latest_error: 'Verification failed after the final permitted attempt.',
      latest_summary: '',
      dependencies: [],
      activity: [
        {
          id: 'failed-activity',
          kind: 'error',
          message: 'Repository command failed',
          detail: 'task hive:verify · status 1 · 401.2s',
          created_at: now - 9 * 60_000,
          attempt_id: 'failed-attempt-3',
          attempt_number: 3,
        },
      ],
    },
    {
      id: 'completed-doc-sync',
      kind: 'documentation',
      kind_label: 'Documentation',
      trigger: 'Manual dispatch · Hive CLI',
      status: 'COMPLETED',
      source_commit: '359c937a97e69d42d7a456187c346c767ac6f72a',
      priority: 0,
      attempt_count: 1,
      max_attempts: 3,
      created_at: now - 3 * 60 * 60_000,
      updated_at: now - 2 * 60 * 60_000,
      lease_until: 0,
      agent_id: 'agent-two',
      pod_name: 'hive-7c49d9b5c8-n8w4q',
      latest_attempt_status: 'COMPLETED',
      latest_attempt_started_at: now - 3 * 60 * 60_000,
      latest_attempt_completed_at: now - 2 * 60 * 60_000,
      latest_error: '',
      latest_summary: 'Documentation synchronized and validated.',
      dependencies: [],
      activity: [],
    },
  ],
};

async function routeSnapshot(page: Page, value = snapshot) {
  await page.route('**/api/overview?*', (route) =>
    route.fulfill({ json: value }),
  );
}

test('shows worker health, attention, task evidence, and durable activity', async ({
  page,
}) => {
  await routeSnapshot(page);
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Hive Control Center' }),
  ).toBeVisible();
  await expect(
    page.getByText('Needs attention', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Main repair', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('Source revision')).toBeVisible();
  await expect(
    page.getByText('GitHub Actions · failed main workflow'),
  ).toBeVisible();
  await expect(
    page.getByText('Running repository command').last(),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/control-center-desktop.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: /dependency-cache-repair/ }).click();
  await expect(page.getByText('Verification failed after')).toBeVisible();
  await expect(page.getByText('task hive:verify')).toBeVisible();
});

test('keeps the task journey reachable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeSnapshot(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeVisible();
  await expect(page.getByText(/hive-7c4…c8-krx2p/)).toBeVisible();
  await page.getByPlaceholder('Search tasks').fill('completed');
  const completedTask = page.getByRole('button', {
    name: /Documentation Completed/,
  });
  await expect(completedTask).toBeVisible();
  await completedTask.click();
  await expect(page.locator('.detail-panel')).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'Documentation', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/control-center-mobile.png',
    fullPage: true,
  });
  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test('explains an empty queue', async ({ page }) => {
  await routeSnapshot(page, { ...snapshot, tasks: [] });
  await page.goto('/');

  await expect(page.getByText('No tasks yet')).toBeVisible();
  await expect(
    page.getByText('New work will appear here when Hive is triggered.'),
  ).toBeVisible();
});

test('declares the Russian interface language', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'language', { value: 'ru-RU' });
  });
  await routeSnapshot(page);
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});

test('uses immediate task navigation with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    HTMLElement.prototype.scrollIntoView = function (
      options?: boolean | ScrollIntoViewOptions,
    ) {
      if (typeof options !== 'boolean') {
        document.documentElement.dataset.scrollBehavior =
          options?.behavior ?? 'auto';
      }
    };
  });
  await routeSnapshot(page);
  await page.goto('/');

  await page.getByRole('button', { name: /Blocking task Failed/ }).click();
  await expect(page.locator('html')).toHaveAttribute(
    'data-scroll-behavior',
    'auto',
  );
});

test('keeps an explicitly closed inspector closed during search', async ({
  page,
}) => {
  await routeSnapshot(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByPlaceholder('Search tasks').fill('completed');
  await expect(page.locator('.detail-header')).toHaveCount(0);
});

test('distinguishes no search results and labels activity attempts', async ({
  page,
}) => {
  await routeSnapshot(page);
  await page.goto('/');

  await expect(
    page.locator('.timeline').getByText('Attempt 2').first(),
  ).toBeVisible();
  await page.getByPlaceholder('Search tasks').fill('not-a-real-task');
  await expect(page.getByText('No matching tasks')).toBeVisible();
  await expect(
    page.getByText('Adjust the search to see other tasks.'),
  ).toBeVisible();
});

test('finds durable task history by exact ID outside the overview', async ({
  page,
}) => {
  const archived = {
    ...snapshot.tasks[2],
    id: 'archived-task-outside-overview',
  };
  await routeSnapshot(page);
  await page.route('**/api/tasks/archived-task-outside-overview?*', (route) =>
    route.fulfill({ json: archived }),
  );
  await page.goto('/');

  await page
    .getByPlaceholder('Search tasks')
    .fill('archived-task-outside-overview');
  await expect(
    page.getByRole('button', { name: /Documentation Completed/ }),
  ).toBeVisible();
  await expect(
    page.getByText('archived-task-outside-overview').last(),
  ).toBeVisible();
});

test('ages cached running tasks with client time', async ({ page }) => {
  await page.clock.install({ time: now });
  await routeSnapshot(page, {
    ...snapshot,
    tasks: [
      {
        ...snapshot.tasks[0],
        updated_at: now - 4 * 60_000,
      },
    ],
  });
  await page.goto('/');
  await expect(page.locator('.attention-lane')).toHaveCount(0);

  await page.clock.fastForward(2 * 60_000);
  await expect(page.locator('.attention-lane')).toBeVisible();
});

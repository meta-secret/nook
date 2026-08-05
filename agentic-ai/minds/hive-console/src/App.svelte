<!--
THESIS: A durable operations desk that makes agent work legible, refusing the generic metric-card dashboard.
OWN-WORLD: Nook neutrals, hairline regions, compact state labels, and one amber attention lane.
STORY: Confirm worker health, scan active work, inspect why a task exists, then follow its durable timeline.
FIRST VIEWPORT: Worker rail at left, prioritized queue in the center, selected-task inspector at right.
FORM: Dense three-region operator console using the incumbent Nook system and attention-first staging.
-->
<script lang="ts">
  import {
    Activity,
    AlertTriangle,
    ArrowUpDown,
    CheckCircle2,
    CircleDashed,
    Clock3,
    Filter,
    GitCommitHorizontal,
    Hexagon,
    Layers,
    Search,
    Server,
    X,
  } from '@lucide/svelte';
  import type {
    ObservedActivity,
    ObservedAgent,
    ObservedAlert,
    ObservedTask,
    ObserverCopy,
    ObserverSnapshot,
  } from './types';
  import { ObservedAlertSeverity, ObservedExecutionStatus } from './types';
  import { emergencyCopy } from './emergency-copy';
  import {
    DurableTaskLookupKind,
    DetailPanelMountKind,
    ObserverFeedKind,
    PollScheduleKind,
    SelectedTaskKind,
    SnapshotLoadRequestKind,
    TaskSelectionKind,
    type DurableTaskLookup,
    type DetailPanelMount,
    type ObserverFeed,
    type PollSchedule,
    type SelectedTask,
    type SnapshotLoadRequest,
    type TaskSelection,
  } from './app-state';

  type TabFilter = 'all' | 'attention' | 'running' | 'failed' | 'completed';
  type SortOption = 'newest' | 'oldest' | 'attempts';

  let snapshotState = $state<ObserverFeed>({
    kind: ObserverFeedKind.NotLoaded,
  });
  let selectedIdState = $state<TaskSelection>({ kind: TaskSelectionKind.None });
  let search = $state('');
  let selectedTab = $state<TabFilter>('all');
  let sortBy = $state<SortOption>('newest');
  let groupByKind = $state<boolean>(false);
  let loading = $state(true);
  let unavailable = $state(false);
  let detailPanel = $state<DetailPanelMount>({
    kind: DetailPanelMountKind.Unmounted,
  });
  let detailsClosed = $state(false);
  let durableMatchState = $state<DurableTaskLookup>({
    kind: DurableTaskLookupKind.NotFound,
  });
  let nowMs = $state(Date.now());

  const copy = $derived(
    snapshotState.kind === ObserverFeedKind.Loaded
      ? snapshotState.snapshot.copy
      : emergencyCopy(navigator.language || 'en'),
  );
  const selectedState = $derived.by<SelectedTask>(() => {
    if (selectedIdState.kind === TaskSelectionKind.None) {
      return { kind: SelectedTaskKind.Closed };
    }
    const selectedTaskId = selectedIdState.taskId;
    if (snapshotState.kind === ObserverFeedKind.Loaded) {
      const snapshot = snapshotState.snapshot;
      const task = snapshot.tasks.find(
        (candidate) => candidate.id === selectedTaskId,
      );
      if (task) return { kind: SelectedTaskKind.Open, task };
    }
    if (
      durableMatchState.kind === DurableTaskLookupKind.Found &&
      durableMatchState.task.id === selectedTaskId
    ) {
      return {
        kind: SelectedTaskKind.Open,
        task: durableMatchState.task,
      };
    }
    return { kind: SelectedTaskKind.Closed };
  });

  const attentionEntries = $derived.by(() => {
    if (snapshotState.kind !== ObserverFeedKind.Loaded) return [];
    const snapshot = snapshotState.snapshot;
    return snapshot.alerts.flatMap((alert) => {
      const task = snapshot.tasks.find(
        (candidate) => candidate.id === alert.task_id,
      );
      return task ? [{ alert, task }] : [];
    });
  });
  const attentionTaskIds = $derived(
    new Set(attentionEntries.map(({ task }) => task.id)),
  );

  const statusCounts = $derived.by(() => {
    const all =
      snapshotState.kind === ObserverFeedKind.Loaded
        ? snapshotState.snapshot.tasks
        : [];
    const attention = attentionEntries.length;
    const running = all.filter(
      (t) => t.status === ObservedExecutionStatus.Running,
    ).length;
    const failed = all.filter(
      (t) =>
        t.status === ObservedExecutionStatus.Failed ||
        t.status === ObservedExecutionStatus.Blocked,
    ).length;
    const completed = all.filter(
      (t) => t.status === ObservedExecutionStatus.Completed,
    ).length;
    return { all: all.length, attention, running, failed, completed };
  });

  const filteredTasks = $derived.by(() => {
    const snapshotTasks =
      snapshotState.kind === ObserverFeedKind.Loaded
        ? snapshotState.snapshot.tasks
        : [];
    const durableTasks: ObservedTask[] = [];
    if (durableMatchState.kind === DurableTaskLookupKind.Found) {
      const durableTask = durableMatchState.task;
      if (!snapshotTasks.some((task) => task.id === durableTask.id)) {
        durableTasks.push(durableTask);
      }
    }
    let tasks = [...durableTasks, ...snapshotTasks];

    if (selectedTab === 'attention') {
      tasks = tasks.filter((t) => attentionTaskIds.has(t.id));
    } else if (selectedTab === 'running') {
      tasks = tasks.filter((t) => t.status === ObservedExecutionStatus.Running);
    } else if (selectedTab === 'failed') {
      tasks = tasks.filter(
        (t) =>
          t.status === ObservedExecutionStatus.Failed ||
          t.status === ObservedExecutionStatus.Blocked ||
          attentionTaskIds.has(t.id),
      );
    } else if (selectedTab === 'completed') {
      tasks = tasks.filter(
        (t) => t.status === ObservedExecutionStatus.Completed,
      );
    }

    const query = search.trim().toLocaleLowerCase();
    if (query.length > 0) {
      tasks = tasks.filter(
        (task) =>
          task.id.toLocaleLowerCase().includes(query) ||
          task.kind.toLocaleLowerCase().includes(query) ||
          (task.kind_label &&
            task.kind_label.toLocaleLowerCase().includes(query)) ||
          task.status.toLocaleLowerCase().includes(query) ||
          (task.trigger && task.trigger.toLocaleLowerCase().includes(query)),
      );
    }

    return tasks.sort((left, right) => {
      if (sortBy === 'newest') {
        return right.updated_at - left.updated_at;
      }
      if (sortBy === 'oldest') {
        return left.updated_at - right.updated_at;
      }
      if (sortBy === 'attempts') {
        return right.attempt_count - left.attempt_count;
      }
      return 0;
    });
  });

  const groupedTasks = $derived.by(() => {
    if (!groupByKind) return [];
    const groups: Record<string, ObservedTask[]> = {};
    for (const task of filteredTasks) {
      const label = task.kind_label || task.kind || 'Other';
      if (!groups[label]) groups[label] = [];
      groups[label].push(task);
    }
    return Object.entries(groups);
  });
  const normalizedSearch = $derived(search.trim());
  const recentActivity = $derived(
    (snapshotState.kind === ObserverFeedKind.Loaded
      ? snapshotState.snapshot.tasks
      : []
    )
      .flatMap((task) =>
        task.activity.map((entry) => ({ entry, taskId: task.id })),
      )
      .sort((left, right) => right.entry.created_at - left.entry.created_at)
      .slice(0, 8),
  );

  function isSelectedTaskId(taskId: string): boolean {
    return (
      selectedIdState.kind === TaskSelectionKind.Selected &&
      selectedIdState.taskId === taskId
    );
  }

  $effect(() => {
    const controller = new AbortController();
    let pollSchedule: PollSchedule = { kind: PollScheduleKind.Stopped };

    const poll = async () => {
      await loadSnapshot({
        kind: SnapshotLoadRequestKind.ScheduledRefresh,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        pollSchedule = {
          kind: PollScheduleKind.Scheduled,
          timer: setTimeout(poll, 15_000),
        };
      }
    };
    void poll();

    return () => {
      controller.abort();
      if (pollSchedule.kind === PollScheduleKind.Scheduled)
        clearTimeout(pollSchedule.timer);
    };
  });

  $effect(() => {
    const timer = setInterval(() => {
      nowMs = Date.now();
    }, 30_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const taskId = search.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (taskId.length === 0) {
        durableMatchState = { kind: DurableTaskLookupKind.NotFound };
        return;
      }
      try {
        const locale = navigator.language || 'en';
        const response = await fetch(
          `/api/tasks/${encodeURIComponent(taskId)}?locale=${encodeURIComponent(locale)}`,
          { signal: controller.signal },
        );
        if (response.status === 404) {
          durableMatchState = { kind: DurableTaskLookupKind.NotFound };
          return;
        }
        if (!response.ok) return;
        const match = (await response.json()) as ObservedTask;
        durableMatchState = { kind: DurableTaskLookupKind.Found, task: match };
        if (!detailsClosed)
          selectedIdState = {
            kind: TaskSelectionKind.Selected,
            taskId: match.id,
          };
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          durableMatchState = { kind: DurableTaskLookupKind.NotFound };
        }
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  });

  $effect(() => {
    if (
      search.trim().length > 0 &&
      !detailsClosed &&
      !filteredTasks.some((task) => isSelectedTaskId(task.id))
    ) {
      const firstTask = filteredTasks[0];
      selectedIdState = firstTask
        ? { kind: TaskSelectionKind.Selected, taskId: firstTask.id }
        : { kind: TaskSelectionKind.None };
    }
  });

  async function loadSnapshot(request: SnapshotLoadRequest) {
    try {
      const locale = navigator.language || 'en';
      document.documentElement.lang = locale
        .toLocaleLowerCase()
        .startsWith('ru')
        ? 'ru'
        : 'en';
      const requestInit: RequestInit =
        request.kind === SnapshotLoadRequestKind.ScheduledRefresh
          ? { signal: request.signal }
          : {};
      const response = await fetch(
        `/api/overview?locale=${encodeURIComponent(locale)}`,
        requestInit,
      );
      if (!response.ok) throw new Error(`observer returned ${response.status}`);
      const next = (await response.json()) as ObserverSnapshot;
      snapshotState = { kind: ObserverFeedKind.Loaded, snapshot: next };
      unavailable = false;
      let selectedTaskStillAvailable = false;
      if (selectedIdState.kind === TaskSelectionKind.Selected) {
        const selectedTaskId = selectedIdState.taskId;
        selectedTaskStillAvailable =
          next.tasks.some((task) => task.id === selectedTaskId) ||
          (durableMatchState.kind === DurableTaskLookupKind.Found &&
            durableMatchState.task.id === selectedTaskId);
      }
      if (
        (!detailsClosed && selectedIdState.kind === TaskSelectionKind.None) ||
        !selectedTaskStillAvailable
      ) {
        if (!detailsClosed) {
          const firstTask = next.tasks[0];
          selectedIdState = firstTask
            ? { kind: TaskSelectionKind.Selected, taskId: firstTask.id }
            : { kind: TaskSelectionKind.None };
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      unavailable = true;
    } finally {
      loading = false;
    }
  }

  function isAgentHealthy(agent: ObservedAgent) {
    return !unavailable && Date.now() - agent.last_seen_at < 2 * 60_000;
  }

  function statusLabel(status: string) {
    const labels: Record<string, string> = {
      [ObservedExecutionStatus.Blocked]: copy.blocked,
      [ObservedExecutionStatus.Cancelled]: copy.cancelled,
      [ObservedExecutionStatus.Cancelling]: copy.cancelling,
      [ObservedExecutionStatus.Completed]: copy.completed,
      [ObservedExecutionStatus.Failed]: copy.failed,
      [ObservedExecutionStatus.Idle]: copy.idle,
      [ObservedExecutionStatus.Ready]: copy.ready,
      [ObservedExecutionStatus.Running]: copy.running,
    };
    return labels[status] ?? status;
  }

  function isAttentionStatus(status: string): boolean {
    return (
      status === ObservedExecutionStatus.Blocked ||
      status === ObservedExecutionStatus.Failed ||
      status === ObservedExecutionStatus.Cancelling
    );
  }

  function relativeTime(timestamp: number) {
    if (timestamp <= 0) return '—';
    const seconds = Math.round((timestamp - nowMs) / 1000);
    const formatter = new Intl.RelativeTimeFormat([], {
      numeric: 'auto',
    });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    return formatter.format(Math.round(hours / 24), 'day');
  }

  function compactId(value: string, length = 18) {
    if (value.length <= length) return value;
    const edge = Math.floor((length - 1) / 2);
    return `${value.slice(0, edge)}…${value.slice(-edge)}`;
  }

  function selectTask(taskId: string) {
    detailsClosed = false;
    selectedIdState = { kind: TaskSelectionKind.Selected, taskId };
    if (!window.matchMedia('(width < 1080px)').matches) return;
    requestAnimationFrame(() => {
      if (detailPanel.kind === DetailPanelMountKind.Unmounted) return;
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches
        ? 'auto'
        : 'smooth';
      detailPanel.element.scrollIntoView({ behavior, block: 'start' });
      detailPanel.element.focus({ preventScroll: true });
    });
  }

  function captureDetailPanel(element: HTMLElement) {
    detailPanel = { kind: DetailPanelMountKind.Mounted, element };
    return {
      destroy() {
        detailPanel = { kind: DetailPanelMountKind.Unmounted };
      },
    };
  }

  function closeDetails() {
    detailsClosed = true;
    selectedIdState = { kind: TaskSelectionKind.None };
  }
</script>

<svelte:head>
  <title>{copy.product_name}</title>
</svelte:head>

{#if loading}
  <main class="loading-shell" aria-busy="true">
    <div class="skeleton skeleton-brand"></div>
    <div class="loading-grid">
      <div class="skeleton loading-rail"></div>
      <div class="loading-list">
        {#each Array(7) as _, index (index)}
          <div class="skeleton loading-row"></div>
        {/each}
      </div>
      <div class="skeleton loading-detail"></div>
    </div>
  </main>
{:else if unavailable && snapshotState.kind === ObserverFeedKind.NotLoaded}
  <main class="unavailable-shell">
    <div class="unavailable-mark"><Hexagon size={28} strokeWidth={1.6} /></div>
    <h1>{copy.unavailable}</h1>
    <p>{copy.unavailable_description}</p>
    <button
      class="primary-button"
      onclick={() =>
        void loadSnapshot({ kind: SnapshotLoadRequestKind.ManualRetry })}
    >
      {copy.retry_connection}
    </button>
  </main>
{:else}
  <main class="control-center">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <Hexagon size={18} strokeWidth={1.8} />
        </div>
        <div>
          <h1>{copy.product_name}</h1>
          <p>{copy.product_description}</p>
        </div>
      </div>
      <div class:connection-stale={unavailable} class="connection-state">
        <span></span>
        {unavailable ? copy.stale : copy.healthy}
      </div>
    </header>

    <section class="pulse-bar" aria-label={copy.overview}>
      <div class="pulse-summary">
        <strong
          >{snapshotState.kind === ObserverFeedKind.Loaded
            ? snapshotState.snapshot.active_task_count
            : 0}</strong
        >
        <span>{copy.queue.toLocaleLowerCase()}</span>
      </div>
      <div class="worker-capacity" aria-label={copy.workers}>
        {#each snapshotState.kind === ObserverFeedKind.Loaded ? snapshotState.snapshot.agents : [] as agent (agent.id)}
          <span
            class:worker-running={agent.status ===
              ObservedExecutionStatus.Running}
            class:worker-stale={!isAgentHealthy(agent)}
            title={`${agent.pod_name}: ${statusLabel(agent.status)}`}
          ></span>
        {/each}
      </div>
      <div
        class:has-attention={attentionEntries.length > 0}
        class="attention-summary"
        aria-live="polite"
      >
        <AlertTriangle size={16} />
        <strong
          >{attentionEntries.length}{snapshotState.kind ===
            ObserverFeedKind.Loaded && snapshotState.snapshot.alerts_truncated
            ? '+'
            : ''}</strong
        >
        <span>{copy.needs_attention.toLocaleLowerCase()}</span>
      </div>
    </section>

    <div class="workspace">
      <aside class="worker-rail" aria-labelledby="workers-heading">
        <div class="section-heading">
          <h2 id="workers-heading">{copy.workers}</h2>
          <span
            >{snapshotState.kind === ObserverFeedKind.Loaded
              ? snapshotState.snapshot.agents.length
              : 0}</span
          >
        </div>
        <div class="worker-list">
          {#each snapshotState.kind === ObserverFeedKind.Loaded ? snapshotState.snapshot.agents : [] as agent (agent.id)}
            <div class="worker-row">
              <div
                class:state-running={agent.status ===
                  ObservedExecutionStatus.Running}
                class:state-stale={!isAgentHealthy(agent)}
                class="worker-state"
              >
                <Server size={16} />
              </div>
              <div class="worker-copy">
                <strong>{compactId(agent.pod_name || agent.id, 17)}</strong>
                <span>
                  {isAgentHealthy(agent)
                    ? statusLabel(agent.status)
                    : copy.stale}
                  · {relativeTime(agent.last_seen_at)}
                </span>
              </div>
            </div>
          {/each}
        </div>

        <div class="activity-digest">
          <div class="section-heading">
            <h2>{copy.recent_activity}</h2>
          </div>
          {#each recentActivity as item (item.entry.id)}
            <button class="digest-row" onclick={() => selectTask(item.taskId)}>
              <Activity size={14} />
              <div class="digest-info">
                <span class="digest-msg">{item.entry.message}</span>
                <code class="digest-task-id">{compactId(item.taskId, 18)}</code>
              </div>
              <time>{relativeTime(item.entry.created_at)}</time>
            </button>
          {/each}
        </div>
      </aside>

      <section class="queue-panel" aria-labelledby="queue-heading">
        <div class="queue-toolbar">
          <div class="section-heading">
            <h2 id="queue-heading">{copy.all_tasks}</h2>
            <span>{filteredTasks.length}</span>
          </div>

          <div class="toolbar-controls">
            <label class="search-field">
              <Search size={16} />
              <span class="sr-only">{copy.search_tasks}</span>
              <input bind:value={search} placeholder={copy.search_tasks} />
            </label>

            <div class="control-group">
              <label class="sort-control" title="Sort order">
                <ArrowUpDown size={14} />
                <select bind:value={sortBy} class="sort-select">
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="attempts">Attempts</option>
                </select>
              </label>

              <button
                class:active={groupByKind}
                class="group-toggle"
                onclick={() => (groupByKind = !groupByKind)}
                title="Group by category"
              >
                <Layers size={14} />
                <span>Group</span>
              </button>
            </div>
          </div>
        </div>

        <nav class="filter-tabs" aria-label="Task status filters">
          <button
            class:active={selectedTab === 'all'}
            class="tab-button"
            onclick={() => (selectedTab = 'all')}
          >
            <span>{copy.all_tasks}</span>
            <span class="tab-badge">{statusCounts.all}</span>
          </button>

          <button
            class:active={selectedTab === 'attention'}
            class:has-count={statusCounts.attention > 0}
            class="tab-button tab-attention"
            onclick={() => (selectedTab = 'attention')}
          >
            <AlertTriangle size={13} />
            <span>Attention</span>
            <span class="tab-badge badge-attention"
              >{statusCounts.attention}</span
            >
          </button>

          <button
            class:active={selectedTab === 'running'}
            class="tab-button"
            onclick={() => (selectedTab = 'running')}
          >
            <span>{copy.running}</span>
            <span class="tab-badge">{statusCounts.running}</span>
          </button>

          <button
            class:active={selectedTab === 'failed'}
            class="tab-button"
            onclick={() => (selectedTab = 'failed')}
          >
            <span>{copy.failed}</span>
            <span class="tab-badge">{statusCounts.failed}</span>
          </button>

          <button
            class:active={selectedTab === 'completed'}
            class="tab-button"
            onclick={() => (selectedTab = 'completed')}
          >
            <span>{copy.completed}</span>
            <span class="tab-badge">{statusCounts.completed}</span>
          </button>
        </nav>

        {#if selectedTab === 'all' && attentionEntries.length > 0 && normalizedSearch.length === 0}
          <div class="attention-lane">
            <div class="attention-heading">
              <AlertTriangle size={15} />
              <span>{copy.needs_attention}</span>
            </div>
            {#each attentionEntries as entry (entry.alert.id)}
              {@render AlertRow(
                entry.alert,
                entry.task,
                isSelectedTaskId(entry.task.id),
                copy,
                relativeTime,
                () => selectTask(entry.task.id),
              )}
            {/each}
          </div>
        {/if}

        <div class="task-list">
          {#if groupByKind && groupedTasks.length > 0}
            {#each groupedTasks as [groupLabel, groupItems] (groupLabel)}
              <div class="group-section">
                <div class="group-header">
                  <strong>{groupLabel}</strong>
                  <span class="group-count">{groupItems.length}</span>
                </div>
                <div class="group-items">
                  {#each groupItems as task (task.id)}
                    {@render TaskRow(
                      task,
                      isSelectedTaskId(task.id),
                      copy,
                      statusLabel,
                      relativeTime,
                      () => selectTask(task.id),
                    )}
                  {/each}
                </div>
              </div>
            {/each}
          {:else}
            {#each filteredTasks.filter((task) => selectedTab !== 'all' || normalizedSearch.length > 0 || !attentionTaskIds.has(task.id)) as task (task.id)}
              {@render TaskRow(
                task,
                isSelectedTaskId(task.id),
                copy,
                statusLabel,
                relativeTime,
                () => selectTask(task.id),
              )}
            {:else}
              {#if attentionEntries.length === 0 || normalizedSearch.length > 0 || selectedTab !== 'all'}
                <div class="empty-state">
                  <CircleDashed size={24} />
                  <strong>
                    {normalizedSearch.length > 0
                      ? copy.no_search_results
                      : copy.no_tasks}
                  </strong>
                  <p>
                    {normalizedSearch.length > 0
                      ? copy.no_search_results_description
                      : copy.no_tasks_description}
                  </p>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
      </section>

      <aside
        use:captureDetailPanel
        class:detail-open={selectedState.kind === SelectedTaskKind.Open}
        class="detail-panel"
        aria-live="polite"
        tabindex="-1"
      >
        {#if selectedState.kind === SelectedTaskKind.Open}
          {@const selected = selectedState.task}
          <div class="detail-header">
            <div>
              <span class="detail-kicker">{copy.task_details}</span>
              <h2>{selected.kind_label}</h2>
              <code>{selected.id}</code>
            </div>
            <button
              class="icon-button"
              aria-label={copy.close_details}
              onclick={closeDetails}
            >
              <X size={18} />
            </button>
          </div>

          <div class="detail-status">
            {@render StatusMark(selected.status)}
            <div>
              <strong>{statusLabel(selected.status)}</strong>
              <span>{copy.updated} {relativeTime(selected.updated_at)}</span>
            </div>
          </div>

          <dl class="facts">
            <div>
              <dt>{copy.trigger}</dt>
              <dd>
                <span>{selected.trigger}</span>
                <time>{relativeTime(selected.created_at)}</time>
              </dd>
            </div>
            <div>
              <dt>{copy.current_attempt}</dt>
              <dd>{selected.attempt_count} / {selected.max_attempts}</dd>
            </div>
            <div class="wide-fact">
              <dt>{copy.source_revision}</dt>
              <dd>
                <GitCommitHorizontal size={14} />
                <code>{selected.source_commit.slice(0, 12)}</code>
              </dd>
            </div>
          </dl>

          {#if selected.latest_error}
            <div class="error-callout">
              <AlertTriangle size={16} />
              <p>{selected.latest_error}</p>
            </div>
          {:else if selected.latest_summary}
            <p class="task-summary">{selected.latest_summary}</p>
          {/if}

          <section class="detail-section">
            <div class="section-heading">
              <h3>{copy.dependencies}</h3>
              <span>{selected.dependencies.length}</span>
            </div>
            {#if selected.dependencies.length > 0}
              <div class="dependency-list">
                {#each selected.dependencies as dependency (dependency.id)}
                  <div class="dependency-row">
                    {@render StatusMark(dependency.status, true)}
                    <code>{compactId(dependency.id, 34)}</code>
                    <span>{statusLabel(dependency.status)}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="quiet-empty">{copy.no_dependencies}</p>
            {/if}
          </section>

          <section class="detail-section timeline-section">
            <div class="section-heading">
              <h3>{copy.timeline}</h3>
              <span>{selected.activity.length}</span>
            </div>
            {#if selected.activity.length > 0}
              <ol class="timeline">
                {#each selected.activity as entry (entry.id)}
                  {@render TimelineEntry(entry, copy, relativeTime)}
                {/each}
              </ol>
            {:else}
              <p class="quiet-empty">{copy.no_activity}</p>
            {/if}
          </section>
        {:else}
          <div class="detail-placeholder">
            <Activity size={24} />
            <span>{copy.task_details}</span>
          </div>
        {/if}
      </aside>
    </div>
  </main>
{/if}

{#snippet TaskRow(
  task: ObservedTask,
  active: boolean,
  copy: ObserverCopy,
  statusLabel: (status: string) => string,
  relativeTime: (timestamp: number) => string,
  onselect: () => void,
)}
  <button class:active class="task-row" onclick={onselect}>
    {@render StatusMark(task.status)}
    <div class="task-copy">
      <div class="task-title">
        <strong>{task.kind_label}</strong>
        <span class={`status-text status-${task.status.toLocaleLowerCase()}`}>
          {statusLabel(task.status)}
        </span>
      </div>
      <code>{task.id}</code>
    </div>
    <div class="task-meta">
      <span>{copy.attempt} {task.attempt_count}/{task.max_attempts}</span>
      <time>{relativeTime(task.updated_at)}</time>
    </div>
  </button>
{/snippet}

{#snippet AlertRow(
  alert: ObservedAlert,
  task: ObservedTask,
  active: boolean,
  copy: ObserverCopy,
  relativeTime: (timestamp: number) => string,
  onselect: () => void,
)}
  {@const observedAge = relativeTime(alert.first_observed_at)}
  <button
    class:active
    class:critical={alert.severity === ObservedAlertSeverity.Critical}
    class="alert-row"
    aria-label={`${task.kind_label} ${alert.severity === ObservedAlertSeverity.Critical ? copy.critical : copy.warning} ${alert.reason} ${observedAge} ${task.id}`}
    onclick={onselect}
  >
    <span class="alert-mark" aria-hidden="true"
      ><AlertTriangle size={15} /></span
    >
    <div class="alert-copy">
      <div>
        <strong>{task.kind_label}</strong>
        <span
          >{alert.severity === ObservedAlertSeverity.Critical
            ? copy.critical
            : copy.warning}</span
        >
      </div>
      <p>{alert.reason}</p>
      <div class="alert-evidence">
        <time>{observedAge}</time>
        <code title={task.id}>{compactId(task.id, 32)}</code>
      </div>
    </div>
  </button>
{/snippet}

{#snippet StatusMark(status: string, compact = false)}
  <span
    class:compact
    class={`status-mark status-mark-${status.toLocaleLowerCase()}`}
    aria-hidden="true"
  >
    {#if status === ObservedExecutionStatus.Completed}
      <CheckCircle2 size={compact ? 13 : 16} />
    {:else if isAttentionStatus(status)}
      <AlertTriangle size={compact ? 13 : 16} />
    {:else if status === ObservedExecutionStatus.Running}
      <Activity size={compact ? 13 : 16} />
    {:else}
      <Clock3 size={compact ? 13 : 16} />
    {/if}
  </span>
{/snippet}

{#snippet TimelineEntry(
  entry: ObservedActivity,
  copy: ObserverCopy,
  relativeTime: (timestamp: number) => string,
)}
  <li class={`timeline-${entry.kind}`}>
    <span class="timeline-mark"></span>
    <div>
      <div class="timeline-title">
        <strong>{entry.message}</strong>
        <time>{relativeTime(entry.created_at)}</time>
      </div>
      {#if entry.attempt_number > 0}
        <span>{copy.attempt} {entry.attempt_number}</span>
      {/if}
      {#if entry.detail}
        <code>{entry.detail}</code>
      {/if}
    </div>
  </li>
{/snippet}

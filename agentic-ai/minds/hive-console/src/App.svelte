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
    CheckCircle2,
    CircleDashed,
    Clock3,
    GitCommitHorizontal,
    Hexagon,
    Search,
    Server,
    X,
  } from '@lucide/svelte';
  import type {
    ObservedActivity,
    ObservedAgent,
    ObservedTask,
    ObserverCopy,
    ObserverSnapshot,
  } from './types';

  let snapshot = $state<ObserverSnapshot | undefined>(undefined);
  let selectedId = $state<string | undefined>(undefined);
  let search = $state('');
  let loading = $state(true);
  let unavailable = $state(false);
  let detailPanel = $state<HTMLElement | undefined>(undefined);

  const copy = $derived(snapshot?.copy ?? emergencyCopy());
  const selected = $derived(
    snapshot?.tasks.find((task) => task.id === selectedId),
  );
  const filteredTasks = $derived(
    (snapshot?.tasks ?? []).filter((task) => {
      const query = search.trim().toLocaleLowerCase();
      return (
        query.length === 0 ||
        task.id.toLocaleLowerCase().includes(query) ||
        task.kind.toLocaleLowerCase().includes(query) ||
        task.status.toLocaleLowerCase().includes(query)
      );
    }),
  );
  const attentionTasks = $derived(
    (snapshot?.tasks ?? []).filter((task) => needsAttention(task)),
  );
  const activeTasks = $derived(
    (snapshot?.tasks ?? []).filter((task) =>
      ['RUNNING', 'READY', 'BLOCKED', 'CANCELLING'].includes(task.status),
    ),
  );
  const recentActivity = $derived(
    (snapshot?.tasks ?? [])
      .flatMap((task) =>
        task.activity.map((entry) => ({ entry, taskId: task.id })),
      )
      .sort((left, right) => right.entry.created_at - left.entry.created_at)
      .slice(0, 8),
  );

  $effect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;

    void loadSnapshot(controller.signal).then(() => {
      timer = setInterval(() => void loadSnapshot(controller.signal), 15_000);
    });

    return () => {
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
    };
  });

  $effect(() => {
    if (
      search.trim().length > 0 &&
      !filteredTasks.some((task) => task.id === selectedId)
    ) {
      selectedId = filteredTasks[0]?.id;
    }
  });

  async function loadSnapshot(signal: AbortSignal | undefined = undefined) {
    try {
      const locale = navigator.language || 'en';
      const response = await fetch(
        `/api/overview?locale=${encodeURIComponent(locale)}`,
        { signal },
      );
      if (!response.ok) throw new Error(`observer returned ${response.status}`);
      const next = (await response.json()) as ObserverSnapshot;
      snapshot = next;
      unavailable = false;
      if (
        selectedId === undefined ||
        !next.tasks.some((task) => task.id === selectedId)
      ) {
        selectedId = next.tasks[0]?.id;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      unavailable = true;
    } finally {
      loading = false;
    }
  }

  function needsAttention(task: ObservedTask) {
    return (
      ['BLOCKED', 'FAILED', 'CANCELLING'].includes(task.status) ||
      (task.status === 'RUNNING' &&
        (snapshot?.generated_at ?? Date.now()) - task.updated_at > 5 * 60_000)
    );
  }

  function isAgentHealthy(agent: ObservedAgent) {
    return (
      (snapshot?.generated_at ?? Date.now()) - agent.last_seen_at < 2 * 60_000
    );
  }

  function statusLabel(status: string) {
    const labels: Record<string, string> = {
      BLOCKED: copy.blocked,
      CANCELLED: copy.cancelled,
      CANCELLING: copy.cancelling,
      COMPLETED: copy.completed,
      FAILED: copy.failed,
      IDLE: copy.idle,
      READY: copy.ready,
      RUNNING: copy.running,
    };
    return labels[status] ?? status;
  }

  function relativeTime(timestamp: number) {
    if (timestamp <= 0) return '—';
    const seconds = Math.round((timestamp - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, {
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
    selectedId = taskId;
    if (!window.matchMedia('(width < 1080px)').matches) return;
    requestAnimationFrame(() => {
      detailPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      detailPanel?.focus({ preventScroll: true });
    });
  }

  function taskKindLabel(kind: string) {
    return kind.replace(/-/g, ' ');
  }

  function emergencyCopy(): ObserverCopy {
    const russian = navigator.language.toLocaleLowerCase().startsWith('ru');
    const unavailableCopy = russian
      ? {
          name: 'Центр управления Hive',
          unavailable: 'Hive сейчас недоступен',
          description: 'Не удалось получить состояние наблюдателя.',
          retry: 'Повторить',
        }
      : {
          name: 'Hive Control Center',
          unavailable: 'Hive is unavailable',
          description: 'The observer state could not be loaded.',
          retry: 'Try again',
        };
    return {
      product_name: unavailableCopy.name,
      product_description: '',
      overview: '',
      workers: '',
      queue: '',
      needs_attention: '',
      recent_activity: '',
      all_tasks: '',
      search_tasks: '',
      no_tasks: '',
      no_tasks_description: '',
      no_attention: '',
      no_attention_description: '',
      task_details: '',
      trigger: '',
      source_revision: '',
      current_attempt: '',
      dependencies: '',
      timeline: '',
      no_activity: '',
      no_dependencies: '',
      attempt: '',
      last_seen: '',
      updated: '',
      stale: '',
      healthy: '',
      idle: '',
      running: '',
      ready: '',
      blocked: '',
      failed: '',
      cancelling: '',
      cancelled: '',
      completed: '',
      unavailable: unavailableCopy.unavailable,
      unavailable_description: unavailableCopy.description,
      retry_connection: unavailableCopy.retry,
      close_details: '',
    };
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
{:else if unavailable && snapshot === undefined}
  <main class="unavailable-shell">
    <div class="unavailable-mark"><Hexagon size={28} strokeWidth={1.6} /></div>
    <h1>{copy.unavailable}</h1>
    <p>{copy.unavailable_description}</p>
    <button class="primary-button" onclick={() => void loadSnapshot()}>
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
        <strong>{activeTasks.length}</strong>
        <span>{copy.queue.toLocaleLowerCase()}</span>
      </div>
      <div class="worker-capacity" aria-label={copy.workers}>
        {#each snapshot?.agents ?? [] as agent (agent.id)}
          <span
            class:worker-running={agent.status === 'RUNNING'}
            class:worker-stale={!isAgentHealthy(agent)}
            title={`${agent.pod_name}: ${statusLabel(agent.status)}`}
          ></span>
        {/each}
      </div>
      <div
        class:has-attention={attentionTasks.length > 0}
        class="attention-summary"
      >
        <AlertTriangle size={16} />
        <strong>{attentionTasks.length}</strong>
        <span>{copy.needs_attention.toLocaleLowerCase()}</span>
      </div>
    </section>

    <div class="workspace">
      <aside class="worker-rail" aria-labelledby="workers-heading">
        <div class="section-heading">
          <h2 id="workers-heading">{copy.workers}</h2>
          <span>{snapshot?.agents.length ?? 0}</span>
        </div>
        <div class="worker-list">
          {#each snapshot?.agents ?? [] as agent (agent.id)}
            <div class="worker-row">
              <div
                class:state-running={agent.status === 'RUNNING'}
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
              <span>{item.entry.message}</span>
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
          <label class="search-field">
            <Search size={16} />
            <span class="sr-only">{copy.search_tasks}</span>
            <input bind:value={search} placeholder={copy.search_tasks} />
          </label>
        </div>

        {#if attentionTasks.length > 0 && search.length === 0}
          <div class="attention-lane">
            <div class="attention-heading">
              <AlertTriangle size={15} />
              <span>{copy.needs_attention}</span>
            </div>
            {#each attentionTasks as task (task.id)}
              {@render TaskRow(
                task,
                selectedId === task.id,
                copy,
                statusLabel,
                relativeTime,
                () => selectTask(task.id),
              )}
            {/each}
          </div>
        {/if}

        <div class="task-list">
          {#each filteredTasks.filter((task) => search.length > 0 || !needsAttention(task)) as task (task.id)}
            {@render TaskRow(
              task,
              selectedId === task.id,
              copy,
              statusLabel,
              relativeTime,
              () => selectTask(task.id),
            )}
          {:else}
            <div class="empty-state">
              <CircleDashed size={24} />
              <strong>{copy.no_tasks}</strong>
              <p>{copy.no_tasks_description}</p>
            </div>
          {/each}
        </div>
      </section>

      <aside
        bind:this={detailPanel}
        class:detail-open={selected !== undefined}
        class="detail-panel"
        aria-live="polite"
        tabindex="-1"
      >
        {#if selected}
          <div class="detail-header">
            <div>
              <span class="detail-kicker">{copy.task_details}</span>
              <h2>{taskKindLabel(selected.kind)}</h2>
              <code>{selected.id}</code>
            </div>
            <button
              class="icon-button"
              aria-label={copy.close_details}
              onclick={() => (selectedId = undefined)}
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
                  {@render TimelineEntry(entry, relativeTime)}
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
        <strong>{taskKindLabel(task.kind)}</strong>
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

{#snippet StatusMark(status: string, compact = false)}
  <span
    class:compact
    class={`status-mark status-mark-${status.toLocaleLowerCase()}`}
    aria-hidden="true"
  >
    {#if status === 'COMPLETED'}
      <CheckCircle2 size={compact ? 13 : 16} />
    {:else if ['BLOCKED', 'FAILED', 'CANCELLING'].includes(status)}
      <AlertTriangle size={compact ? 13 : 16} />
    {:else if status === 'RUNNING'}
      <Activity size={compact ? 13 : 16} />
    {:else}
      <Clock3 size={compact ? 13 : 16} />
    {/if}
  </span>
{/snippet}

{#snippet TimelineEntry(
  entry: ObservedActivity,
  relativeTime: (timestamp: number) => string,
)}
  <li class={`timeline-${entry.kind}`}>
    <span class="timeline-mark"></span>
    <div>
      <div class="timeline-title">
        <strong>{entry.message}</strong>
        <time>{relativeTime(entry.created_at)}</time>
      </div>
      {#if entry.detail}
        <code>{entry.detail}</code>
      {/if}
    </div>
  </li>
{/snippet}

<script lang="ts">
  import {
    Fingerprint,
    ShieldCheck,
    ShieldQuestion,
    Vault,
  } from '@lucide/svelte'
  import type { NodeProps } from '@xyflow/svelte'
  import {
    IdentityBridgeNodeKind,
    type IdentityBridgeNode,
  } from './identity-bridge-model'

  let { data }: NodeProps<IdentityBridgeNode> = $props()
</script>

{#if data.kind === IdentityBridgeNodeKind.Identity}
  <article
    class="bridge-card identity-card"
    data-testid="devices-access-identity-card"
    aria-label={`${data.caption}: ${data.label}. ${data.description}`}
  >
    <header>
      <span class="node-icon identity-icon"
        ><Fingerprint class="size-5" aria-hidden="true" /></span
      >
      <span class="node-heading">
        <small>{data.caption}</small>
        <strong>{data.label}</strong>
      </span>
    </header>
    <p>{data.description}</p>
  </article>
{:else if data.kind === IdentityBridgeNodeKind.Stage}
  <div class="stage" role="heading" aria-level="2">
    <span>{data.label}</span>
  </div>
{:else if data.kind === IdentityBridgeNodeKind.Empty}
  <article class="empty-card" aria-label={data.label}>
    <ShieldQuestion class="size-5" aria-hidden="true" />
    <span><strong>{data.label}</strong><small>{data.description}</small></span>
  </article>
{:else}
  <article
    class:authorized={data.verifiedLocalAccess}
    class="bridge-card vault-card"
    aria-label={`${data.caption}: ${data.label}. ${data.statusLabel}`}
    data-testid="devices-access-strength-vaults"
  >
    <header>
      <span class="node-icon"><Vault class="size-5" aria-hidden="true" /></span>
      <span class="node-heading">
        <small>{data.caption}</small>
        <strong>{data.label}</strong>
      </span>
      <span class="state">
        {#if data.verifiedLocalAccess}<ShieldCheck
            class="size-3.5"
            aria-hidden="true"
          />{/if}
        {data.statusLabel}
      </span>
    </header>
    <p>{data.description}</p>
    <dl>
      <div>
        <dt>{data.statusMetricLabel}</dt>
        <dd>{data.statusLabel}</dd>
      </div>
      <div>
        <dt>{data.evidenceMetricLabel}</dt>
        <dd>{data.evidenceLabel}</dd>
      </div>
    </dl>
  </article>
{/if}

<style>
  .bridge-card,
  .empty-card {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid color-mix(in oklab, var(--foreground) 18%, transparent);
    border-radius: var(--radius);
    background: linear-gradient(
      145deg,
      var(--card),
      color-mix(in oklab, var(--muted) 38%, transparent)
    );
    color: var(--foreground);
    box-shadow: 0 0.8rem 2.2rem
      color-mix(in oklab, var(--foreground) 9%, transparent);
  }
  .bridge-card header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem;
  }
  .vault-card .state {
    grid-column: 2;
  }
  .node-icon {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in oklab, var(--muted) 55%, transparent);
    color: var(--muted-foreground);
  }
  .identity-icon {
    color: var(--foreground);
  }
  .node-heading {
    min-width: 0;
  }
  .node-heading small,
  .node-heading strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .node-heading small,
  .state {
    color: var(--muted-foreground);
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.625rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .node-heading strong {
    margin-top: 0.2rem;
    font-size: 1rem;
    font-weight: 550;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    letter-spacing: 0.06em;
  }
  .authorized .state {
    color: var(--primary);
  }
  .identity-card,
  .vault-card {
    padding-bottom: 0.9rem;
  }
  .identity-card,
  .authorized {
    border-color: color-mix(in oklab, var(--primary) 48%, transparent);
    box-shadow: 0 0.8rem 2.4rem
      color-mix(in oklab, var(--primary) 8%, transparent);
  }
  .bridge-card > p {
    margin: -0.15rem 0.9rem 0;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    line-height: 1.45;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.7rem;
    margin: 0.85rem 0.9rem 0;
    padding-top: 0.7rem;
    border-top: 1px solid var(--border);
  }
  dl div {
    min-width: 0;
  }
  dt {
    color: var(--muted-foreground);
    font-family: ui-monospace, monospace;
    font-size: 0.5625rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  dd {
    overflow: hidden;
    margin: 0.25rem 0 0;
    font-size: 0.6875rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stage {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--muted-foreground);
    font-family: ui-monospace, monospace;
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .stage::before,
  .stage::after {
    height: 1px;
    flex: 1;
    background: var(--border);
    content: '';
  }
  .stage span {
    white-space: nowrap;
  }
  .empty-card {
    display: flex;
    min-height: 8rem;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-style: dashed;
    color: var(--muted-foreground);
  }
  .empty-card span,
  .empty-card strong,
  .empty-card small {
    display: block;
  }
  .empty-card strong {
    color: var(--foreground);
    font-size: 0.875rem;
  }
  .empty-card small {
    margin-top: 0.25rem;
    font-size: 0.6875rem;
    line-height: 1.45;
  }
  @media (width < 48rem) {
    dl {
      grid-template-columns: 1fr;
    }
  }
</style>

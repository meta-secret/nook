<script lang="ts">
  import {
    Fingerprint,
    KeyRound,
    Laptop,
    LockKeyhole,
    MonitorSmartphone,
    ShieldCheck,
    ShieldQuestion,
    Vault,
  } from '@lucide/svelte'
  import { Handle, Position, type NodeProps } from '@xyflow/svelte'
  import { DeviceAccessIdentityState } from '$app-wasm'
  import {
    IdentityBridgeFlow,
    IdentityBridgeDeviceIconKind,
    IdentityBridgeHandleType,
    IdentityBridgeHandleId,
    IdentityBridgeNodeKind,
    IdentityBridgePortMode,
    type IdentityBridgeNode,
  } from './identity-bridge-model'

  let { data }: NodeProps<IdentityBridgeNode> = $props()
</script>

{#if data.portMode === IdentityBridgePortMode.Target || data.portMode === IdentityBridgePortMode.Both}
  {#if data.kind === IdentityBridgeNodeKind.Vault && data.lateralAccessPort}
    <Handle
      class="bridge-handle"
      type={IdentityBridgeHandleType.Target}
      id={IdentityBridgeHandleId.VaultAccess}
      position={Position.Right}
    />
  {:else}
    <Handle
      class="bridge-handle"
      type={IdentityBridgeHandleType.Target}
      position={data.flow === IdentityBridgeFlow.Vertical
        ? Position.Top
        : Position.Left}
    />
  {/if}
{/if}

{#if data.kind === IdentityBridgeNodeKind.Device &&
data.lateralAccessPort &&
(data.portMode === IdentityBridgePortMode.Source || data.portMode === IdentityBridgePortMode.Both)}
  <Handle
    class="bridge-handle"
    type={IdentityBridgeHandleType.Source}
    id={IdentityBridgeHandleId.VaultAccess}
    position={Position.Right}
  />
{/if}

{#if data.kind === IdentityBridgeNodeKind.Device}
  <article
    class="bridge-card device-card"
    aria-label={`${data.caption}: ${data.label}${data.incomingRelation ? `. ${data.incomingRelation}` : ''}`}
  >
    <header>
      <span class="node-icon">
        {#if data.iconKind === IdentityBridgeDeviceIconKind.PairedDevice}
          <MonitorSmartphone class="size-5" aria-hidden="true" />
        {:else}
          <Laptop class="size-5" aria-hidden="true" />
        {/if}
      </span>
      <span class="node-heading">
        <small>{data.caption}</small>
        <strong>{data.label}</strong>
      </span>
      <code>{data.countLabel}</code>
    </header>
    <div class="rows">
      {#each data.installations as installation (installation.id)}
        <div class="row">
          <span class="key-icon"
            ><KeyRound class="size-4" aria-hidden="true" /></span
          >
          <span class="row-copy">
            <strong>{installation.label}</strong>
            <small>{installation.detail}</small>
          </span>
          <code title={installation.id}>{installation.id}</code>
        </div>
      {/each}
    </div>
  </article>
{:else if data.kind === IdentityBridgeNodeKind.Identity}
  <article
    class:identity-unlocked={data.identityStatus ===
      DeviceAccessIdentityState.Unlocked}
    class:identity-locked={data.identityStatus ===
      DeviceAccessIdentityState.Locked}
    class="bridge-card identity-card"
    data-testid="devices-access-identity-card"
    data-identity-state={DeviceAccessIdentityState[data.identityStatus]}
    aria-label={`${data.caption}: ${data.label}${data.incomingRelation ? `. ${data.incomingRelation}` : ''}`}
  >
    <header>
      <span class="node-icon identity-icon"
        ><Fingerprint class="size-5" aria-hidden="true" /></span
      >
      <span class="node-heading">
        <small>{data.caption}</small>
        <strong>{data.label}</strong>
      </span>
      <span class="state" data-testid="devices-access-identity-state"
        >{#if data.identityStatus === DeviceAccessIdentityState.Unlocked}
          <ShieldCheck class="size-3.5" aria-hidden="true" />
        {:else if data.identityStatus === DeviceAccessIdentityState.Locked}
          <LockKeyhole class="size-3.5" aria-hidden="true" />
        {:else}
          <ShieldQuestion class="size-3.5" aria-hidden="true" />
        {/if}{data.stateLabel}</span
      >
    </header>
    <p>{data.description}</p>
    <dl>
      <div>
        <dt>{data.deviceMetricLabel}</dt>
        <dd>{data.deviceMetricValue}</dd>
      </div>
      <div>
        <dt>{data.vaultMetricLabel}</dt>
        <dd>{data.vaultMetricValue}</dd>
      </div>
    </dl>
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
    class:authorized={data.verifiedDeviceAccess}
    class="bridge-card vault-card"
    aria-label={`${data.caption}: ${data.label}. ${data.statusLabel}${data.incomingRelation ? `. ${data.incomingRelation}` : ''}`}
    data-testid="devices-access-strength-vaults"
  >
    <header>
      <span class="node-icon"><Vault class="size-5" aria-hidden="true" /></span>
      <span class="node-heading">
        <small>{data.caption}</small>
        <strong>{data.label}</strong>
      </span>
      <span class="state">
        {#if data.verifiedDeviceAccess}<ShieldCheck
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

{#if data.portMode === IdentityBridgePortMode.Source || data.portMode === IdentityBridgePortMode.Both}
  <Handle
    class="bridge-handle"
    type={IdentityBridgeHandleType.Source}
    position={data.flow === IdentityBridgeFlow.Horizontal
      ? Position.Right
      : Position.Bottom}
  />
{/if}

<style>
  .bridge-card,
  .empty-card {
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
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem;
  }
  .identity-card header,
  .vault-card header {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .identity-card .state,
  .vault-card .state {
    grid-column: 2;
  }
  .node-icon,
  .key-icon {
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in oklab, var(--muted) 55%, transparent);
    color: var(--muted-foreground);
  }
  .node-icon {
    width: 2.5rem;
    height: 2.5rem;
  }
  .key-icon {
    width: 2rem;
    height: 2rem;
  }
  .identity-icon {
    color: var(--foreground);
  }
  .identity-unlocked .identity-icon {
    border-color: color-mix(in oklab, var(--primary) 65%, transparent);
  }
  .identity-locked .identity-icon,
  .identity-locked .state {
    border-color: color-mix(in oklab, var(--destructive) 45%, transparent);
    color: var(--destructive);
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
  .state,
  header > code {
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
  .rows {
    border-top: 1px solid var(--border);
    padding: 0 0.9rem;
  }
  .row {
    display: grid;
    min-height: 3.8rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem;
  }
  .row-copy {
    min-width: 0;
  }
  .row-copy strong,
  .row-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-copy strong {
    font-size: 0.75rem;
    font-weight: 500;
  }
  .row-copy small {
    margin-top: 0.12rem;
    color: var(--muted-foreground);
    font-size: 0.625rem;
  }
  .row code,
  header > code {
    overflow: hidden;
    max-width: 8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: 0.5875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    overflow: hidden;
    margin: 0.2rem 0 0;
    font-family: ui-monospace, monospace;
    font-size: 0.625rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stage {
    display: grid;
    min-height: 2rem;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    color: var(--muted-foreground);
    font-family: ui-monospace, monospace;
    font-size: 0.5625rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .stage::before,
  .stage::after {
    height: 1px;
    background: color-mix(in oklab, var(--foreground) 20%, transparent);
    content: '';
  }
  .stage span {
    padding: 0.35rem 0.7rem;
    border-right: 1px solid
      color-mix(in oklab, var(--foreground) 20%, transparent);
    border-left: 1px solid
      color-mix(in oklab, var(--foreground) 20%, transparent);
    background: var(--background);
    white-space: nowrap;
  }
  .empty-card {
    display: flex;
    min-height: 7rem;
    align-items: center;
    gap: 0.8rem;
    padding: 1rem;
    color: var(--muted-foreground);
  }
  .empty-card strong,
  .empty-card small {
    display: block;
  }
  .empty-card strong {
    color: var(--foreground);
    font-size: 0.85rem;
  }
  .empty-card small {
    margin-top: 0.25rem;
    font-size: 0.7rem;
    line-height: 1.45;
  }
  :global(.bridge-handle) {
    width: 0.4rem;
    height: 0.4rem;
    border: 1px solid var(--background);
    background: var(--primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary) 72%, transparent);
  }
</style>

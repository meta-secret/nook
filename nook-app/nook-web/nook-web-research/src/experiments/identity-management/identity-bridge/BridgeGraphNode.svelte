<script lang="ts">
  import {
    Fingerprint,
    KeyRound,
    Laptop,
    Monitor,
    ShieldCheck,
    Smartphone,
    Vault,
  } from '@lucide/svelte'
  import { Handle, Position, type NodeProps } from '@xyflow/svelte'
  import {
    BridgeGraphDataKind,
    BridgeGraphFlow,
    BridgeGraphPortMode,
    BridgeHandleType,
    BridgeIdentityPresentation,
    type BridgeGraphNode,
  } from './bridge-graph'

  let { data }: NodeProps<BridgeGraphNode> = $props()
</script>

{#if data.portMode === BridgeGraphPortMode.Target || data.portMode === BridgeGraphPortMode.Both}
  <Handle
    class={data.kind === BridgeGraphDataKind.Device
      ? 'bridge-handle device-handle'
      : 'bridge-handle'}
    type={BridgeHandleType.Target}
    position={data.flow === BridgeGraphFlow.Vertical ? Position.Top : Position.Left}
  />
{/if}

{#if data.kind === BridgeGraphDataKind.Device}
  <article class="graph-card device-node">
    <header>
      <span class="node-icon"><Laptop class="size-5" /></span>
      <span class="node-title"><strong>{data.label}</strong></span>
      <code>{data.installations.length} {data.installations.length === 1 ? 'key' : 'keys'}</code>
    </header>
    <div class="installation-list">
      {#each data.installations as installation (installation.id)}
        <div class="installation-row">
          <span class="key-icon"><KeyRound class="size-4" /></span>
          <span>
            <strong>{installation.label}</strong>
            <small>{installation.publicKey} · {installation.added}</small>
          </span>
          <code>{installation.id}</code>
        </div>
      {/each}
    </div>
  </article>
{:else if data.kind === BridgeGraphDataKind.Identity}
  <article
    class:hub-node={data.presentation === BridgeIdentityPresentation.Hub}
    class:evidence-node={data.presentation === BridgeIdentityPresentation.Evidence}
    class="graph-card identity-node"
  >
    <header>
      <span class="node-icon identity-icon"><Fingerprint class="size-5" /></span>
      <span class="node-title"><strong>{data.label}</strong></span>
      {#if data.presentation === BridgeIdentityPresentation.Evidence}
        <span class="grant-label"><ShieldCheck class="size-3.5" /> {data.grantRole}</span>
      {/if}
    </header>
    <p>{data.description}</p>
    <dl>
      <div><dt>Devices</dt><dd>{data.devices.length}</dd></div>
      <div><dt>Device keys</dt><dd>{data.keyCount}</dd></div>
      <div><dt>Identity ID</dt><dd>{data.id}</dd></div>
    </dl>
    {#if data.presentation === BridgeIdentityPresentation.Evidence}
      <div class="device-list">
        {#each data.devices as device (device.id)}
          <div class="device-row">
            <span>
              {#if device.id.includes('phone') || device.id === 'iphone'}
                <Smartphone class="size-4" />
              {:else if device.id.includes('home') || device.id === 'studio'}
                <Monitor class="size-4" />
              {:else}
                <Laptop class="size-4" />
              {/if}
            </span>
            <span>
              <strong>{device.label}</strong>
              <small>{device.installations.map((installation) => installation.label).join(' · ')}</small>
            </span>
            <code>{device.installations.length}</code>
          </div>
        {/each}
      </div>
    {/if}
  </article>
{:else if data.kind === BridgeGraphDataKind.Stage}
  <div
    class:vertical-stage={data.flow !== BridgeGraphFlow.Horizontal}
    class="stage-marker"
    aria-hidden="true"
  >
    <span>{data.label}</span>
  </div>
{:else}
  <article
    class:source-node={data.portMode === BridgeGraphPortMode.Source}
    class="graph-card vault-node"
  >
    <header>
      <span class="node-icon"><Vault class="size-5" /></span>
      <span class="node-title"><strong>{data.label}</strong></span>
      <span class="grant-label"><ShieldCheck class="size-3.5" /> {data.grantRole}</span>
    </header>
    <p>{data.description}</p>
    <dl>
      <div><dt>Grant</dt><dd>{data.grantRole}</dd></div>
      <div><dt>Items</dt><dd>{data.itemCount}</dd></div>
      <div><dt>Vault ID</dt><dd>{data.id}</dd></div>
    </dl>
  </article>
{/if}

{#if data.portMode === BridgeGraphPortMode.Source || data.portMode === BridgeGraphPortMode.Both}
  <Handle
    class={data.kind === BridgeGraphDataKind.Device
      ? 'bridge-handle device-handle'
      : 'bridge-handle'}
    type={BridgeHandleType.Source}
    position={data.flow === BridgeGraphFlow.Horizontal
      ? Position.Right
      : data.flow === BridgeGraphFlow.EvidenceTree
        ? Position.Left
        : Position.Bottom}
  />
{/if}

<style>
  .graph-card {
    width: 100%;
    border: 1px solid #303134;
    border-radius: 0.375rem;
    background: linear-gradient(145deg, #151618, #101113);
    box-shadow: 0 0.8rem 2.5rem rgb(0 0 0 / 24%);
    color: #f4f3f0;
  }

  .stage-marker {
    display: grid;
    min-height: 2rem;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    color: #6d6d6a;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.5625rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .stage-marker::before,
  .stage-marker::after {
    height: 1px;
    background: #343538;
    content: '';
  }

  .stage-marker span {
    position: relative;
    padding: 0.35rem 0.75rem;
    border-right: 1px solid #4b4c49;
    border-left: 1px solid #4b4c49;
    background: #0b0c0d;
    white-space: nowrap;
  }

  .vertical-stage span {
    color: #777774;
  }

  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem;
  }

  .node-icon,
  .key-icon {
    display: grid;
    place-items: center;
    border: 1px solid #3a3b3d;
    border-radius: 999px;
    color: #aaa9a5;
    background: #18191b;
  }

  .node-icon { width: 2.5rem; height: 2.5rem; }
  .key-icon { width: 2rem; height: 2rem; }
  .identity-icon { border-color: #777774; color: #f4f3f0; }

  .node-title { min-width: 0; }
  .node-title strong,
  .node-title small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-title strong { margin-top: 0.18rem; font-size: 1rem; font-weight: 500; }
  .node-title small,
  header > code {
    color: #777774;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.5875rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .installation-list,
  .device-list {
    border-top: 1px solid #292a2c;
    padding: 0 0.9rem;
  }

  .installation-row,
  .device-row {
    display: grid;
    min-height: 3.65rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem;
    border-bottom: 1px solid #262729;
  }

  .installation-row:last-child,
  .device-row:last-child { border-bottom: 0; }
  .installation-row > span:nth-child(2), .device-row > span:nth-child(2) { min-width: 0; }
  .installation-row strong, .installation-row small,
  .device-row strong, .device-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .installation-row strong, .device-row strong { font-size: 0.75rem; font-weight: 500; }
  .installation-row small, .device-row small { margin-top: 0.12rem; color: #696a67; font-size: 0.625rem; }
  .installation-row code, .device-row code { color: #898985; font-size: 0.625rem; }
  .device-row > span:first-child { display: grid; width: 2rem; height: 2rem; place-items: center; color: #8b8b88; }

  .identity-node,
  .vault-node { padding-bottom: 0.9rem; }
  .identity-node > p,
  .vault-node > p { margin: -0.2rem 0.9rem 0; color: #777774; font-size: 0.75rem; }

  dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 0.85rem 0.9rem 0;
    padding-top: 0.7rem;
    border-top: 1px solid #292a2c;
  }

  dl div { display: grid; gap: 0.2rem; min-width: 0; }
  dt { color: #666764; font-size: 0.5875rem; }
  dd { overflow: hidden; margin: 0; color: #a5a5a1; font-family: ui-monospace, monospace; font-size: 0.625rem; text-overflow: ellipsis; white-space: nowrap; }

  .hub-node,
  .source-node {
    border-color: #765042;
    background: radial-gradient(circle at 22% 18%, #211b19, #111214 58%);
    box-shadow: 0 0 0 1px rgb(255 107 61 / 28%), 0 0 2.25rem rgb(255 107 61 / 9%);
  }
  .hub-node header { padding-top: 1.1rem; }
  .hub-node .identity-icon { width: 3rem; height: 3rem; }
  .hub-node .identity-icon,
  .source-node .node-icon { border-color: #b66a50; color: #f4f3f0; }

  .grant-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: #d48365;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.5625rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .evidence-node .device-list { margin-top: 0.85rem; }

  :global(.bridge-handle) {
    width: 0.375rem;
    height: 0.375rem;
    border: 1px solid #08090a;
    background: #ff6b3d;
    box-shadow: 0 0 0 1px rgb(255 107 61 / 75%);
  }

  :global(.device-handle) {
    background: #777774;
    box-shadow: 0 0 0 1px rgb(119 119 116 / 75%);
  }

  @media (width < 48rem) {
    .vault-node header,
    .evidence-node header { grid-template-columns: auto minmax(0, 1fr); }
    .vault-node header .grant-label,
    .evidence-node header .grant-label {
      grid-column: 2;
      justify-self: start;
      margin-top: -0.25rem;
    }
  }
</style>

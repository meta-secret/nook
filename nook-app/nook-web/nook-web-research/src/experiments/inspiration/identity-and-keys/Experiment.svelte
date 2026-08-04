<script lang="ts">
  import {
    Fingerprint,
    KeyRound,
    LaptopMinimal,
    Monitor,
    Smartphone,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import type { ExperimentProps } from '../../index'

  const ACCENT = '#ff6b3d'
  const CAPS = 'font-mono text-[10px] tracking-[0.2em] uppercase'

  let { navigate }: ExperimentProps = $props()

  const identities = [
    {
      id: 'idn_7c9d',
      label: 'Nora',
      kind: 'Personal identity',
      devices: [
        {
          id: 'device-macbook',
          label: 'MacBook',
          icon: LaptopMinimal,
          keys: [
            {
              id: 'dev_72c1',
              installation: 'Chrome',
              publicKey: 'age1q8…6m4k',
              added: '18 Jun',
            },
            {
              id: 'dev_91ba',
              installation: 'Extension',
              publicKey: 'age1m2…q7ad',
              added: '02 Jul',
            },
          ],
        },
        {
          id: 'device-iphone',
          label: 'iPhone',
          icon: Smartphone,
          keys: [
            {
              id: 'dev_b091',
              installation: 'Nook',
              publicKey: 'age1kp…8zc2',
              added: '22 Jun',
            },
          ],
        },
        {
          id: 'device-home',
          label: 'Home computer',
          icon: Monitor,
          keys: [
            {
              id: 'dev_339a',
              installation: 'Chrome',
              publicKey: 'age1vr…2xk8',
              added: '03 Jul',
            },
          ],
        },
      ],
    },
    {
      id: 'idn_a2e6',
      label: 'Northstar studio',
      kind: 'Collective identity',
      devices: [
        {
          id: 'device-studio',
          label: 'Studio workstation',
          icon: Monitor,
          keys: [
            {
              id: 'dev_10ef',
              installation: 'Firefox',
              publicKey: 'age1t4…9nq3',
              added: '02 Jul',
            },
          ],
        },
        {
          id: 'device-studio-macbook',
          label: 'MacBook',
          icon: LaptopMinimal,
          keys: [
            {
              id: 'dev_8ac4',
              installation: 'Chrome',
              publicKey: 'age1c7…5jr9',
              added: '06 Jul',
            },
          ],
        },
      ],
    },
    {
      id: 'idn_f014',
      label: 'Field notes',
      kind: 'Personal identity',
      devices: [
        {
          id: 'device-field-phone',
          label: 'iPhone',
          icon: Smartphone,
          keys: [
            {
              id: 'dev_51d2',
              installation: 'Nook',
              publicKey: 'age1f6…3zp8',
              added: '11 Jul',
            },
          ],
        },
      ],
    },
  ] as const

  let selectedIdentityId = $state('idn_7c9d')

  function identityById(id: string) {
    const identity = identities.find((candidate) => candidate.id === id)
    if (identity) return identity
    throw new Error(`Unknown identity fixture: ${id}`)
  }

  const selectedIdentity = $derived(identityById(selectedIdentityId))
</script>

<svelte:head>
  <title>Identity, devices, and keys · Nook research</title>
</svelte:head>

<main class="min-h-svh bg-[#08090a] text-[#f4f3f0]">
  <ExperimentBack {navigate} />

  <nav
    class="identity-nav fixed top-1/2 left-3 z-40 -translate-y-1/2 sm:left-6"
    aria-label="Identities"
  >
    <div class="rail-heading">
      <Fingerprint class="size-4" aria-hidden="true" />
      <span>My identities</span>
    </div>

    <ol class="identity-rail">
      {#each identities as identity (identity.id)}
        {@const active = identity.id === selectedIdentityId}
        <li class="identity-menu-item">
          <span
            class="selection-rule {active ? 'active' : ''}"
            aria-hidden="true"
          ></span>

          <button
            type="button"
            class="identity-menu-button {active ? 'selected' : ''}"
            aria-current={active ? 'page' : 'false'}
            onclick={() => (selectedIdentityId = identity.id)}
          >
            <span
              class="identity-menu-mark {active ? 'active' : ''}"
              aria-hidden="true"
            >
              <Fingerprint class="size-3.5" />
            </span>

            <span class="identity-menu-copy">
              <span
                class="block truncate text-sm transition motion-reduce:transition-none {active
                  ? 'text-[#f4f3f0]'
                  : 'text-[#7b7b78]'}"
              >
                {identity.label}
              </span>
              <span class="mt-1 block truncate text-xs text-[#555653]">
                {identity.kind}
              </span>
            </span>

            <span class="identity-menu-count">
              {identity.devices.length}
              {identity.devices.length === 1 ? 'device' : 'devices'}
            </span>
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  <section
    class="flex min-h-svh flex-col justify-center pt-36 pr-6 pb-24 pl-16 sm:py-28 sm:pr-20 sm:pl-[24rem] lg:pr-32 lg:pl-[26rem]"
    aria-labelledby="identity-statement"
  >
    <p class={CAPS} style="color:{ACCENT}">
      Distributed identity · {selectedIdentity.kind}
    </p>

    <h1
      id="identity-statement"
      class="mt-6 max-w-5xl text-[2rem] leading-[1.08] font-medium tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl"
    >
      {selectedIdentity.label} lives across
      {selectedIdentity.devices.length}
      {selectedIdentity.devices.length === 1 ? 'device' : 'devices'}.
    </h1>

    <div
      class="mt-10 flex max-w-xl items-center gap-4 border-l-2 border-[#3a3b3d] pl-5"
    >
      <span class="identity-artifact-mark">
        <Fingerprint class="size-5" aria-hidden="true" />
      </span>
      <span>
        <span class="block text-lg leading-7 sm:text-xl"
          >{selectedIdentity.label}</span
        >
        <span
          class="mt-1.5 block font-mono text-xs tracking-[0.08em] text-[#777774]"
        >
          {selectedIdentity.id}
        </span>
      </span>
    </div>

    <section class="mt-14" aria-labelledby="devices-heading">
      <header class="flex items-end justify-between gap-4">
        <h2 id="devices-heading" class="{CAPS} text-[#6d6d6a]">
          Devices carrying its keys
        </h2>
        <span class="font-mono text-xs text-[#555653]">
          {selectedIdentity.devices.length} total
        </span>
      </header>

      <ul class="device-shelves">
        {#each selectedIdentity.devices as device (device.id)}
          {@const DeviceIcon = device.icon}
          <li class="device-shelf">
            <header class="device-shelf-heading">
              <span class="device-mark">
                <DeviceIcon class="size-4" aria-hidden="true" />
              </span>
              <span class="min-w-0">
                <h3
                  class="text-base leading-5 font-medium tracking-[-0.02em] text-[#f4f3f0]"
                >
                  {device.label}
                </h3>
                <span class="mt-1 block font-mono text-[10px] text-[#6d6d6a]">
                  {device.keys.length}
                  {device.keys.length === 1 ? 'key' : 'keys'}
                </span>
              </span>
            </header>

            <ul class="key-card-grid" aria-label="Keys on {device.label}">
              {#each device.keys as key (key.id)}
                <li class="key-card">
                  <div class="key-card-heading">
                    <span class="key-mark">
                      <KeyRound class="size-4" aria-hidden="true" />
                    </span>
                    <span class="key-card-copy">
                      <span class="{CAPS} block text-[#6d6d6a]"
                        >Installation key</span
                      >
                      <span class="key-title-row">
                        <span
                          class="truncate text-base font-medium text-[#f4f3f0]"
                        >
                          {key.installation}
                        </span>
                        <span class="key-id">{key.id}</span>
                      </span>
                    </span>
                  </div>

                  <dl class="key-facts">
                    <div>
                      <dt>Public key</dt>
                      <dd class="font-mono">{key.publicKey}</dd>
                    </div>
                    <div>
                      <dt>Added</dt>
                      <dd>{key.added}</dd>
                    </div>
                  </dl>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    </section>

    <p class="mt-10 max-w-xl text-sm leading-6 text-[#6d6d6a]">
      Each device keeps its private keys locally. The distributed identity
      carries only their public keys.
    </p>
  </section>
</main>

<style>
  .rail-heading {
    display: flex;
    width: 3.5rem;
    align-items: center;
    gap: 0.65rem;
    margin: 0 0 1rem 0.75rem;
    padding-left: 0.45rem;
    color: #8b8b88;
  }

  .rail-heading span {
    display: none;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.6875rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .identity-rail {
    display: grid;
    width: 3.5rem;
    gap: 0.65rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .identity-menu-item {
    position: relative;
  }

  .selection-rule {
    position: absolute;
    top: 50%;
    left: 0;
    width: 1px;
    height: 1.5rem;
    background: #4a4a48;
    transform: translateY(-50%);
    transition:
      height 300ms ease,
      background-color 300ms ease;
  }

  .selection-rule.active {
    height: 3.75rem;
    background: #ff6b3d;
  }

  .identity-menu-button {
    display: grid;
    width: 3.5rem;
    min-height: 4.5rem;
    grid-template-columns: 2.75rem;
    align-items: center;
    gap: 0.75rem;
    margin-left: 0.75rem;
    padding: 0.45rem;
    border: 0;
    border-radius: 2.5rem 0 0 2.5rem;
    background: transparent;
    color: inherit;
    text-align: left;
    opacity: 0.62;
    transition:
      background 180ms ease,
      opacity 180ms ease;
  }

  .identity-menu-button:hover {
    background: linear-gradient(90deg, #141517 0%, transparent 88%);
    opacity: 0.86;
  }

  .identity-menu-button.selected {
    background: linear-gradient(
      90deg,
      #1b1c1e 0%,
      #111214 62%,
      transparent 100%
    );
    opacity: 1;
  }

  .identity-menu-button:focus-visible {
    outline: 0;
    box-shadow: inset 0 0 0 1px #777774;
  }

  .identity-menu-mark {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    place-items: center;
    border: 2px solid #3f403e;
    border-radius: 999px;
    color: #6d6d6a;
    transition:
      border-color 300ms ease,
      color 300ms ease;
  }

  .identity-menu-mark.active {
    border-color: #c9c8c4;
    color: #f4f3f0;
  }

  .identity-menu-copy,
  .identity-menu-count {
    display: none;
  }

  .identity-menu-copy {
    min-width: 0;
  }

  .identity-menu-count {
    color: #6d6d6a;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.625rem;
    letter-spacing: 0.04em;
    text-align: right;
  }

  .identity-artifact-mark {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    place-items: center;
    border: 1px solid #555653;
    border-radius: 999px;
    color: #c9c8c4;
  }

  .device-shelves {
    margin: 0.75rem 0 0;
    padding: 0;
    border-bottom: 1px solid #1e1f21;
    list-style: none;
  }

  .device-shelf {
    display: grid;
    grid-template-columns: minmax(10rem, 12rem) minmax(0, 1fr);
    gap: 1.75rem;
    min-width: 0;
    padding: 1.35rem 0;
    border-top: 1px solid #1e1f21;
  }

  .device-shelf-heading {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    align-self: start;
    min-height: 2.5rem;
  }

  .device-shelf-heading::after {
    position: absolute;
    top: 1.25rem;
    left: 100%;
    width: 1.75rem;
    height: 1px;
    background: #343537;
    content: '';
  }

  .device-mark {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    place-items: center;
    border: 1px solid #3b3c3e;
    border-radius: 999px;
    color: #8b8b88;
  }

  .key-card-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .key-card {
    flex: 1 1 15rem;
    width: min(100%, 15rem);
    max-width: 21rem;
    min-width: 0;
    padding: 1rem 1.05rem;
    border: 1px solid #303134;
    border-radius: 0.375rem;
    background: linear-gradient(145deg, #131416 0%, #101113 100%);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 3%);
  }

  .key-card-heading {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 0.65rem;
  }

  .key-card-copy {
    display: grid;
    min-width: 0;
    gap: 0.3rem;
  }

  .key-title-row {
    display: flex;
    min-width: 0;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .key-mark {
    display: grid;
    width: 1.75rem;
    height: 1.75rem;
    place-items: center;
    border-radius: 999px;
    background: #1b1c1e;
    color: #b2b1ad;
  }

  .key-facts {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    margin-top: 1rem;
    padding-top: 0.8rem;
    border-top: 1px solid #292a2c;
  }

  .key-facts div {
    display: grid;
    gap: 0.25rem;
  }

  .key-facts dt {
    color: #686966;
    font-size: 0.6875rem;
  }

  .key-facts dd {
    color: #a5a5a1;
    font-size: 0.6875rem;
  }

  .key-facts div:last-child {
    text-align: right;
  }

  .key-id {
    flex: none;
    color: #8b8b88;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
  }

  @media (width < 64rem) {
    .device-shelf {
      grid-template-columns: 1fr;
      gap: 0.85rem;
    }

    .device-shelf-heading::after {
      display: none;
    }

    .key-card {
      width: min(100%, 21rem);
    }
  }

  @media (width < 40rem) {
    .identity-nav {
      position: relative;
      top: auto;
      left: auto;
      margin: 0 1.25rem;
      padding-top: 7rem;
      transform: none;
      translate: none;
    }

    .rail-heading {
      width: auto;
      margin: 0 0 0.8rem;
      padding: 0;
    }

    .rail-heading span {
      display: block;
    }

    .identity-rail {
      display: flex;
      width: auto;
      gap: 0.65rem;
    }

    .identity-menu-item {
      padding-bottom: 0.55rem;
    }

    .selection-rule {
      top: auto;
      bottom: 0;
      left: 50%;
      width: 1.5rem;
      height: 1px;
      transform: translateX(-50%);
      transition:
        width 300ms ease,
        background-color 300ms ease;
    }

    .selection-rule.active {
      width: 3rem;
      height: 1px;
    }

    .identity-menu-button {
      margin-left: 0;
      border-radius: 999px;
    }

    .identity-nav + section {
      min-height: auto;
      padding: 3rem 1.25rem 5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .identity-menu-mark,
    .identity-menu-button,
    .selection-rule {
      transition: none;
    }
  }

  @media (width >= 40rem) {
    .rail-heading {
      width: 20rem;
    }

    .rail-heading span {
      display: block;
    }

    .identity-rail {
      width: 20rem;
    }

    .identity-menu-button {
      width: calc(100% - 0.75rem);
      grid-template-columns: 2.75rem minmax(0, 1fr) auto;
      padding-right: 0.9rem;
    }

    .identity-menu-copy,
    .identity-menu-count {
      display: block;
    }
  }
</style>

<!--
DIRECTION: Not an inventory — a risk read. One column of graded links, each
answering "what happens if you lose this" and "can it come back", with the
weakest link stated before anything else. Grades are derived from the fixture
only: protection kind, backup state, vault trust, backup-password counts.
-->
<script lang="ts">
  import {
    ChevronDown,
    Fingerprint,
    Laptop,
    TriangleAlert,
    Vault,
  } from '@lucide/svelte'
  import ExperimentBack from '$lib/components/ExperimentBack.svelte'
  import ScenarioSwitch from '../_shared/ScenarioSwitch.svelte'
  import {
    BrowserProtection,
    CHAIN_STAGES,
    ChainStage,
    type AccessScenario,
    type Fact,
    FactKind,
    factText,
    isPrepared,
    ScenarioId,
    scenarioById,
    stageCaption,
    stageEvidence,
    stageIdentifier,
    stageTitle,
    verifiedVaults,
  } from '../_shared/keys-management-state'
  import type { ExperimentProps } from '../../index'
  import { Grade } from './chain-grade'

  interface LinkRead {
    stage: ChainStage
    grade: Grade
    loss: string
    recovery: string
    action: string
    identifier: Fact
  }

  let { navigate }: ExperimentProps = $props()
  let scenarioId = $state(ScenarioId.Shared)
  let openStage = $state(ChainStage.Passkey)
  const scenario = $derived(scenarioById(scenarioId))
  const reads = $derived(CHAIN_STAGES.map((stage) => readFor(scenario, stage)))
  const weakest = $derived(weakestOf(reads))

  const GRADES: Record<Grade, { rank: number; label: string }> = {
    [Grade.Absent]: { rank: 0, label: 'Not present yet' },
    [Grade.SinglePoint]: { rank: 1, label: 'Single point of failure' },
    [Grade.Rederivable]: { rank: 2, label: 'Can be re-derived' },
    [Grade.Recoverable]: { rank: 3, label: 'Recoverable elsewhere' },
  }

  const STAGE_ICON = {
    [ChainStage.Passkey]: Fingerprint,
    [ChainStage.DeviceKey]: Laptop,
    [ChainStage.Vaults]: Vault,
  }

  function passkeyRead(access: AccessScenario): LinkRead {
    const identifier = stageIdentifier(access, ChainStage.Passkey)
    if (access.protection === BrowserProtection.NotPrepared) {
      return {
        stage: ChainStage.Passkey,
        grade: Grade.Absent,
        loss: 'Nothing to lose yet. No passkey has been created for this browser, so no route in exists.',
        recovery: `Nothing to recover either. Whether a future passkey can be restored is settled when you make it: ${access.passkey.backupState.toLowerCase()}.`,
        action: 'Create a passkey for this browser.',
        identifier,
      }
    }
    const recoverable =
      access.protection === BrowserProtection.PasskeyRecoverable
    return {
      stage: ChainStage.Passkey,
      grade: recoverable ? Grade.Recoverable : Grade.SinglePoint,
      loss: 'Lose this passkey and nothing can unlock this browser again. Nook never held the passkey itself — only a fingerprint of it.',
      recovery: recoverable
        ? `${access.passkey.backupState}, so you can present it again from another device signed in to ${factText(access.passkey.savedIn)}.`
        : `${access.passkey.backupState}. Nothing can re-derive it, so losing that authenticator closes this route for good.`,
      action: recoverable
        ? `Confirm ${factText(access.passkey.savedIn)} is still syncing on a second device you own.`
        : 'Add a second passkey, and keep a backup password for every vault you cannot afford to lose.',
      identifier,
    }
  }

  function deviceRead(access: AccessScenario): LinkRead {
    const identifier = stageIdentifier(access, ChainStage.DeviceKey)
    if (!isPrepared(access)) {
      return {
        stage: ChainStage.DeviceKey,
        grade: Grade.Absent,
        loss: `Nothing here to lose. ${access.device.boundary}`,
        recovery: `${factText(access.device.id)}, and it will live only in ${access.device.browser} on ${access.device.platform}.`,
        action: 'Prepare this browser so a device key exists.',
        identifier,
      }
    }
    const thin = verifiedVaults(access).filter(
      (vault) => vault.enrolledDevices < 2,
    )
    return {
      stage: ChainStage.DeviceKey,
      grade: Grade.Rederivable,
      loss: `Clear this browser's storage and the device key is gone with it. ${access.device.boundary}`,
      recovery: `It is re-derived the next time that passkey unlocks ${access.device.browser} here — but only while the passkey still exists.`,
      action:
        thin.length === 0
          ? 'Every verified vault already has another enrolled device. Nothing to do here.'
          : `Only this device is enrolled in ${thin.map((vault) => vault.label).join(', ')}. Enrol a second device.`,
      identifier,
    }
  }

  function vaultRead(access: AccessScenario): LinkRead {
    const identifier = stageIdentifier(access, ChainStage.Vaults)
    const verified = verifiedVaults(access)
    if (verified.length === 0) {
      return {
        stage: ChainStage.Vaults,
        grade: Grade.Absent,
        loss: 'Nothing is reachable from this browser, so nothing here can be lost.',
        recovery:
          'A vault counts as reachable only after this device key has actually opened it.',
        action: 'Open or join a vault from this browser.',
        identifier,
      }
    }
    const unbacked = verified.filter((vault) => vault.backupPasswords === 0)
    const unverified = access.vaults.length - verified.length
    return {
      stage: ChainStage.Vaults,
      grade: unbacked.length === 0 ? Grade.Recoverable : Grade.SinglePoint,
      loss:
        unbacked.length === 0
          ? 'A vault is reachable through a verified key or its backup password. Every verified vault here still has a second way in.'
          : `${unbacked.map((vault) => vault.label).join(', ')} can only be opened by a verified key. Lose every key and the data is unreadable.`,
      recovery:
        unverified === 0
          ? 'Backup passwords stay wrapped in this browser, so they survive losing the passkey but not losing this browser.'
          : `${unverified} of the vaults listed here has never been opened by this key, so it is not proven reachable at all.`,
      action:
        unbacked.length === 0
          ? 'Keep one backup password written down somewhere outside this browser.'
          : `Set a backup password for ${unbacked.map((vault) => vault.label).join(', ')}.`,
      identifier,
    }
  }

  function readFor(access: AccessScenario, stage: ChainStage): LinkRead {
    if (stage === ChainStage.Passkey) return passkeyRead(access)
    if (stage === ChainStage.DeviceKey) return deviceRead(access)
    return vaultRead(access)
  }

  function weakestOf(rows: LinkRead[]): LinkRead {
    return rows.reduce((worst, row) =>
      GRADES[row.grade].rank < GRADES[worst.grade].rank ? row : worst,
    )
  }

  function prose(read: LinkRead): { label: string; text: string }[] {
    return [
      { label: 'If you lose it', text: read.loss },
      { label: 'Can it come back', text: read.recovery },
    ]
  }

  function gradeInk(grade: Grade): string {
    if (grade === Grade.SinglePoint) return 'text-[#a8431c]'
    if (grade === Grade.Absent) return 'text-[#1a1815]/35'
    return 'text-[#1a1815]/65'
  }

  function gradeEdge(grade: Grade): string {
    if (grade === Grade.SinglePoint)
      return 'border-[#a8431c]/45 bg-[#a8431c]/[0.04]'
    if (grade === Grade.Absent) return 'border-dashed border-[#1a1815]/25'
    return 'border-[#1a1815]/15'
  }
</script>

<main class="min-h-[100svh] bg-[#f6f3ec] text-[#1a1815]">
  <ExperimentBack {navigate} light />
  <ScenarioSwitch
    {scenario}
    light
    onScenario={(next) => {
      scenarioId = next
      openStage = ChainStage.Passkey
    }}
  />

  <section class="mx-auto max-w-2xl px-5 py-24 sm:px-8 sm:py-28">
    <p
      class="font-mono text-[11px] tracking-[0.24em] text-[#1a1815]/45 uppercase"
    >
      Devices &amp; access · assessment
    </p>
    <h1
      class="mt-6 text-3xl leading-tight font-normal tracking-[-0.02em] sm:text-4xl"
    >
      Three links hold your data.<br />
      Here is what happens if one goes.
    </h1>

    <div
      class="mt-10 border-l-2 border-[#a8431c] bg-[#a8431c]/[0.05] py-5 pr-5 pl-5"
    >
      <p
        class="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-[#a8431c] uppercase"
      >
        <TriangleAlert class="size-3.5" aria-hidden="true" />
        Weakest link · {stageCaption(weakest.stage)}
      </p>
      <p class="mt-3 text-[15px] leading-6">{weakest.loss}</p>
      <p class="mt-3 text-sm leading-6 text-[#1a1815]/60">{weakest.action}</p>
    </div>

    <ol class="mt-12 space-y-4">
      {#each reads as read, index (read.stage)}
        {@const Icon = STAGE_ICON[read.stage]}
        {@const open = openStage === read.stage}
        <li class={`border ${gradeEdge(read.grade)}`}>
          <button
            type="button"
            class="flex w-full items-start gap-4 px-5 py-4 text-left"
            aria-expanded={open}
            onclick={() => (openStage = read.stage)}
          >
            <span
              class="mt-0.5 font-mono text-[11px] text-[#1a1815]/35 tabular-nums"
            >
              0{index + 1}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <Icon
                  class={`size-3.5 shrink-0 ${gradeInk(read.grade)}`}
                  aria-hidden="true"
                />
                <span
                  class="font-mono text-[10px] tracking-[0.2em] text-[#1a1815]/45 uppercase"
                >
                  {stageCaption(read.stage)}
                </span>
              </span>
              <span
                class="mt-1.5 block text-lg leading-6 font-normal break-words"
              >
                {stageTitle(scenario, read.stage)}
              </span>
              <span class={`mt-1 block text-[13px] ${gradeInk(read.grade)}`}>
                {GRADES[read.grade].label}
              </span>
            </span>
            <ChevronDown
              class={`mt-1 size-4 shrink-0 text-[#1a1815]/35 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {#if open}
            <div class="border-t border-[#1a1815]/10 px-5 py-5">
              <dl class="space-y-4">
                {#each prose(read) as row (row.label)}
                  <div>
                    <dt
                      class="font-mono text-[10px] tracking-[0.18em] text-[#1a1815]/40 uppercase"
                    >
                      {row.label}
                    </dt>
                    <dd class="mt-1.5 text-sm leading-6">{row.text}</dd>
                  </div>
                {/each}
              </dl>

              <p
                class={`mt-5 border-t border-[#1a1815]/10 pt-4 text-[13px] leading-6 ${read.identifier.kind === FactKind.Known ? 'font-mono break-all text-[#1a1815]/55' : 'text-[#1a1815]/40 italic'}`}
              >
                {factText(read.identifier)}
              </p>

              <ul class="mt-4 space-y-1.5">
                {#each stageEvidence(scenario, read.stage) as row (row.label)}
                  <li class="flex flex-wrap justify-between gap-3 text-[13px]">
                    <span class="text-[#1a1815]/45">{row.label}</span>
                    <span
                      class={row.fact.kind === FactKind.Known
                        ? 'font-mono break-all'
                        : 'text-[#1a1815]/35 italic'}
                    >
                      {factText(row.fact)}
                    </span>
                  </li>
                {/each}
              </ul>

              <button
                type="button"
                class={`mt-6 w-full px-5 py-3 text-sm font-medium transition motion-reduce:transition-none ${
                  read.grade === Grade.SinglePoint ||
                  read.grade === Grade.Absent
                    ? 'bg-[#a8431c] text-[#f6f3ec] hover:bg-[#8f3817]'
                    : 'border border-[#1a1815]/25 hover:border-[#1a1815]/60'
                }`}
              >
                {read.action}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ol>

    <p class="mt-12 text-[13px] leading-6 text-[#1a1815]/45">
      Every grade above is read off what this browser can actually observe. The
      passkey never leaves your manager, the device key exists only here, and a
      vault is counted only once this key has opened it.
    </p>
  </section>
</main>

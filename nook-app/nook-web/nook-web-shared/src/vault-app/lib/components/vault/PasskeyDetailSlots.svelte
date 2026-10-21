<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    PasskeyNameKind,
    SecretOriginDeviceKind,
    SecretRevisionKind,
    type SecretHistoryDeviceView,
  } from "$lib/nook";
  import {
    PasskeyDetailsPresentationKind,
    SecretHistoryPresentationKind,
    type PasskeyDetailsPresentation,
    type SecretHistoryPresentation,
  } from "../secret-vault-state";
  import SecretSlot from "./SecretSlot.svelte";
  import { SlotWidth } from "./secret-slot";
  import { CopyField, type DetailCopies } from "./secret-detail-copies";

  let {
    presentation,
    history,
    copies,
    vault,
  }: {
    presentation: PasskeyDetailsPresentation;
    history: SecretHistoryPresentation;
    copies: DetailCopies;
    vault: VaultState;
  } = $props();

  /** Locale date and time for an RFC 3339 event timestamp the selection validated. */
  function eventTime(at: string): string {
    const formatOptions: ConstructorParameters<typeof Intl.DateTimeFormat>[1] =
      {
        dateStyle: "medium",
        timeStyle: "short",
      };
    return new Intl.DateTimeFormat(vault.locale, formatOptions).format(
      new Date(at),
    );
  }

  /** Localized device row text from its translation key and `{device}` value. */
  function deviceText(device: SecretHistoryDeviceView): string {
    const request: Parameters<typeof vault.t>[0] = {
      key: device.labelKey,
      replacements: { device: device.value },
    };
    return vault.t(request);
  }
</script>

{#if presentation.kind === PasskeyDetailsPresentationKind.Loaded}
  {@const details = presentation.details}
  {#if details.userName.kind === PasskeyNameKind.Distinct}
    <SecretSlot
      label={vault.t(I18N_KEYS.VaultFieldsUsername)}
      testId="passkey-user-name"
    >
      {details.userName.text}
    </SecretSlot>
  {/if}
  {#if details.relyingPartyName.kind === PasskeyNameKind.Distinct}
    <SecretSlot
      label={vault.t(I18N_KEYS.VaultFieldsPasskeyRelyingPartyName)}
      testId="passkey-relying-party-name"
    >
      {details.relyingPartyName.text}
    </SecretSlot>
  {/if}
  <SecretSlot
    label={vault.t(I18N_KEYS.VaultFieldsPasskeyCredentialId)}
    width={SlotWidth.Full}
    mono
    copy={copies.field(CopyField.CredentialId)}
    testId="passkey-credential-id"
  >
    <code class="break-all">{details.credentialId}</code>
  </SecretSlot>
  <SecretSlot
    label={vault.t(I18N_KEYS.VaultFieldsPasskeyPublicKeyFingerprint)}
    width={SlotWidth.Full}
    mono
    copy={copies.field(CopyField.PublicKeyFingerprint)}
    testId="passkey-public-key-fingerprint"
  >
    <code class="break-all">{details.publicKeyFingerprint}</code>
  </SecretSlot>
  <SecretSlot
    label={vault.t(I18N_KEYS.VaultFieldsPasskeyAlgorithm)}
    testId="passkey-algorithm"
  >
    {vault.t(details.algorithmLabelKey)}
  </SecretSlot>
  <SecretSlot
    label={vault.t(I18N_KEYS.VaultFieldsPasskeySignatureCount)}
    mono
    testId="passkey-signature-count"
  >
    {details.signatureCount}
  </SecretSlot>
  <SecretSlot
    label={vault.t(I18N_KEYS.VaultFieldsPasskeyDiscoverable)}
    testId="passkey-discoverable"
  >
    {vault.t(details.discoverableLabelKey)}
  </SecretSlot>
  <SecretSlot
    label={vault.t(I18N_KEYS.VaultFieldsPasskeyBackup)}
    testId="passkey-backup"
  >
    {vault.t(details.backupStatusLabelKey)}
  </SecretSlot>
{:else if presentation.kind === PasskeyDetailsPresentationKind.Loading}
  <p
    class="col-span-full text-sm text-muted-foreground"
    role="status"
    data-testid="passkey-details-loading"
  >
    {vault.t(I18N_KEYS.VaultFieldsPasskeyDetailsLoading)}
  </p>
{:else if presentation.kind === PasskeyDetailsPresentationKind.Failed}
  <p
    class="col-span-full text-sm text-destructive"
    role="alert"
    data-testid="passkey-details-error"
  >
    {vault.t(I18N_KEYS.VaultFieldsPasskeyDetailsUnavailable)}
  </p>
{/if}

{#if history.kind === SecretHistoryPresentationKind.Loaded}
  {@const entry = history.history}
  <SecretSlot label={vault.t(entry.originLabelKey)} testId="history-origin">
    <time datetime={entry.originAt}>{eventTime(entry.originAt)}</time>
  </SecretSlot>
  {#if entry.originDevice.kind === SecretOriginDeviceKind.Recorded}
    <SecretSlot
      label={vault.t(I18N_KEYS.VaultFieldsHistoryDevice)}
      testId="history-origin-device"
    >
      {deviceText(entry.originDevice.device)}
    </SecretSlot>
  {/if}
  {#if entry.revision.kind === SecretRevisionKind.Revised}
    <SecretSlot
      label={vault.t(I18N_KEYS.VaultFieldsHistoryModified)}
      testId="history-modified"
    >
      <time datetime={entry.revision.at}>{eventTime(entry.revision.at)}</time>
    </SecretSlot>
    <SecretSlot
      label={vault.t(I18N_KEYS.VaultFieldsHistoryModifiedDevice)}
      testId="history-modified-device"
    >
      {deviceText(entry.revision.device)}
    </SecretSlot>
  {/if}
{:else if history.kind === SecretHistoryPresentationKind.Loading}
  <p
    class="col-span-full text-sm text-muted-foreground"
    role="status"
    data-testid="history-loading"
  >
    {vault.t(I18N_KEYS.VaultFieldsHistoryLoading)}
  </p>
{:else if history.kind === SecretHistoryPresentationKind.Failed}
  <p
    class="col-span-full text-sm text-destructive"
    role="alert"
    data-testid="history-error"
  >
    {vault.t(I18N_KEYS.VaultFieldsHistoryUnavailable)}
  </p>
{/if}

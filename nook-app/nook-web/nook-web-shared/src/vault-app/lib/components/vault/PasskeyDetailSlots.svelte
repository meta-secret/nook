<script lang="ts">
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "$lib/vault.svelte";
  import {
    PasskeyDetailsPresentationKind,
    type PasskeyDetailsPresentation,
  } from "../secret-vault-state";
  import SecretSlot from "./SecretSlot.svelte";
  import { SlotWidth } from "./secret-slot";
  import { CopyField, type DetailCopies } from "./secret-detail-copies";

  let {
    presentation,
    copies,
    vault,
  }: {
    presentation: PasskeyDetailsPresentation;
    copies: DetailCopies;
    vault: VaultState;
  } = $props();
</script>

{#if presentation.kind === PasskeyDetailsPresentationKind.Loaded}
  {@const details = presentation.details}
  {#if details.distinctUserName}
    <SecretSlot
      label={vault.t(I18N_KEYS.VaultFieldsUsername)}
      testId="passkey-user-name"
    >
      {details.distinctUserName}
    </SecretSlot>
  {/if}
  {#if details.relyingPartyName}
    <SecretSlot
      label={vault.t(I18N_KEYS.VaultFieldsPasskeyRelyingPartyName)}
      testId="passkey-relying-party-name"
    >
      {details.relyingPartyName}
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

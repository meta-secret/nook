<script lang="ts">
  import {
    SecretFailurePresentation,
    type SecretOperationResult,
  } from "$lib/vault/secret-operation-failure";
  import type { SecretMutationOutcome } from "$lib/vault/secrets";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import {
    Check,
    Copy,
    Download,
    Eye,
    EyeOff,
    Pencil,
    Trash2,
  } from "@lucide/svelte";
  import type { NookSecretListItem } from "$lib/nook";
  import { SecretType } from "$lib/nook";
  import { VaultEditDecision } from "$app-wasm";
  import type { VaultEditRestriction, VaultState } from "$lib/vault.svelte";
  import { Button } from "$lib/components/ui/button";
  import MarkdownContent from "../MarkdownContent.svelte";
  import {
    AuthenticatorCodePresentationKind,
    ClipboardNoticeKind,
    PasskeyDetailsPresentationKind,
    SecretHistoryPresentationKind,
    SecretPageInteractionKind,
    SecretRevealKind,
    type AuthenticatorCodePresentation,
    type ClipboardNotice,
    type PasskeyDetailsPresentation,
    type SecretHistoryPresentation,
    type SecretReveal,
  } from "../secret-vault-state";
  import SecretSlot from "./SecretSlot.svelte";
  import PasskeyDetailSlots from "./PasskeyDetailSlots.svelte";
  import SecretStrengthMeter from "./SecretStrengthMeter.svelte";
  import {
    SecretItemView,
    type SecretItemViewSubject,
  } from "./secret-item-view";
  import {
    SecretSlotSeal,
    SlotCopyKind,
    SlotSeal,
    SlotWidth,
  } from "./secret-slot";
  import {
    CopyField,
    DetailCopies,
    type DetailCopyContext,
    type SecretFieldCopy,
  } from "./secret-detail-copies";

  let {
    item,
    pageInteraction,
    reveal = { kind: SecretRevealKind.Hidden },
    authenticatorCode = { kind: AuthenticatorCodePresentationKind.Hidden },
    passkeyDetails = { kind: PasskeyDetailsPresentationKind.Hidden },
    secretHistory = { kind: SecretHistoryPresentationKind.Hidden },
    copiedNotice = { kind: ClipboardNoticeKind.Hidden },
    editRestriction = { decision: VaultEditDecision.Allowed },
    onToggleReveal,
    onEditItem,
    onDeleteSecret,
    onCopyToClipboard,
    onCopySecret,
    vault,
  }: {
    item: NookSecretListItem;
    pageInteraction: SecretPageInteractionKind;
    reveal?: SecretReveal;
    authenticatorCode?: AuthenticatorCodePresentation;
    passkeyDetails?: PasskeyDetailsPresentation;
    secretHistory?: SecretHistoryPresentation;
    copiedNotice?: ClipboardNotice;
    editRestriction?: VaultEditRestriction;
    onToggleReveal: (id: string) => Promise<void>;
    onEditItem: (item: NookSecretListItem) => Promise<void>;
    onDeleteSecret: (
      id: string,
    ) => Promise<SecretOperationResult<SecretMutationOutcome.Deleted>>;
    onCopyToClipboard: (args: SecretFieldCopy) => Promise<void>;
    onCopySecret: (id: string) => Promise<void>;
    vault: VaultState;
  } = $props();

  const MASK = "••••••••••••••••";

  const view = $derived.by(() => {
    const subject: SecretItemViewSubject = { item, vault };
    return new SecretItemView(subject);
  });
  const Icon = $derived(view.icon);
  const revealed = $derived(reveal.kind === SecretRevealKind.Revealed);
  const secretSeal = $derived(new SecretSlotSeal(revealed).seal);
  const editsBlocked = $derived(
    editRestriction.decision !== VaultEditDecision.Allowed,
  );
  const readOnly = $derived(item.type === SecretType.Passkey);

  const cardExpiration = $derived.by(() => {
    const month = (
      reveal.kind === SecretRevealKind.Revealed
        ? reveal.record.expirationMonth
        : item.expirationMonth
    ).trim();
    const year = (
      reveal.kind === SecretRevealKind.Revealed
        ? reveal.record.expirationYear
        : item.expirationYear
    ).trim();
    if (month && year) return `${month.padStart(2, "0")}/${year}`;
    return month || year;
  });

  const copies = $derived.by(() => {
    const context: DetailCopyContext = {
      itemId: item.id,
      texts: {
        [CopyField.Website]: item.websiteUrl,
        [CopyField.Username]: item.username,
        [CopyField.Expires]: item.expiresAt,
        [CopyField.AccountName]: item.name,
        [CopyField.Cardholder]: item.cardholderName.trim(),
        [CopyField.CardNumber]:
          reveal.kind === SecretRevealKind.Revealed
            ? reveal.record.cardNumber
            : "",
        [CopyField.Expiration]: cardExpiration,
        [CopyField.Cvv]:
          reveal.kind === SecretRevealKind.Revealed ? reveal.record.cvv : "",
        [CopyField.CurrentCode]:
          authenticatorCode.kind === AuthenticatorCodePresentationKind.Visible
            ? authenticatorCode.code.code
            : "",
        [CopyField.CredentialId]:
          passkeyDetails.kind === PasskeyDetailsPresentationKind.Loaded
            ? passkeyDetails.details.credentialId
            : "",
        [CopyField.PublicKeyFingerprint]:
          passkeyDetails.kind === PasskeyDetailsPresentationKind.Loaded
            ? passkeyDetails.details.publicKeyFingerprint
            : "",
      },
      backupCodes:
        reveal.kind === SecretRevealKind.Revealed
          ? reveal.record.backupCodes
          : [],
      notice: copiedNotice,
      translate: (key) => vault.t(key),
      copyField: onCopyToClipboard,
      copySecret: onCopySecret,
    };
    return new DetailCopies(context);
  });

  const codeExpiry = $derived.by(() => {
    if (authenticatorCode.kind !== AuthenticatorCodePresentationKind.Visible)
      return "";
    const expiryArgs: Parameters<typeof vault.t>[0] = {
      key: I18N_KEYS.VaultFieldsCodeExpiresIn,
      replacements: { count: String(authenticatorCode.code.secondsRemaining) },
    };
    return vault.t(expiryArgs);
  });

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function downloadFileAttachment() {
    if (
      reveal.kind !== SecretRevealKind.Revealed ||
      item.type !== SecretType.FileAttachment
    ) {
      return;
    }
    const binary = atob(reveal.record.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blobOptions: ConstructorParameters<typeof Blob>[1] = {
      type: reveal.record.mimeType || "application/octet-stream",
    };
    const blob = new Blob([bytes], blobOptions);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = reveal.record.fileName || item.fileName || "secret-file";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteItem() {
    const result = await onDeleteSecret(item.id);
    if (result.isErr()) new SecretFailurePresentation(vault).show(result.error);
  }
</script>

<section
  class="nk-frame-sheet nk-secret-detail nk-secret-detail-pane"
  aria-label={view.title}
  data-testid="secret-detail"
>
  <header class="flex flex-wrap items-start gap-3.5">
    <span class="nk-tile nk-tile-lg"><Icon class="size-[18px]" /></span>
    <div class="min-w-0 flex-1">
      <h3
        class="text-lg font-semibold [overflow-wrap:anywhere] sm:text-xl"
        data-testid="secret-detail-title"
      >
        {view.title}
      </h3>
      <span class="nk-tag mt-1.5">
        <Icon class="size-3" />
        {vault.t(view.typeLabelKey).toLowerCase()}
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      {#if !readOnly}
        <Button
          size="sm"
          variant={revealed ? "secondary" : "outline"}
          aria-pressed={revealed}
          aria-label={revealed
            ? vault.t(I18N_KEYS.VaultHideValue)
            : vault.t(I18N_KEYS.VaultShowValue)}
          data-testid="reveal-secret-btn"
          disabled={pageInteraction !== SecretPageInteractionKind.Ready}
          onclick={() => void onToggleReveal(item.id)}
        >
          {#if revealed}<EyeOff class="size-3.5" />{:else}<Eye
              class="size-3.5"
            />{/if}
          <span class="max-sm:sr-only"
            >{revealed
              ? vault.t(I18N_KEYS.VaultDetailHide)
              : vault.t(I18N_KEYS.VaultDetailReveal)}</span
          >
        </Button>
        <button
          type="button"
          class="nk-icon-btn"
          aria-label={vault.t(I18N_KEYS.CommonEdit)}
          title={editRestriction.decision !== VaultEditDecision.Allowed
            ? editRestriction.reason
            : vault.t(I18N_KEYS.CommonEdit)}
          data-testid="edit-secret-btn"
          disabled={editsBlocked}
          onclick={() => void onEditItem(item)}
        >
          <Pencil class="size-4" />
        </button>
      {/if}
      <button
        type="button"
        class="nk-icon-btn hover:!text-destructive"
        aria-label={vault.t(I18N_KEYS.CommonDelete)}
        title={vault.t(I18N_KEYS.CommonDelete)}
        data-testid="delete-secret-btn"
        onclick={() => void deleteItem()}
      >
        <Trash2 class="size-4" />
      </button>
    </div>
  </header>

  {#if item.type === SecretType.Passkey}
    <p class="text-sm text-muted-foreground">
      {vault.t(I18N_KEYS.VaultFieldsPasskeyManagedHint)}
    </p>
  {/if}

  <div class="nk-slots">
    {#if item.type === SecretType.Login}
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsWebsiteLabel)}
        copy={copies.field(CopyField.Website)}
      >
        {item.websiteUrl || vault.t(I18N_KEYS.VaultFieldsNoWebsite)}
      </SecretSlot>
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsUsername)}
        copy={copies.field(CopyField.Username)}
      >
        {item.username || vault.t(I18N_KEYS.VaultFieldsNoUsername)}
      </SecretSlot>
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsPassword)}
        seal={secretSeal}
        width={SlotWidth.Full}
        copy={copies.secret(I18N_KEYS.VaultCopySecret)}
      >
        <code data-testid="revealed-secret"
          >{reveal.kind === SecretRevealKind.Revealed
            ? reveal.record.password
            : MASK}</code
        >
        {#snippet extra()}
          {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.password}
            <SecretStrengthMeter value={reveal.record.password} {vault} />
          {/if}
        {/snippet}
      </SecretSlot>
      {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.notes}
        <SecretSlot
          label={vault.t(I18N_KEYS.VaultFieldsNotes)}
          width={SlotWidth.Full}
        >
          <span class="whitespace-pre-wrap text-sm">{reveal.record.notes}</span>
        </SecretSlot>
      {/if}
    {:else if item.type === SecretType.ApiKey}
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsWebsiteLabel)}
        copy={copies.field(CopyField.Website)}
      >
        {item.websiteUrl || vault.t(I18N_KEYS.VaultFieldsNoWebsite)}
      </SecretSlot>
      {#if item.expiresAt}
        <SecretSlot
          label={vault.t(I18N_KEYS.VaultFieldsExpiresAt)}
          mono
          copy={copies.field(CopyField.Expires)}
        >
          {item.expiresAt}
        </SecretSlot>
      {/if}
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsKey)}
        seal={secretSeal}
        width={SlotWidth.Full}
        copy={copies.secret(I18N_KEYS.VaultCopySecret)}
      >
        <code class="break-all" data-testid="revealed-secret"
          >{reveal.kind === SecretRevealKind.Revealed
            ? reveal.record.primaryCredential
            : MASK}</code
        >
        {#snippet extra()}
          {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.primaryCredential}
            <SecretStrengthMeter
              value={reveal.record.primaryCredential}
              {vault}
            />
          {/if}
        {/snippet}
      </SecretSlot>
    {:else if item.type === SecretType.SeedPhrase}
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsAccount)}
        width={SlotWidth.Full}
        copy={copies.field(CopyField.AccountName)}
      >
        {item.name || vault.t(I18N_KEYS.VaultFieldsNoAccountName)}
      </SecretSlot>
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultTypesSeedPhrase)}
        seal={secretSeal}
        width={SlotWidth.Full}
        copy={copies.secret(I18N_KEYS.VaultCopySecret)}
      >
        {#if reveal.kind === SecretRevealKind.Revealed}
          <ol class="nk-words" data-testid="seed-phrase-grid">
            {#each reveal.record.seed.trim().split(/\s+/) as word, index (index)}
              <li>
                <i>{index + 1}</i><b data-testid="seed-word-{index + 1}"
                  >{word}</b
                >
              </li>
            {/each}
          </ol>
        {:else if item.seedWordCount > 0}
          <ol
            class="nk-words text-muted-foreground"
            data-testid="seed-phrase-grid"
          >
            {#each Array.from(Array(item.seedWordCount).keys()) as index (index)}
              <li>
                <i>{index + 1}</i><b data-testid="seed-word-{index + 1}"
                  >••••</b
                >
              </li>
            {/each}
          </ol>
        {:else}
          <span data-testid="revealed-secret">{MASK}</span>
        {/if}
      </SecretSlot>
    {:else if item.type === SecretType.Authenticator}
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsCurrentCode)}
        width={SlotWidth.Full}
        seal={authenticatorCode.kind ===
        AuthenticatorCodePresentationKind.Visible
          ? SlotSeal.Open
          : SlotSeal.Sealed}
        copy={copies.field(CopyField.CurrentCode)}
      >
        <span
          class="text-2xl font-semibold tracking-[0.2em] tabular-nums"
          data-testid="authenticator-current-code"
          data-period={authenticatorCode.kind ===
          AuthenticatorCodePresentationKind.Visible
            ? authenticatorCode.code.period
            : 0}
          >{authenticatorCode.kind === AuthenticatorCodePresentationKind.Visible
            ? authenticatorCode.code.code
            : "••••••"}</span
        >
        {#snippet extra()}
          {#if codeExpiry}
            <span class="nk-tag">{codeExpiry}</span>
          {/if}
        {/snippet}
      </SecretSlot>
      <SecretSlot label={vault.t(I18N_KEYS.VaultFieldsAccount)}>
        {item.account || vault.t(I18N_KEYS.CommonNone)}
      </SecretSlot>
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsWebsiteLabel)}
        copy={copies.field(CopyField.Website)}
        testId="authenticator-website"
      >
        {item.websiteUrl || vault.t(I18N_KEYS.VaultFieldsNoWebsite)}
      </SecretSlot>
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsAuthenticatorSecret)}
        seal={secretSeal}
        width={SlotWidth.Full}
        copy={copies.secret(I18N_KEYS.VaultCopyAuthenticatorSecret)}
      >
        <code class="break-all" data-testid="revealed-secret"
          >{reveal.kind === SecretRevealKind.Revealed
            ? reveal.record.totpSecret
            : MASK}</code
        >
      </SecretSlot>
      {#if item.backupCodeCount > 0}
        <SecretSlot
          label={vault.t(I18N_KEYS.VaultFieldsBackupCodes)}
          seal={secretSeal}
          width={SlotWidth.Full}
          testId="authenticator-backup-codes"
        >
          {#if reveal.kind === SecretRevealKind.Revealed}
            {#if reveal.record.backupCodes.length > 0}
              <ul class="grid gap-1 sm:grid-cols-2">
                {#each reveal.record.backupCodes as backupCode, backupIndex (`${backupCode}-${backupIndex}`)}
                  {@const backupCopy = copies.backup(backupIndex)}
                  <li
                    class="flex items-center justify-between gap-2 border-b border-dotted border-border py-0.5"
                  >
                    <code class="break-all">{backupCode}</code>
                    {#if backupCopy.kind === SlotCopyKind.Available}
                      <button
                        type="button"
                        class="nk-icon-btn size-7"
                        aria-label={backupCopy.label}
                        title={backupCopy.label}
                        onclick={backupCopy.onCopy}
                      >
                        {#if backupCopy.copied}<Check
                            class="size-3.5 text-success"
                          />{:else}<Copy class="size-3.5" />{/if}
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <span class="text-muted-foreground"
                >{vault.t(I18N_KEYS.CommonNone)}</span
              >
            {/if}
          {:else}
            <span>••••••••</span>
          {/if}
        </SecretSlot>
      {/if}
    {:else if item.type === SecretType.Passkey}
      <SecretSlot label={vault.t(I18N_KEYS.VaultFieldsRelyingParty)}>
        {item.rpId}
      </SecretSlot>
      <SecretSlot label={vault.t(I18N_KEYS.VaultFieldsAccount)}>
        {item.passkeyUserDisplayName ||
          item.passkeyUserName ||
          vault.t(I18N_KEYS.CommonNone)}
      </SecretSlot>
      <PasskeyDetailSlots
        presentation={passkeyDetails}
        history={secretHistory}
        {copies}
        {vault}
      />
    {:else if item.type === SecretType.CreditCard}
      <SecretSlot label={vault.t(I18N_KEYS.VaultFieldsTitle)}>
        {item.title.trim() || vault.t(I18N_KEYS.VaultFieldsUnnamedCard)}
      </SecretSlot>
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsCardholderName)}
        copy={copies.field(CopyField.Cardholder)}
      >
        {item.cardholderName.trim() || vault.t(I18N_KEYS.CommonNone)}
      </SecretSlot>
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsCardNumber)}
        seal={secretSeal}
        width={SlotWidth.Full}
        copy={copies.field(CopyField.CardNumber)}
      >
        <code data-testid="credit-card-number-value"
          >{reveal.kind === SecretRevealKind.Revealed
            ? reveal.record.cardNumber
            : item.last4.trim()
              ? `•••• ${item.last4}`
              : MASK}</code
        >
      </SecretSlot>
      {#if cardExpiration}
        <SecretSlot
          label={vault.t(I18N_KEYS.VaultFieldsExpiration)}
          mono
          copy={copies.field(CopyField.Expiration)}
        >
          {cardExpiration}
        </SecretSlot>
      {/if}
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsCvv)}
        seal={secretSeal}
        copy={copies.field(CopyField.Cvv)}
      >
        <code data-testid="credit-card-cvv-value"
          >{reveal.kind === SecretRevealKind.Revealed
            ? reveal.record.cvv || vault.t(I18N_KEYS.CommonNone)
            : "•••"}</code
        >
      </SecretSlot>
      {#if reveal.kind === SecretRevealKind.Revealed && reveal.record.notes}
        <SecretSlot
          label={vault.t(I18N_KEYS.VaultFieldsNotes)}
          width={SlotWidth.Full}
        >
          <span class="whitespace-pre-wrap text-sm">{reveal.record.notes}</span>
        </SecretSlot>
      {/if}
    {:else if item.type === SecretType.FileAttachment}
      <SecretSlot label={vault.t(I18N_KEYS.VaultFieldsFileName)}>
        <span data-testid="file-attachment-name"
          >{item.fileName || vault.t(I18N_KEYS.VaultFieldsNoTitle)}</span
        >
      </SecretSlot>
      <SecretSlot label={vault.t(I18N_KEYS.VaultFieldsFileSize)} mono>
        <span data-testid="file-attachment-size"
          >{formatFileSize(item.sizeBytes)}</span
        >
      </SecretSlot>
      {#if item.mimeType}
        <SecretSlot
          label={vault.t(I18N_KEYS.VaultFieldsMimeType)}
          mono
          width={SlotWidth.Full}
        >
          {item.mimeType}
        </SecretSlot>
      {/if}
      <div class="col-span-full flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          data-testid="download-file-attachment-btn"
          disabled={!revealed}
          onclick={downloadFileAttachment}
        >
          <Download class="size-3.5" />
          {vault.t(I18N_KEYS.VaultDownloadFile)}
        </Button>
        {#if !revealed}
          <span class="text-xs text-muted-foreground">
            {vault.t(I18N_KEYS.VaultRevealToDownload)}
          </span>
        {/if}
      </div>
    {:else}
      <SecretSlot
        label={vault.t(I18N_KEYS.VaultFieldsNote)}
        seal={secretSeal}
        width={SlotWidth.Full}
        copy={copies.secret(I18N_KEYS.VaultCopyNote)}
      >
        {#if reveal.kind === SecretRevealKind.Revealed}
          <div
            class="min-w-0 font-sans text-sm leading-relaxed"
            data-testid="revealed-secret"
          >
            <MarkdownContent source={reveal.record.note} />
          </div>
        {:else}
          <span data-testid="revealed-secret">{MASK}</span>
        {/if}
      </SecretSlot>
    {/if}
  </div>
</section>

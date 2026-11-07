import { err, ok, type Result } from "neverthrow";
import {
  list_s3_vaults,
  provider_draft_credential_readiness,
  provider_failure_translation_key,
  type NookProviderSource,
  type LocalFolderHandleId,
  type NookRemoteSource,
  type S3Connection,
  type ProviderDraft,
  type ProviderIdentityChoice,
} from "$app-wasm";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import {
  listedVaults,
  type ListedVaults,
} from "$lib/components/provider-vaults/drive-vault-inventory";
import { IdentityDecisionText } from "$lib/components/provider-vaults/identity-plan.svelte";
import { ProviderSetupKinds } from "$lib/vault/provider-setup-kinds";
import {
  DraftDriveSignInKind,
  DraftS3ConnectionKind,
  ProviderDraftReads,
  S3DraftReads,
} from "$lib/vault/provider-draft-reads";
import type { VaultState } from "$lib/vault.svelte";
import {
  FirstRunJoinKind,
  type IdentityJoinIntent,
} from "$lib/vault/identity-join-wait";
import {
  IdentityJoinActions,
  IdentityJoinAsked,
  IdentityPlanActions,
  IdentityPlanFailure,
  IdentityPlanFailureKind,
  type IdentityPlanRun,
} from "$lib/vault/identity-plan-actions";
import { VaultOAuthActions } from "$lib/vault/oauth";
import { ProviderVaultActions } from "$lib/vault/provider-vaults";
import {
  FirstRunPlace,
  FirstRunStage,
  FirstRunSyncSource,
  WorkspaceSection,
} from "$lib/vault/state/ui.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** Where first run lists keyrings from: the signed-in Google account, or an
 * S3 location, which is staged only once it lists. */
export type FirstRunProviderSource = Exclude<
  NookRemoteSource,
  { readonly handleId: LocalFolderHandleId }
>;

export enum FirstRunS3LocationKind {
  /** The picked provider is not a listed S3 location. */
  Absent = "absent",
  Shown = "shown",
}

/** The S3 location the Sync step names once it listed. */
export type FirstRunS3Location =
  | { readonly kind: FirstRunS3LocationKind.Absent }
  | {
      readonly kind: FirstRunS3LocationKind.Shown;
      readonly configuration: S3Connection;
    };

export enum FirstRunConnectionKind {
  NotConnected = "not-connected",
  Connected = "connected",
}

/** Whether the provider picked last can list: Google Drive once signed in,
 * S3 once its form connected. */
export type FirstRunConnection =
  | { readonly kind: FirstRunConnectionKind.NotConnected }
  | {
      readonly kind: FirstRunConnectionKind.Connected;
      readonly source: FirstRunProviderSource;
    };

export enum FirstRunInventoryKind {
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

/** One read of the sync provider's keyrings. */
export type FirstRunVaultRead =
  | {
      readonly kind: FirstRunInventoryKind.Loaded;
      readonly listing: ListedVaults;
    }
  | {
      readonly kind: FirstRunInventoryKind.Failed;
      /** Why, in the user's words: a message key Rust or the step picked. */
      readonly failure: string;
    };

/** What the Sync step knows about the sync provider's keyrings. */
export type FirstRunInventory =
  { readonly kind: FirstRunInventoryKind.Loading } | FirstRunVaultRead;

/** One identity a sync provider holds, and the provider it was read from. */
export type FirstRunIdentity = {
  readonly choice: ProviderIdentityChoice;
  readonly source: NookProviderSource;
};

/** The one action setup offers for an identity. */
export enum FirstRunIdentityAction {
  /** This browser's key is a member: bring the identity here and sync. */
  Continue = "continue",
  /** Not a member: ask its devices to let this browser in. */
  AskToJoin = "ask-to-join",
  /** A join was asked before: read its answer. */
  CheckJoin = "check-join",
}

/** An action picked for one listed identity. */
export type FirstRunIdentityRun = FirstRunIdentity & {
  readonly action: FirstRunIdentityAction;
};

/** The fresh identity took its name. */
enum FirstRunNamingOutcome {
  Named = "named",
}

/** The identity could not be named. */
class FirstRunNamingFailure {
  readonly translationKey = I18N_KEYS.FirstRunNameFailed;
}

/** The provider the new identity was named on, staged before its vault
 * was made on this browser. */
type FirstRunStagedProvider = {
  readonly source: FirstRunSyncSource;
  readonly draft: ProviderDraft;
};

/** Whether the named identity's provider is staged again to connect. */
enum FirstRunRestage {
  Staged = "staged",
  NothingStaged = "nothing-staged",
}

/** What connecting needed before the provider is saved. */
enum FirstRunProviderBinding {
  /** Google Drive's Nook folder is opened or created. */
  FolderBound = "folder-bound",
  /** An S3 location names everything already. */
  NothingToBind = "nothing-to-bind",
}

/** What the provider a keyring was just brought here through needs before
 * it is saved. */
export enum ProviderFolderBinding {
  /** Google Drive opens or creates its Nook folder. */
  DriveFolder = "drive-folder",
  /** An S3 location, a repository, or a picked folder names it already. */
  Named = "named",
}

/**
 * First-run setup, identity first: the passkey makes this browser's key, the
 * sync provider shows the identities that key is a member of or may join,
 * and a new identity kept on this browser asks whether to create its first
 * vault. Rust decides each identity's one setup action; this class runs it.
 */
export class FirstRunActions {
  constructor(private readonly vault: VaultState) {}

  /** The device key is ready. During first run it only makes the identity's
   * key, and setup moves on to the sync provider; outside setup it creates
   * the vault as before. A key that becomes ready again while setup is past
   * it changes nothing: the vault waits for the identity. */
  async createWithDeviceKeys(label: string): Promise<void> {
    const vault = this.vault;
    switch (vault.firstRun) {
      case FirstRunStage.Off:
      case FirstRunStage.Connect:
        await vault.createLocalVaultWithDeviceKeys(label);
        return;
      case FirstRunStage.Sync:
      case FirstRunStage.Name:
      case FirstRunStage.Vault:
      case FirstRunStage.Joining:
        return;
      case FirstRunStage.Protect:
        break;
    }
    const initialized = await vault.initDeviceIdentity();
    if (initialized.isErr()) {
      vault.errorMsg = vault.t(initialized.error.translationKey);
      vault.firstRun = FirstRunStage.Off;
      return;
    }
    vault.firstRun = FirstRunStage.Sync;
  }

  /** Stage Google Drive, ready for its sign-in. */
  beginGoogleDrive(): void {
    this.vault.beginProviderSetup(ProviderSetupKinds.GOOGLE_DRIVE);
    this.vault.firstRunSyncSource = FirstRunSyncSource.GoogleDrive;
  }

  /** Stage S3 in place of Google Drive; its form supplies the connection. */
  beginS3(): void {
    this.vault.beginProviderSetup(ProviderSetupKinds.S3);
    this.vault.firstRunSyncSource = FirstRunSyncSource.S3;
  }

  /** Stage Google Drive when the step opens, unless the draft already is
   * the picked source's: Back keeps a staged S3 location or Drive sign-in. */
  stageOnEntry(): void {
    switch (this.vault.providerDraft.type) {
      case "s3":
      case "oauth-file":
        return;
      case "local":
      case "local-folder":
      case "github":
        this.beginGoogleDrive();
    }
  }

  /** The listed S3 location the connection reads from, if it is one. */
  static s3Location(connection: FirstRunConnection): FirstRunS3Location {
    switch (connection.kind) {
      case FirstRunConnectionKind.NotConnected:
        return { kind: FirstRunS3LocationKind.Absent };
      case FirstRunConnectionKind.Connected:
        return FirstRunActions.listedS3(connection.source);
    }
  }

  private static listedS3(source: FirstRunProviderSource): FirstRunS3Location {
    switch (source.kind) {
      case "s3":
        return {
          kind: FirstRunS3LocationKind.Shown,
          configuration: source.configuration,
        };
      case "googleDrive":
        return { kind: FirstRunS3LocationKind.Absent };
    }
  }

  /** The source the picked provider lists from, read from the draft. */
  connection(): FirstRunConnection {
    const draft = this.vault.providerDraft;
    switch (this.syncSource()) {
      case FirstRunSyncSource.GoogleDrive:
        return FirstRunActions.driveConnection(draft);
      case FirstRunSyncSource.S3:
        return FirstRunActions.s3Connection(draft);
    }
  }

  private static driveConnection(draft: ProviderDraft): FirstRunConnection {
    const signIn = ProviderDraftReads.driveSignIn(draft);
    switch (signIn.kind) {
      case DraftDriveSignInKind.SignedIn:
        return {
          kind: FirstRunConnectionKind.Connected,
          source: {
            kind: "googleDrive",
            accessToken: signIn.access.authorization.accessToken,
          },
        };
      case DraftDriveSignInKind.NotSignedIn:
        return { kind: FirstRunConnectionKind.NotConnected };
    }
  }

  private static s3Connection(draft: ProviderDraft): FirstRunConnection {
    const s3 = S3DraftReads.connection(draft);
    switch (s3.kind) {
      case DraftS3ConnectionKind.Ready:
        return {
          kind: FirstRunConnectionKind.Connected,
          source: { kind: "s3", configuration: s3.connection },
        };
      case DraftS3ConnectionKind.NotReady:
        return { kind: FirstRunConnectionKind.NotConnected };
    }
  }

  /** The provider picked last: S3 once its row was picked, Google Drive
   * otherwise. It stays picked after the save, so a retried connect runs
   * on the same provider. */
  syncSource(): FirstRunSyncSource {
    return this.vault.firstRunSyncSource;
  }

  /** The keyrings a sync provider holds, read without saving or connecting
   * it. Google Drive reads with the staged sign-in the source's token comes
   * from. An S3 key the server refuses says so; Rust reads the refusal. */
  async listVaults(source: FirstRunProviderSource): Promise<FirstRunVaultRead> {
    const vault = this.vault;
    const localVault = new ProviderVaultActions(vault).localVaultOccupancy();
    switch (source.kind) {
      case "googleDrive": {
        const listed = await new VaultOAuthActions(vault).listGoogleDriveVaults(
          localVault,
        );
        if (listed.isErr())
          return {
            kind: FirstRunInventoryKind.Failed,
            failure: listed.error.translationKey,
          };
        return {
          kind: FirstRunInventoryKind.Loaded,
          listing: listedVaults(listed.value),
        };
      }
      case "s3":
        try {
          const listing = await list_s3_vaults(
            source.configuration,
            localVault,
          );
          return { kind: FirstRunInventoryKind.Loaded, listing };
        } catch (cause) {
          const keyRequest: Parameters<
            typeof provider_failure_translation_key
          >[0] = {
            message: cause instanceof Error ? cause.message : String(cause),
            operationFailedKey: I18N_KEYS.ProviderSetupS3ListFailed,
          };
          return {
            kind: FirstRunInventoryKind.Failed,
            failure: provider_failure_translation_key(keyRequest),
          };
        }
    }
  }

  /** Name a new identity next: on the signed-in sync provider, or on this
   * browser only. */
  nameNew(place: FirstRunPlace): void {
    const vault = this.vault;
    if (place === FirstRunPlace.ThisBrowser) vault.cancelProviderSetup();
    vault.firstRunPlace = place;
    vault.firstRun = FirstRunStage.Name;
  }

  /** Back from naming or a join to the sync provider's identities. */
  backToSync(): void {
    const vault = this.vault;
    vault.firstRunJoin = { kind: FirstRunJoinKind.None };
    vault.firstRun = FirstRunStage.Sync;
  }

  /** Name the new identity. Kept on this browser, it then asks whether to
   * create a first vault. On the sync provider it creates that vault at
   * once: the signed-in provider stays staged, so the vault connects it next
   * without another sign-in. */
  async createNamed(name: string): Promise<void> {
    const vault = this.vault;
    const label = name.trim();
    if (!label) return;
    const named = await this.nameIdentity(label);
    if (named.isErr()) {
      vault.errorMsg = vault.t(named.error.translationKey);
      return;
    }
    if (vault.firstRunPlace === FirstRunPlace.ThisBrowser) {
      vault.firstRun = FirstRunStage.Vault;
      return;
    }
    const staged: FirstRunStagedProvider = {
      source: this.syncSource(),
      draft: vault.providerDraft,
    };
    vault.firstRunVaultName = label;
    // The vault is made on this browser first. A sign-in still staged would
    // be saved with it as a Google Drive provider without its Nook folder,
    // which no sync can use; it is staged again below to connect with one.
    vault.cancelProviderSetup();
    await vault.createLocalVaultWithDeviceKeys(label);
    if (!vault.isAuthenticated) return;
    if (
      vault.firstRunPlace === FirstRunPlace.SyncProvider &&
      this.restage(staged) === FirstRunRestage.Staged
    ) {
      vault.firstRun = FirstRunStage.Connect;
      return;
    }
    vault.firstRun = FirstRunStage.Off;
  }

  /** Stage the provider the identity was named on again, so the Connect
   * step connects it without another sign-in or form. */
  private restage(staged: FirstRunStagedProvider): FirstRunRestage {
    switch (provider_draft_credential_readiness(staged.draft).state) {
      case "required":
        return FirstRunRestage.NothingStaged;
      case "ready":
        break;
    }
    switch (staged.source) {
      case FirstRunSyncSource.GoogleDrive:
        this.beginGoogleDrive();
        break;
      case FirstRunSyncSource.S3:
        this.beginS3();
        break;
    }
    this.vault.stageProviderDraft(staged.draft);
    return FirstRunRestage.Staged;
  }

  /** The identity kept on this browser gets its first vault, named here. */
  async createFirstVault(name: string): Promise<void> {
    const vault = this.vault;
    const label = name.trim();
    if (!label) return;
    vault.firstRunVaultName = label;
    await vault.createLocalVaultWithDeviceKeys(label);
    if (vault.isAuthenticated) vault.firstRun = FirstRunStage.Off;
  }

  /** The identity stays on this browser without a vault; its card offers
   * New vault whenever one is wanted. */
  skipFirstVault(): void {
    this.vault.firstRun = FirstRunStage.Off;
  }

  /** Run the action picked for one listed identity. */
  async runOn(run: FirstRunIdentityRun): Promise<void> {
    switch (run.action) {
      case FirstRunIdentityAction.Continue:
        return this.continueOn(run);
      case FirstRunIdentityAction.AskToJoin:
        return this.askToJoin(run);
      case FirstRunIdentityAction.CheckJoin:
        return this.resumeJoin(run);
    }
  }

  /** Continue on an identity this browser's key is a member of: bring it
   * here, then connect the sync provider and sync its events. */
  async continueOn({ choice, source }: FirstRunIdentity): Promise<void> {
    const vault = this.vault;
    if (choice.setup.kind !== "continue") return;
    const run: IdentityPlanRun = {
      source,
      planned: [{ choice, decision: choice.setup.decision }],
    };
    const ran = await new IdentityPlanActions(vault).run(run);
    if (ran.isErr()) {
      vault.errorMsg = ran.error.message(vault);
      return;
    }
    await this.connectProvider();
  }

  /** Ask to join an identity this browser's key is not a member of. The
   * key is fresh, so it asks at once; setup then waits for an answer. */
  async askToJoin(identity: FirstRunIdentity): Promise<void> {
    const vault = this.vault;
    const join = this.intent(identity);
    const asked = await new IdentityJoinActions(vault).ask(join);
    if (asked.isErr()) {
      vault.errorMsg = asked.error.message(vault);
      return;
    }
    if (asked.value !== IdentityJoinAsked.Requested) {
      // Setup asks only with a fresh key; say why this one cannot.
      const failure = new IdentityPlanFailure(
        IdentityPlanFailureKind.Join,
      ).because(
        asked.value === IdentityJoinAsked.WaitsForDevice
          ? I18N_KEYS.ErrorsIdentityJoinPasskeyLocked
          : I18N_KEYS.ErrorsIdentityJoinPasskeyInUse,
      );
      vault.errorMsg = failure.message(vault);
      return;
    }
    vault.firstRunJoin = { kind: FirstRunJoinKind.Asked, join };
    vault.firstRun = FirstRunStage.Joining;
  }

  /** Join an identity with one of its recovery passphrases instead of
   * asking its devices: setup shows the passphrase step for it. */
  recover(identity: FirstRunIdentity): void {
    const vault = this.vault;
    vault.firstRunJoin = {
      kind: FirstRunJoinKind.Recovering,
      join: this.intent(identity),
    };
    vault.firstRun = FirstRunStage.Joining;
  }

  /** A join asked before this page, as after a reload: wait on it again and
   * read its answer at once. */
  async resumeJoin(identity: FirstRunIdentity): Promise<void> {
    const vault = this.vault;
    vault.firstRunJoin = {
      kind: FirstRunJoinKind.Asked,
      join: this.intent(identity),
    };
    vault.firstRun = FirstRunStage.Joining;
    await this.checkJoin();
  }

  /** Read the identity's log again. Approved finishes the join and sets the
   * identity up here; pending or denied says so and changes nothing. */
  async checkJoin(): Promise<void> {
    const vault = this.vault;
    const waiting = vault.firstRunJoin;
    if (waiting.kind !== FirstRunJoinKind.Asked) return;
    const finished = await new IdentityJoinActions(vault).finish(waiting.join);
    if (finished.isErr()) {
      vault.errorMsg = finished.error.message(vault);
      return;
    }
    vault.firstRunJoin = { kind: FirstRunJoinKind.None };
    await this.connectProvider();
  }

  /** The identity just brought here keeps the provider: bind its Nook
   * folder, save it, and copy the identity's log there. Then a vault the
   * identity granted this browser opens through it, as after an invite:
   * each vault is its own folder under the Nook folder, so it opens by its
   * id. Setup then ends on the identities page, not inside the vault: the
   * identity's card, with the vault's panel beside it, shows what there is
   * to do next (its pages, Import, the identity's own management). A step
   * that fails keeps setup where it is, with its error. */
  async connectProvider(): Promise<boolean> {
    switch (this.syncSource()) {
      case FirstRunSyncSource.GoogleDrive:
        return this.connectProviderWith(ProviderFolderBinding.DriveFolder);
      case FirstRunSyncSource.S3:
        return this.connectProviderWith(ProviderFolderBinding.Named);
    }
  }

  /** Connect the provider a keyring was just brought here through, outside
   * setup too: the recovery screen ends a passphrase recovery the same way.
   * The binding says whether its folder is opened first. */
  async connectProviderWith(binding: ProviderFolderBinding): Promise<boolean> {
    const vault = this.vault;
    vault.errorMsg = "";
    const bound = await this.bindProvider(binding);
    if (bound.isErr()) {
      vault.errorMsg = vault.t(bound.error.translationKey);
      return false;
    }
    const saved = await vault.ensureProviderSaved();
    if (saved.isErr()) {
      vault.errorMsg = vault.t(saved.error.translationKey);
      return false;
    }
    const mounted = await vault.identityControl.syncWithMounts();
    if (mounted.isErr()) {
      vault.errorMsg = vault.t(mounted.error.translationKey);
      return false;
    }
    const away = vault.identityControl.grantedVaultElsewhere();
    if (away !== false) {
      const opened = await vault.identityControl.openVault(away.storeId);
      if (opened.isErr()) {
        vault.errorMsg = vault.t(opened.error.translationKey);
        return false;
      }
    }
    vault.firstRun = FirstRunStage.Off;
    vault.openSection(WorkspaceSection.Identities);
    if (away !== false) vault.vaultPanelStoreId = away.storeId;
    return true;
  }

  /** Google Drive opens or creates its Nook folder before the provider is
   * saved; an S3 location names everything already. */
  private async bindProvider(
    binding: ProviderFolderBinding,
  ): Promise<Result<FirstRunProviderBinding, OAuthFailure>> {
    switch (binding) {
      case ProviderFolderBinding.DriveFolder: {
        const folder = await new VaultOAuthActions(
          this.vault,
        ).connectGoogleVaultFolder();
        return folder.map(() => FirstRunProviderBinding.FolderBound);
      }
      case ProviderFolderBinding.Named:
        return ok(FirstRunProviderBinding.NothingToBind);
    }
  }

  private intent({ choice, source }: FirstRunIdentity): IdentityJoinIntent {
    return {
      source,
      identityId: choice.identity.identityId,
      label: new IdentityDecisionText(this.vault).name(choice),
    };
  }

  /** Give this browser's still-fresh identity its name, before its log
   * exists to seal it. */
  private async nameIdentity(
    label: string,
  ): Promise<Result<FirstRunNamingOutcome, FirstRunNamingFailure>> {
    const vault = this.vault;
    const ran = await vault.enqueueStorage<
      FirstRunNamingOutcome,
      FirstRunNamingFailure
    >(async () => {
      const admitted = vault.admitManager();
      if (admitted.isErr()) return err(new FirstRunNamingFailure());
      try {
        await admitted.value.name_fresh_identity(label);
        return ok(FirstRunNamingOutcome.Named);
      } catch {
        return err(new FirstRunNamingFailure());
      }
    });
    return ran.mapErr(() => new FirstRunNamingFailure());
  }
}

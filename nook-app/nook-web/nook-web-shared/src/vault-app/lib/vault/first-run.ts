import { err, ok, type Result } from "neverthrow";
import type {
  NookFreshIdentityNaming,
  NookProviderSource,
  ProviderIdentityChoice,
} from "$app-wasm";
import {
  GOOGLE_DRIVE_OAUTH_FILE_PRESET,
  OAUTH_FILE_PROVIDER_TYPE,
  type ProviderSetupRequest,
} from "$lib/auth/providers";
import { IdentityDecisionText } from "$lib/components/provider-vaults/identity-plan.svelte";
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
import { OAuthFileDraftKind } from "$lib/vault/state/provider.svelte";
import {
  FirstRunPlace,
  FirstRunStage,
  WorkspaceSection,
} from "$lib/vault/state/ui.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

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

/** The identity could not be named. */
class FirstRunNamingFailure {
  readonly translationKey = I18N_KEYS.FirstRunNameFailed;
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
   * it (an extension's key arrives once its approval and its queued request
   * both land) changes nothing: the vault waits for the identity. */
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
    const request: ProviderSetupRequest = {
      type: OAUTH_FILE_PROVIDER_TYPE,
      oauthPreset: GOOGLE_DRIVE_OAUTH_FILE_PRESET,
    };
    this.vault.beginProviderSetup(request);
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
   * without another sign-in. A key the extension lends has no identity until
   * its first vault, which is created at once as well. */
  async createNamed(name: string): Promise<void> {
    const vault = this.vault;
    const label = name.trim();
    if (!label) return;
    const named = await this.nameIdentity(label);
    if (named.isErr()) {
      vault.errorMsg = vault.t(named.error.translationKey);
      return;
    }
    if (
      vault.firstRunPlace === FirstRunPlace.ThisBrowser &&
      this.existsHere(named.value)
    ) {
      vault.firstRun = FirstRunStage.Vault;
      return;
    }
    const draft = vault.oauthFileDraft;
    vault.firstRunVaultName = label;
    // The vault is made on this browser first. A sign-in still staged would
    // be saved with it as a Google Drive provider without its Nook folder,
    // which no sync can use; it is staged again below to connect with one.
    vault.cancelProviderSetup();
    await vault.createLocalVaultWithDeviceKeys(label);
    if (!vault.isAuthenticated) return;
    if (
      vault.firstRunPlace === FirstRunPlace.SyncProvider &&
      draft.kind === OAuthFileDraftKind.Configured
    ) {
      this.beginGoogleDrive();
      vault.configureOauthFile(draft.config);
      vault.firstRun = FirstRunStage.Connect;
      return;
    }
    vault.firstRun = FirstRunStage.Off;
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
    if (choice.setup.decision !== "leave") {
      const run: IdentityPlanRun = {
        source,
        planned: [{ choice, decision: choice.setup.decision }],
      };
      const ran = await new IdentityPlanActions(vault).run(run);
      if (ran.isErr()) {
        vault.errorMsg = ran.error.message(vault);
        return;
      }
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
    const vault = this.vault;
    vault.errorMsg = "";
    const folder = await new VaultOAuthActions(
      vault,
    ).connectGoogleVaultFolder();
    if (folder.isErr()) {
      vault.errorMsg = vault.t(folder.error.translationKey);
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
  ): Promise<Result<NookFreshIdentityNaming, FirstRunNamingFailure>> {
    const vault = this.vault;
    const ran = await vault.enqueueStorage<
      NookFreshIdentityNaming,
      FirstRunNamingFailure
    >(async () => {
      const admitted = vault.admitManager();
      if (admitted.isErr()) return err(new FirstRunNamingFailure());
      try {
        return ok(await admitted.value.name_fresh_identity(label));
      } catch {
        return err(new FirstRunNamingFailure());
      }
    });
    return ran.mapErr(() => new FirstRunNamingFailure());
  }

  /** Whether the named identity exists on this browser already, so it can
   * stay without a vault. */
  private existsHere(naming: NookFreshIdentityNaming): boolean {
    switch (naming.state) {
      case "named":
        return true;
      case "atFirstVault":
        return false;
    }
  }
}

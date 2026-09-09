import { err, ok, type Result } from 'neverthrow'
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from '$lib/runtime/storage-failure'
import {
  type DeviceAccessProtectionKind,
  type NookDeviceAccessSnapshot,
  type NookDeviceAccessText,
  type NookDeviceVaultAccess,
  NookIdentityDirectorySelectionKind,
  type NookIdentityLocalAccessKind,
  NookIdentityMemberLabelKind,
  type NookIdentityMemberSnapshot,
  type NookIdentitySnapshot,
  type NookPasskeyTimestampEvidence,
  NookPasskeyTimestampEvidenceKind,
  type NookVaultManager,
  NookDeviceAccessTextKind,
  NookDeviceVaultAccessState,
} from '$app-wasm'
import {
  type DashboardTimestamp,
  DashboardTimestampKind,
  type DashboardText,
  KnownDashboardText,
  UnknownDashboardText,
  type DashboardView,
} from '../devices-access-dashboard-state'
import type { VaultAccessView } from './access-chain'

export enum IdentityDirectoryLoadKind {
  Loading = 'loading',
  Failed = 'failed',
  Ready = 'ready',
}

export enum IdentityDirectorySelectionKind {
  Empty = 'empty',
  Selected = 'selected',
}

export type IdentityMemberView = {
  readonly appId: string
  readonly label: DashboardText
  readonly currentBrowser: boolean
  readonly localProtection: DeviceAccessProtectionKind
}

export type IdentityDirectoryEntry = {
  readonly identityId: string
  readonly label: string
  readonly localAccess: NookIdentityLocalAccessKind
  readonly members: readonly IdentityMemberView[]
  readonly vaults: readonly VaultAccessView[]
}

export type IdentityDirectorySelection =
  | { readonly kind: IdentityDirectorySelectionKind.Empty }
  | {
      readonly kind: IdentityDirectorySelectionKind.Selected
      readonly identityId: string
    }

export type SelectedIdentityEntry =
  | { readonly kind: IdentityDirectorySelectionKind.Empty }
  | {
      readonly kind: IdentityDirectorySelectionKind.Selected
      readonly identity: IdentityDirectoryEntry
    }

export type IdentityDirectoryView = {
  readonly identities: readonly IdentityDirectoryEntry[]
  readonly selection: IdentityDirectorySelection
}

export type IdentityDirectoryAccessView = {
  readonly directory: IdentityDirectoryView
  readonly access: DashboardView
}

export type IdentityDirectoryLoadState =
  | { readonly kind: IdentityDirectoryLoadKind.Loading }
  | { readonly kind: IdentityDirectoryLoadKind.Failed }
  | {
      readonly kind: IdentityDirectoryLoadKind.Ready
      readonly view: IdentityDirectoryView
    }

export class IdentityDirectoryReader {
  constructor(private readonly manager: NookVaultManager) {}
  async load(): Promise<Result<IdentityDirectoryAccessView, VaultStorageFailure>> {
    let request: ReturnType<NookVaultManager['identity_directory_snapshot_request']>
    try {
      request = this.manager.identity_directory_snapshot_request()
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    }
    let snapshot: Awaited<ReturnType<typeof request.resolve>>
    try {
      snapshot = await request.resolve()
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      request.free()
    }
    try {
      const identities: IdentityDirectoryEntry[] = []
      for (let index = 0; index < snapshot.length; index += 1) {
        const identity = new NativeDirectoryIdentity(snapshot.identity(index)).read()
        if (identity.isErr()) return err(identity.error)
        identities.push(identity.value)
      }
      const selection: IdentityDirectorySelection =
        snapshot.selectionKind === NookIdentityDirectorySelectionKind.Selected
          ? {
              kind: IdentityDirectorySelectionKind.Selected,
              identityId: snapshot.selectedIdentityId,
            }
          : { kind: IdentityDirectorySelectionKind.Empty }
      const access = new NativeDeviceAccess(snapshot.device_access()).read()
      if (access.isErr()) return err(access.error)
      return ok({ directory: { identities, selection }, access: access.value })
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      snapshot.free()
    }
  }
}

export class IdentityDirectoryPresentation {
  constructor(private readonly directory: IdentityDirectoryView) {}
  selectedIdentity(): SelectedIdentityEntry {
    const directory = this.directory
    if (directory.selection.kind === IdentityDirectorySelectionKind.Empty)
      return { kind: IdentityDirectorySelectionKind.Empty }
    for (const identity of directory.identities) {
      if (identity.identityId === directory.selection.identityId)
        return { kind: IdentityDirectorySelectionKind.Selected, identity }
    }
    return { kind: IdentityDirectorySelectionKind.Empty }
  }
}

class NativeIdentityMember {
  constructor(private readonly member: NookIdentityMemberSnapshot) {}
  read(): Result<IdentityMemberView, VaultStorageFailure> {
    const member = this.member
    try {
      return ok({
        appId: member.appId,
        currentBrowser: member.currentBrowser,
        localProtection: member.localProtection,
        label:
          member.labelKind === NookIdentityMemberLabelKind.Known
            ? new KnownDashboardText(member.label())
            : new UnknownDashboardText(),
      })
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      member.free()
    }
  }
}
class NativeAccessText {
  constructor(private readonly value: NookDeviceAccessText) {}
  read(): Result<DashboardText, VaultStorageFailure> {
    try {
      return ok(
        this.value.kind === NookDeviceAccessTextKind.Known
          ? new KnownDashboardText(this.value.value())
          : new UnknownDashboardText(),
      )
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      this.value.free()
    }
  }
}
class NativeAccessTimestamp {
  constructor(private readonly value: NookPasskeyTimestampEvidence) {}
  read(): Result<DashboardTimestamp, VaultStorageFailure> {
    const value = this.value
    try {
      if (value.kind === NookPasskeyTimestampEvidenceKind.Known)
        return ok({ kind: DashboardTimestampKind.Known, value: value.value() })
      return ok(
        value.kind === NookPasskeyTimestampEvidenceKind.NotYetObserved
          ? { kind: DashboardTimestampKind.NotYetObserved }
          : { kind: DashboardTimestampKind.Unavailable },
      )
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      value.free()
    }
  }
}
class NativeVaultAccess {
  constructor(private readonly entry: NookDeviceVaultAccess) {}
  read(): Result<VaultAccessView, VaultStorageFailure> {
    const entry = this.entry
    try {
      const verifiedAt = new NativeAccessText(entry.verifiedAt).read()
      if (verifiedAt.isErr()) return err(verifiedAt.error)
      const updatedAt = new NativeAccessText(entry.lastLocalUpdateAt).read()
      if (updatedAt.isErr()) return err(updatedAt.error)
      return ok({
        storeId: entry.storeId,
        label: entry.label,
        verified: entry.accessState === NookDeviceVaultAccessState.Verified,
        verifiedAt: verifiedAt.value,
        lastLocalUpdateAt: updatedAt.value,
      })
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      entry.free()
    }
  }
}
class NativeVaultAccessList {
  constructor(private readonly entries: NookDeviceVaultAccess[]) {}
  read(): Result<VaultAccessView[], VaultStorageFailure> {
    const projected: VaultAccessView[] = []
    let consumed = 0
    try {
      for (const entry of this.entries) {
        consumed += 1
        const value = new NativeVaultAccess(entry).read()
        if (value.isErr()) return err(value.error)
        projected.push(value.value)
      }
      return ok(projected)
    } finally {
      for (const entry of this.entries.slice(consumed)) entry.free()
    }
  }
}
class NativeIdentityMembers {
  constructor(private readonly entries: NookIdentityMemberSnapshot[]) {}
  read(): Result<IdentityMemberView[], VaultStorageFailure> {
    const projected: IdentityMemberView[] = []
    let consumed = 0
    try {
      for (const entry of this.entries) {
        consumed += 1
        const value = new NativeIdentityMember(entry).read()
        if (value.isErr()) return err(value.error)
        projected.push(value.value)
      }
      return ok(projected)
    } finally {
      for (const entry of this.entries.slice(consumed)) entry.free()
    }
  }
}
class NativeDeviceAccess {
  constructor(private readonly snapshot: NookDeviceAccessSnapshot) {}
  read(): Result<DashboardView, VaultStorageFailure> {
    const snapshot = this.snapshot
    try {
      const deviceId = new NativeAccessText(snapshot.deviceId).read()
      if (deviceId.isErr()) return err(deviceId.error)
      const credentialId = new NativeAccessText(snapshot.credentialId).read()
      if (credentialId.isErr()) return err(credentialId.error)
      const passkeyName = new NativeAccessText(snapshot.passkeyName).read()
      if (passkeyName.isErr()) return err(passkeyName.error)
      const providerLabel = new NativeAccessText(snapshot.providerLabel).read()
      if (providerLabel.isErr()) return err(providerLabel.error)
      const createdAt = new NativeAccessTimestamp(snapshot.createdAt).read()
      if (createdAt.isErr()) return err(createdAt.error)
      const lastUsedAt = new NativeAccessTimestamp(snapshot.lastUsedAt).read()
      if (lastUsedAt.isErr()) return err(lastUsedAt.error)
      const vaults = new NativeVaultAccessList(snapshot.vaults()).read()
      if (vaults.isErr()) return err(vaults.error)
      return ok({
        protection: snapshot.protection,
        identityState: snapshot.identityState,
        deviceId: deviceId.value,
        credentialId: credentialId.value,
        passkeyName: passkeyName.value,
        providerLabel: providerLabel.value,
        createdAt: createdAt.value,
        lastUsedAt: lastUsedAt.value,
        keeper: snapshot.keeper,
        vaults: vaults.value,
      })
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      snapshot.free()
    }
  }
}
class NativeDirectoryIdentity {
  constructor(private readonly identity: NookIdentitySnapshot) {}
  read(): Result<IdentityDirectoryEntry, VaultStorageFailure> {
    const identity = this.identity
    try {
      const members = new NativeIdentityMembers(identity.members()).read()
      if (members.isErr()) return err(members.error)
      const vaults = new NativeVaultAccessList(identity.vaults()).read()
      if (vaults.isErr()) return err(vaults.error)
      return ok({
        identityId: identity.identityId,
        label: identity.label,
        localAccess: identity.localAccess,
        members: members.value,
        vaults: vaults.value,
      })
    } catch (failure) {
      return err(new NativeVaultStorageFailure(failure))
    } finally {
      identity.free()
    }
  }
}

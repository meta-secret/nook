import {
  apply_google_drive_sign_in,
  apply_icloud_sign_in,
  begin_provider_draft,
  bind_google_drive_folder,
  bind_icloud_share,
  github_provider_draft,
  provider_row_draft,
  s3_provider_draft,
  type ProviderDraft,
  type ProviderVaultScope,
  type StorageProvider,
  type StoredProvider,
} from '$app-wasm'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
import { S3ConnectionFixture } from './s3-connection-fixture'

/** What a row test varies: its id and, where it matters, its vault scope. */
export type ProviderRowRequest = {
  readonly id: string
  readonly storeId: ProviderVaultScope
}

/** Clearly test-only credentials the fixtures carry. */
export class ProviderFixtureCredentials {
  static readonly GITHUB_TOKEN = 'TEST-ONLY-github-token-not-real'
  static readonly DRIVE_TOKEN = 'TEST-ONLY-drive-token-not-real'
  static readonly ICLOUD_TOKEN = 'TEST-ONLY-icloud-token-not-real'
  static readonly DRIVE_FOLDER = 'drive-folder-test'
  static readonly ICLOUD_SHARE =
    'icloud-share-v1:{"role":"owner","zoneName":"zone","ownerRecordName":"owner","rootRecordName":"root","shortGuid":"guid"}'
  static readonly EXPIRES_AT = '2099-01-01T00:00:00.000Z'
  static readonly ACCOUNT = 'owner@example.test'
}

/** One builder per stored provider variant, each a complete row typed
 * against the generated union. */
export class ProviderRowFixture {
  static unscoped(id: string): ProviderRowRequest {
    return { id, storeId: { state: 'unscoped' } }
  }

  static local(request: ProviderRowRequest): StorageProvider {
    return ProviderRowFixture.row({ request, provider: { type: 'local' } })
  }

  static localFolder(request: ProviderRowRequest): StorageProvider {
    return ProviderRowFixture.row({
      request,
      provider: {
        type: 'local-folder',
        directoryName: 'nook-backup',
        handleId: 'folder-handle-test',
      },
    })
  }

  static github(request: ProviderRowRequest): StorageProvider {
    return ProviderRowFixture.row({
      request,
      provider: {
        type: 'github',
        repository: { state: 'repository', value: 'nook' },
        token: ProviderFixtureCredentials.GITHUB_TOKEN,
      },
    })
  }

  static googleDrive(request: ProviderRowRequest): StorageProvider {
    return ProviderRowFixture.googleDriveIn({
      request,
      folderId: ProviderFixtureCredentials.DRIVE_FOLDER,
    })
  }

  /** A Drive row saved for one named folder. */
  static googleDriveIn({
    request,
    folderId,
  }: {
    readonly request: ProviderRowRequest
    readonly folderId: string
  }): StorageProvider {
    return ProviderRowFixture.row({
      request,
      provider: {
        type: 'oauth-file',
        preset: 'google-drive',
        authorization: {
          accessToken: ProviderFixtureCredentials.DRIVE_TOKEN,
          expiresAt: ProviderFixtureCredentials.EXPIRES_AT,
        },
        account: { state: 'email', email: ProviderFixtureCredentials.ACCOUNT },
        folderId,
      },
    })
  }

  static icloud(request: ProviderRowRequest): StorageProvider {
    return ProviderRowFixture.row({
      request,
      provider: {
        type: 'oauth-file',
        preset: 'icloud',
        webAuthToken: ProviderFixtureCredentials.ICLOUD_TOKEN,
        account: { state: 'unknown' },
        shareTarget: ProviderFixtureCredentials.ICLOUD_SHARE,
      },
    })
  }

  static s3(request: ProviderRowRequest): StorageProvider {
    return ProviderRowFixture.row({
      request,
      provider: { type: 's3', ...S3ConnectionFixture.configuration() },
    })
  }

  private static row({
    request,
    provider,
  }: {
    readonly request: ProviderRowRequest
    readonly provider: StoredProvider
  }): StorageProvider {
    return {
      id: request.id,
      label: request.id,
      storeId: request.storeId,
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: '2026-01-01T00:00:00.000Z',
      provider,
    }
  }
}

/** One builder per draft stage, each made by Rust's own constructors and
 * transitions. */
export class ProviderDraftFixture {
  static thisBrowser(): ProviderDraft {
    return begin_provider_draft(ProviderSetupKinds.THIS_BROWSER)
  }

  static githubAwaitingToken(): ProviderDraft {
    return begin_provider_draft(ProviderSetupKinds.GITHUB)
  }

  static githubEntered(): ProviderDraft {
    return github_provider_draft({
      token: ProviderFixtureCredentials.GITHUB_TOKEN,
      repository: 'nook',
    })
  }

  static googleDriveAwaitingSignIn(): ProviderDraft {
    return begin_provider_draft(ProviderSetupKinds.GOOGLE_DRIVE)
  }

  static googleDriveSignedIn(): ProviderDraft {
    return apply_google_drive_sign_in({
      draft: ProviderDraftFixture.googleDriveAwaitingSignIn(),
      access: {
        authorization: {
          accessToken: ProviderFixtureCredentials.DRIVE_TOKEN,
          expiresAt: ProviderFixtureCredentials.EXPIRES_AT,
        },
        account: { state: 'email', email: ProviderFixtureCredentials.ACCOUNT },
      },
    })
  }

  static googleDriveConnected(): ProviderDraft {
    return bind_google_drive_folder({
      draft: ProviderDraftFixture.googleDriveSignedIn(),
      folderId: ProviderFixtureCredentials.DRIVE_FOLDER,
    })
  }

  static icloudSignedIn(): ProviderDraft {
    return apply_icloud_sign_in({
      draft: begin_provider_draft(ProviderSetupKinds.ICLOUD),
      access: {
        webAuthToken: ProviderFixtureCredentials.ICLOUD_TOKEN,
        account: { state: 'unknown' },
      },
    })
  }

  static icloudShared(): ProviderDraft {
    return bind_icloud_share({
      draft: ProviderDraftFixture.icloudSignedIn(),
      shareTarget: ProviderFixtureCredentials.ICLOUD_SHARE,
    })
  }

  static localFolderAwaiting(): ProviderDraft {
    return begin_provider_draft(ProviderSetupKinds.LOCAL_FOLDER)
  }

  static localFolderSelected(): ProviderDraft {
    return provider_row_draft(
      ProviderRowFixture.localFolder(ProviderRowFixture.unscoped('folder')),
    )
  }

  static s3Awaiting(): ProviderDraft {
    return begin_provider_draft(ProviderSetupKinds.S3)
  }

  static s3Ready(): ProviderDraft {
    return s3_provider_draft(S3ConnectionFixture.configuration())
  }
}

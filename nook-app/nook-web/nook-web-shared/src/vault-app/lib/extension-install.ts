import { DEFAULT_SITE_URL } from '$lib/sitemap'
import {
  discoverPairedExtensionIdentity,
  InstalledExtensionRuntimeKind,
  readInstalledExtensionRuntimeId,
} from '$lib/extension-connect'
import { ExtensionPairedVaultIdentityStatusMessageStatus } from '$web-shared/extension/runtime-messages'

export enum ExtensionInstallMethod {
  ChromeWebStore = 'chrome_web_store',
  ManualZip = 'manual_zip',
}

export enum ExtensionInstallSource {
  Metadata = 'metadata',
  Fallback = 'fallback',
}

export type ExtensionInstallTarget = {
  installMethod: ExtensionInstallMethod
  installUrl: string
  channel?: string
  version?: string
  source: ExtensionInstallSource
}

export enum ExtensionSetupStatus {
  NotInstalled = 'not_installed',
  InstalledUnpaired = 'installed_unpaired',
  PairedElsewhere = 'paired_elsewhere',
  Paired = 'paired',
}

export type ExtensionSetupState =
  | { status: ExtensionSetupStatus.NotInstalled }
  | { status: ExtensionSetupStatus.InstalledUnpaired }
  | { status: ExtensionSetupStatus.Paired }
  | {
      status: ExtensionSetupStatus.PairedElsewhere
      connectedVaultName: string
      connectedVaultStoreId: string
    }

type BrowserExtensionEnvironment = {
  maxTouchPoints: number
  platform: string
  userAgent: string
  userAgentData?: Navigator['userAgentData'] | { mobile?: boolean }
}

type ExtensionDeploymentMetadata = {
  channel: string
  version: string
  extension_id: string
  install_method: ExtensionInstallMethod
  install_url: string
}

enum ExtensionMetadataParseKind {
  Invalid = 'invalid',
  Valid = 'valid',
}

type ExtensionMetadataParse =
  | { kind: ExtensionMetadataParseKind.Invalid }
  | {
      kind: ExtensionMetadataParseKind.Valid
      metadata: ExtensionDeploymentMetadata
    }

enum ExtensionMetadataFetchKind {
  Unavailable = 'unavailable',
  Loaded = 'loaded',
}

type ExtensionMetadataFetch =
  | { kind: ExtensionMetadataFetchKind.Unavailable }
  | {
      kind: ExtensionMetadataFetchKind.Loaded
      metadata: ExtensionDeploymentMetadata
    }

function marketingSiteBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SITE_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return DEFAULT_SITE_URL
}

export function extensionInstallLandingUrl(): string {
  return `${marketingSiteBaseUrl()}/#browser-extension`
}

export function browserSupportsExtensionInstallation(
  environment: BrowserExtensionEnvironment = navigator,
): boolean {
  const userAgentData = environment.userAgentData
  if (
    userAgentData &&
    'mobile' in userAgentData &&
    userAgentData.mobile === true
  ) {
    return false
  }

  if (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(
      environment.userAgent,
    )
  ) {
    return false
  }

  const isDesktopModeIPad =
    /Macintosh/i.test(environment.userAgent) &&
    environment.platform === 'MacIntel' &&
    environment.maxTouchPoints > 1
  return !isDesktopModeIPad
}

export function shouldOfferExtensionSetup(
  status: ExtensionSetupStatus,
  environment: BrowserExtensionEnvironment = navigator,
): boolean {
  return (
    status !== ExtensionSetupStatus.NotInstalled ||
    browserSupportsExtensionInstallation(environment)
  )
}

function isExtensionInstallMethod(
  value: unknown,
): value is ExtensionInstallMethod {
  return (
    value === ExtensionInstallMethod.ChromeWebStore ||
    value === ExtensionInstallMethod.ManualZip
  )
}

function parseExtensionMetadata(value: unknown): ExtensionMetadataParse {
  if (!value || typeof value !== 'object') {
    return { kind: ExtensionMetadataParseKind.Invalid }
  }
  const record = value as Record<string, unknown>
  const channel = typeof record.channel === 'string' ? record.channel : ''
  const version = typeof record.version === 'string' ? record.version : ''
  const extensionId =
    typeof record.extension_id === 'string' ? record.extension_id : ''
  const installUrl =
    typeof record.install_url === 'string' ? record.install_url.trim() : ''
  if (
    !channel ||
    !version ||
    !extensionId ||
    !installUrl ||
    !isExtensionInstallMethod(record.install_method)
  ) {
    return { kind: ExtensionMetadataParseKind.Invalid }
  }
  try {
    const parsed = new URL(installUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { kind: ExtensionMetadataParseKind.Invalid }
    }
  } catch {
    return { kind: ExtensionMetadataParseKind.Invalid }
  }
  return {
    kind: ExtensionMetadataParseKind.Valid,
    metadata: {
      channel,
      version,
      extension_id: extensionId,
      install_method: record.install_method,
      install_url: installUrl,
    },
  }
}

function metadataCandidateUrls(): string[] {
  const urls = [
    new URL('./downloads/extension.json', window.location.href).href,
    `${marketingSiteBaseUrl()}/downloads/extension.json`,
  ]
  return [...new Set(urls)]
}

async function fetchExtensionMetadata(
  url: string,
): Promise<ExtensionMetadataFetch> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return { kind: ExtensionMetadataFetchKind.Unavailable }
    const parsed = parseExtensionMetadata(await response.json())
    return parsed.kind === ExtensionMetadataParseKind.Valid
      ? {
          kind: ExtensionMetadataFetchKind.Loaded,
          metadata: parsed.metadata,
        }
      : { kind: ExtensionMetadataFetchKind.Unavailable }
  } catch {
    return { kind: ExtensionMetadataFetchKind.Unavailable }
  }
}

export async function loadExtensionInstallTarget(): Promise<ExtensionInstallTarget> {
  for (const url of metadataCandidateUrls()) {
    const metadata = await fetchExtensionMetadata(url)
    if (metadata.kind !== ExtensionMetadataFetchKind.Loaded) continue
    return {
      installMethod: metadata.metadata.install_method,
      installUrl: metadata.metadata.install_url,
      channel: metadata.metadata.channel,
      version: metadata.metadata.version,
      source: ExtensionInstallSource.Metadata,
    }
  }
  return {
    installMethod: ExtensionInstallMethod.ManualZip,
    installUrl: extensionInstallLandingUrl(),
    source: ExtensionInstallSource.Fallback,
  }
}

export async function resolveExtensionSetupState(
  vaultStoreId: string | void,
): Promise<ExtensionSetupState> {
  if (
    readInstalledExtensionRuntimeId().kind ===
    InstalledExtensionRuntimeKind.NotInstalled
  ) {
    return { status: ExtensionSetupStatus.NotInstalled }
  }
  if (!vaultStoreId) return { status: ExtensionSetupStatus.InstalledUnpaired }

  const discovery = await discoverPairedExtensionIdentity(vaultStoreId)
  if (
    discovery.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Locked ||
    discovery.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
  ) {
    return { status: ExtensionSetupStatus.Paired }
  }
  if (
    discovery.status ===
    ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
  ) {
    return {
      status: ExtensionSetupStatus.PairedElsewhere,
      connectedVaultName: discovery.connectedVaultName,
      connectedVaultStoreId: discovery.connectedVaultStoreId,
    }
  }
  return { status: ExtensionSetupStatus.InstalledUnpaired }
}

export function openExtensionInstallTarget(
  target: ExtensionInstallTarget,
): void {
  window.open(target.installUrl, '_blank', 'noopener,noreferrer')
}

import {
  ExtensionReleaseChannel,
  type ExtensionChannel,
} from './channel-identity'

export enum ExtensionDiagnosticBuildAvailability {
  Disabled = 'disabled',
  Enabled = 'enabled',
}

export type ExtensionDiagnosticBuildRequest = {
  readonly channel: ExtensionChannel
}

/** Owns the build-time production gate for browser diagnostics. */
export class ExtensionDiagnosticBuildPolicy {
  availability({
    channel,
  }: ExtensionDiagnosticBuildRequest): ExtensionDiagnosticBuildAvailability {
    return channel === ExtensionReleaseChannel.Production
      ? ExtensionDiagnosticBuildAvailability.Disabled
      : ExtensionDiagnosticBuildAvailability.Enabled
  }
}

export enum ExtensionEntrypointBuildFormat {
  Classic = 'iife',
  Module = 'esm',
}

type ExtensionEntrypointBuildFormatArgs = {
  entrypoint: string
}

export class ExtensionEntrypointBuildPolicy {
  format({
    entrypoint,
  }: ExtensionEntrypointBuildFormatArgs): ExtensionEntrypointBuildFormat {
    if (entrypoint.includes('/content/')) {
      return ExtensionEntrypointBuildFormat.Classic
    }
    return ExtensionEntrypointBuildFormat.Module
  }
}

export const extensionEntrypointBuildPolicy =
  new ExtensionEntrypointBuildPolicy()

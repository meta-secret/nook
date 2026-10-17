import {
  ExtensionReleaseChannel,
  type ExtensionChannel,
} from './channel-identity'
import { SIDE_PANEL_PAGE_PATH } from '../src/lib/side-panel-page-path'

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

/** The extension's Vite page builds. */
export enum ExtensionPageBuild {
  /** The Nook tab and the side panel: one build, so the package holds one
   * copy of each WASM binary they load. */
  Pages = 'pages',
  /** The in-page login picker, web-accessible on its own path. */
  LoginPicker = 'login-picker',
}

/** Whether a page build owns its output directory or shares it. */
export enum ExtensionPageOutput {
  /** Emptied before the build: nothing else writes there. */
  Owned = 'owned',
  /** The package root: other builds write beside it in parallel. */
  Shared = 'shared',
}

export type ExtensionPageBuildLayout = {
  /** Vite root, relative to the extension package. */
  readonly root: string
  /** Output directory, relative to dist. */
  readonly outDir: string
  readonly output: ExtensionPageOutput
  /** HTML entries relative to the root; each is emitted at that same path. */
  readonly inputs: readonly string[]
}

/** Where each extension page is built from and emitted to. */
export class ExtensionPageBuildPlan {
  static readonly NOOK_TAB_PAGE_PATH = 'popup/index.html'

  layout(build: ExtensionPageBuild): ExtensionPageBuildLayout {
    switch (build) {
      case ExtensionPageBuild.Pages:
        return {
          root: 'src',
          outDir: '',
          output: ExtensionPageOutput.Shared,
          inputs: [
            ExtensionPageBuildPlan.NOOK_TAB_PAGE_PATH,
            // The manifest's side_panel.default_path and the service
            // worker's side-panel sender check use this same path.
            SIDE_PANEL_PAGE_PATH,
          ],
        }
      case ExtensionPageBuild.LoginPicker:
        return {
          root: 'src/login-picker',
          outDir: 'login-picker',
          output: ExtensionPageOutput.Owned,
          inputs: ['index.html'],
        }
    }
  }
}

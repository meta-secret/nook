import { Effect, type Cause } from 'effect'
import { mount } from 'svelte'
import type { ComponentProps, MountOptions } from 'svelte'
import { extensionLocaleCatalog, type ExtensionI18n } from '../lib/i18n'
import {
  DeviceProtectionStatus,
  type ExtensionSessionDeviceState,
  extensionWasmRuntime,
} from '../lib/nook-wasm'
import { retryClosedExtensionSessionOnce } from '../lib/extension-runtime-retry'
import { PopupInitializationPhase } from '../popup/popup-app-state'
import SidePanel from './SidePanel.svelte'
import {
  SidePanelLockReasonKind,
  SidePanelViewKind,
  SidePanelViews,
  type SidePanelView,
} from './side-panel-state'
import '../popup/popup.css'
import './side-panel.css'

type SidePanelMount = {
  readonly target: HTMLElement
  readonly i18n: ExtensionI18n
  readonly initialView: SidePanelView
}

/** Startup: read the extension's state, then mount the panel on it. Until
 * then the page is the bare panel surface; a failed read mounts the
 * failure view, never setup. */
class SidePanelStartup {
  private phase = PopupInitializationPhase.DeviceProtectionStatus

  /** The page always carries #app; without it startup fails visibly. */
  run(): Effect.Effect<void, Cause.NoSuchElementError> {
    return Effect.fromNullishOr(document.getElementById('app')).pipe(
      Effect.flatMap((target) => Effect.promise(() => this.mountOn(target))),
    )
  }

  private async mountOn(target: HTMLElement): Promise<void> {
    const i18n = await extensionLocaleCatalog.initializeExtensionI18n()
    const initialView = await this.initialView()
    const panel: SidePanelMount = { target, i18n, initialView }
    // A view that throws while mounting leaves the failure view, not a
    // blank panel, as the Nook tab does.
    const mounted = Effect.try(() => SidePanelStartup.mount(panel)).pipe(
      Effect.catch(() => Effect.sync(() => this.mountFailure(panel))),
    )
    Effect.runSync(mounted)
  }

  private mountFailure(panel: SidePanelMount): void {
    panel.target.replaceChildren()
    this.phase = PopupInitializationPhase.AppMount
    const failure: SidePanelMount = {
      ...panel,
      initialView: this.failureView(),
    }
    SidePanelStartup.mount(failure)
  }

  private static mount(panel: SidePanelMount): void {
    const options: MountOptions<ComponentProps<typeof SidePanel>> = {
      target: panel.target,
      props: { i18n: panel.i18n, initialView: panel.initialView },
    }
    mount(SidePanel, options)
  }

  private initialView(): Promise<SidePanelView> {
    const read = Effect.tryPromise(() =>
      retryClosedExtensionSessionOnce(() => this.readView()),
    )
    return Effect.runPromise(
      read.pipe(Effect.orElseSucceed(() => this.failureView())),
    )
  }

  /** The step that failed names the failure. */
  private failureView(): SidePanelView {
    return { kind: SidePanelViewKind.Failure, phase: this.phase }
  }

  private async readView(): Promise<SidePanelView> {
    this.phase = PopupInitializationPhase.DeviceProtectionStatus
    const status = await extensionWasmRuntime.extensionDeviceProtectionStatus()
    switch (SidePanelViews.kind(status)) {
      case SidePanelViewKind.Unlocked:
        break
      case SidePanelViewKind.Setup:
      case SidePanelViewKind.PinLocked:
      case SidePanelViewKind.PasskeyLocked:
      case SidePanelViewKind.Failure:
        return this.lockedView(status)
    }
    this.phase = PopupInitializationPhase.ActiveSessionDevice
    const device: ExtensionSessionDeviceState =
      await extensionWasmRuntime.extensionSessionDevice()
    const request: Parameters<typeof SidePanelViews.unlocked>[0] = { device }
    return SidePanelViews.unlocked(request)
  }

  private lockedView(status: DeviceProtectionStatus): SidePanelView {
    const request: Parameters<typeof SidePanelViews.locked>[0] = {
      status,
      reason: SidePanelLockReasonKind.None,
    }
    return SidePanelViews.locked(request)
  }
}

void Effect.runPromise(new SidePanelStartup().run())

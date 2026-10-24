import {
  SiteVaultConnectMessages,
  SiteVaultConnectResponseKind,
  type SiteVaultConnectMessage,
} from '../../lib/site-vault-connect-messages'
import { extensionSessionLifecycle } from './session-lifecycle'
import {
  SchemaRuntimeMessageRoute,
  type BackgroundRuntimeMessageRoute,
  type RuntimeMessageSchema,
} from './schema-runtime-message-route'
import {
  ChromeSiteVaultConnectBrowser,
  SiteVaultConnect,
  SiteVaultConnectReturn,
  SiteVaultConnectWindows,
  type SiteVaultConnectDependencies,
  type SiteVaultConnectReturnDependencies,
} from './site-vault-connect'

/** Owns the worker's page-widget connect flow and its one return focus. */
export class SiteVaultConnectService {
  private readonly browser = new ChromeSiteVaultConnectBrowser()
  private readonly returnDependencies: SiteVaultConnectReturnDependencies = {
    browser: this.browser,
    now: Date.now,
  }
  private readonly returnTo = new SiteVaultConnectReturn(
    this.returnDependencies,
  )
  private readonly connectDependencies: SiteVaultConnectDependencies = {
    windows: new SiteVaultConnectWindows(this.browser),
    returnTo: this.returnTo,
    openLauncher: extensionSessionLifecycle.openCompanionLauncher.bind(
      extensionSessionLifecycle,
    ),
    runtimeId: chrome.runtime.id,
  }
  private readonly connect = new SiteVaultConnect(this.connectDependencies)

  route(): BackgroundRuntimeMessageRoute {
    const schema: RuntimeMessageSchema<SiteVaultConnectMessage> = {
      decode: SiteVaultConnectMessages.decode,
    }
    return SchemaRuntimeMessageRoute.matching(schema)
      .respondWith(this.connect.connect.bind(this.connect))
      .onRejected(() => ({ kind: SiteVaultConnectResponseKind.Failed }))
  }

  /** After an approved connection, focus the tab whose widget started it. */
  returnToOrigin(): Promise<void> {
    return this.returnTo.restore()
  }
}

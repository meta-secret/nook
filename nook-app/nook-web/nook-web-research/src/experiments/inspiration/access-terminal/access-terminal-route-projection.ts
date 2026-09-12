import {
  type KeyGraph,
  type Passkey,
  Reach,
  type Vault,
  KeyGraphView as GraphView,
} from '../../keys-management/_shared/key-graph'

export interface AccessTerminalRoute {
  passkey: string
  device: string
  vault: string
  store: string
  reach: string
}

export type AccessTerminalRoutes = AccessTerminalRoute[]

export interface PasskeyRouteProjectionRequest {
  passkeyId: string
}

export interface VaultRouteProjectionRequest {
  vault: Vault
}

export class AccessTerminalRouteProjection {
  constructor(private readonly graph: KeyGraph) {}

  fromPasskey({
    passkeyId,
  }: PasskeyRouteProjectionRequest): AccessTerminalRoutes {
    return this.graph.passkeys
      .filter((passkey) => passkey.id === passkeyId)
      .flatMap((passkey) => {
        const passkeyDevicesRequest: Parameters<
          GraphView['devicesForPasskey']
        >[0] = {
          passkeyId: passkey.id,
        }
        return new GraphView(this.graph)
          .devicesForPasskey(passkeyDevicesRequest)
          .flatMap((device) => {
            const deviceVaultsRequest: Parameters<
              GraphView['vaultsForDevice']
            >[0] = {
              deviceId: device.id,
            }
            return new GraphView(this.graph)
              .vaultsForDevice(deviceVaultsRequest)
              .map((vault) => ({
                passkey: passkey.shortId,
                device: device.shortId,
                vault: vault.shortId,
                store: GraphView.storeLabel(passkey.store),
                reach: this.reachWord(passkey),
              }))
          })
      })
  }

  intoVault({ vault }: VaultRouteProjectionRequest): AccessTerminalRoutes {
    const graphView = new GraphView(this.graph)
    const vaultDevicesRequest: Parameters<typeof graphView.devicesForVault>[0] =
      { vault }
    return graphView.devicesForVault(vaultDevicesRequest).flatMap((device) => {
      const devicePasskeysRequest: Parameters<
        typeof graphView.passkeysForDevice
      >[0] = { device }
      return graphView
        .passkeysForDevice(devicePasskeysRequest)
        .map((passkey) => ({
          passkey: passkey.shortId,
          device: device.shortId,
          vault: vault.shortId,
          store: GraphView.storeLabel(passkey.store),
          reach: this.reachWord(passkey),
        }))
    })
  }

  reachWord(passkey: Passkey): string {
    return passkey.reach === Reach.Here ? 'here' : 'elsewhere'
  }
}

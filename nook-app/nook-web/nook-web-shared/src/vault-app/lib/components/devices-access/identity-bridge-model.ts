import {
  IdentityBridgeFlow,
  IdentityBridgeNodeKind,
  IdentityBridgePerspective,
  IdentityBridgePortMode,
  IdentityBridgeRelationKind,
  IdentityBridgeVaultSelectionKind,
  deviceData,
  graphEdge,
  graphNode,
  identityData,
  protectionData,
  stageNode,
  vaultData,
  type IdentityBridgeDefinition,
  type IdentityBridgeInput,
  type IdentityBridgeNode,
} from './identity-bridge-elements'

export * from './identity-bridge-elements'

function identityGraph(input: IdentityBridgeInput): IdentityBridgeDefinition {
  const verifiedVaults = input.vaults.filter((vault) => vault.verified)
  if (input.compact) {
    const identityY = 630
    const vaultStartY = 920
    const vaultNodes = verifiedVaults.map(
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      (vault, index) =>
        (() => {
          const vaultDataArgs: Parameters<typeof vaultData>[0] = {
            vault,
            input,
            flow: IdentityBridgeFlow.Vertical,
            portMode: IdentityBridgePortMode.Target,
            lateralAccessPort: true,
          }
          const graphNodeArgs2: Parameters<typeof graphNode>[0] = {
            id: `vault-${vault.storeId}`,
            data: vaultData(vaultDataArgs),
            x: 20,
            y: vaultStartY + index * 190,
            width: 300,
          }
          return graphNode(graphNodeArgs2)
        })(),
    )
    if (verifiedVaults.length === 0) {
      const graphNodeArgs3: Parameters<typeof graphNode>[0] = {
        id: 'vault-empty',
        data: {
          kind: IdentityBridgeNodeKind.Empty,
          flow: IdentityBridgeFlow.Vertical,
          portMode: IdentityBridgePortMode.None,
          label: input.copy.noVerifiedVaults,
          description: input.copy.noVerifiedVaultsDescription,
        },
        x: 20,
        y: vaultStartY,
        width: 300,
      }
      vaultNodes.push(graphNode(graphNodeArgs3))
    }
    return {
      nodes: [
        (() => {
          const stageNodeArgs: Parameters<typeof stageNode>[0] = {
            id: 'stage-protection',
            label: input.copy.protectionStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 0,
            width: 300,
          }
          return stageNode(stageNodeArgs)
        })(),
        (() => {
          const data = (() => {
            const protectionDataArgs: Parameters<typeof protectionData>[0] = {
              input,
              flow: IdentityBridgeFlow.Vertical,
            }
            return protectionData(protectionDataArgs)
          })()
          const nodeRequest: Parameters<typeof graphNode>[0] = {
            id: 'protection-current',
            data,
            x: 20,
            y: 44,
            width: 300,
          }
          return graphNode(nodeRequest)
        })(),
        (() => {
          const stageNodeArgs2: Parameters<typeof stageNode>[0] = {
            id: 'stage-device',
            label: input.copy.deviceStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 310,
            width: 300,
          }
          return stageNode(stageNodeArgs2)
        })(),
        (() => {
          const data = (() => {
            const deviceDataArgs: Parameters<typeof deviceData>[0] = {
              input,
              flow: IdentityBridgeFlow.Vertical,
              portMode: IdentityBridgePortMode.Both,
              incomingRelation: input.copy.protectionDeviceRelation,
            }
            return deviceData(deviceDataArgs)
          })()
          const nodeRequest: Parameters<typeof graphNode>[0] = {
            id: 'device-current',
            data,
            x: 20,
            y: 354,
            width: 300,
          }
          return graphNode(nodeRequest)
        })(),
        (() => {
          const stageNodeArgs3: Parameters<typeof stageNode>[0] = {
            id: 'stage-identity',
            label: input.copy.identityStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 580,
            width: 300,
          }
          return stageNode(stageNodeArgs3)
        })(),
        (() => {
          const identityDataArgs: Parameters<typeof identityData>[0] = {
            input,
            flow: IdentityBridgeFlow.Vertical,
            portMode: IdentityBridgePortMode.Both,
            lateralAccessPort: true,
          }
          const graphNodeArgs6: Parameters<typeof graphNode>[0] = {
            id: 'identity-current',
            data: identityData(identityDataArgs),
            x: 40,
            y: identityY,
            width: 260,
          }
          return graphNode(graphNodeArgs6)
        })(),
        (() => {
          const stageNodeArgs4: Parameters<typeof stageNode>[0] = {
            id: 'stage-vault',
            label: input.copy.vaultStage,
            flow: IdentityBridgeFlow.Vertical,
            x: 20,
            y: 870,
            width: 300,
          }
          return stageNode(stageNodeArgs4)
        })(),
        ...vaultNodes,
      ],
      edges: [
        (() => {
          const graphEdgeArgs: Parameters<typeof graphEdge>[0] = {
            id: 'protection-to-device',
            source: 'protection-current',
            target: 'device-current',
            relation: IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
            ariaLabel: input.copy.protectionDeviceRelation,
            lateralAccessPort: false,
          }
          return graphEdge(graphEdgeArgs)
        })(),
        (() => {
          const graphEdgeArgs2: Parameters<typeof graphEdge>[0] = {
            id: 'device-to-identity',
            source: 'device-current',
            target: 'identity-current',
            relation: IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
            ariaLabel: input.copy.appKeyIdentityRelation,
            lateralAccessPort: false,
          }
          return graphEdge(graphEdgeArgs2)
        })(),
        ...verifiedVaults.map((vault) =>
          (() => {
            const graphEdgeArgs3: Parameters<typeof graphEdge>[0] = {
              id: `identity-to-${vault.storeId}`,
              source: 'identity-current',
              target: `vault-${vault.storeId}`,
              relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
              ariaLabel: input.copy.identityVaultRelation(vault.label),
              lateralAccessPort: true,
            }
            return graphEdge(graphEdgeArgs3)
          })(),
        ),
      ],
      compactHeight:
        vaultStartY + Math.max(1, verifiedVaults.length) * 190 + 24,
    }
  }

  const gap = 220
  const identityY = Math.max(115, 150 - ((verifiedVaults.length - 1) * gap) / 2)
  const vaultStartY = Math.max(
    0,
    identityY - ((verifiedVaults.length - 1) * gap) / 2,
  )
  const vaultNodes = verifiedVaults.map(
    // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (vault, index) =>
      (() => {
        const vaultDataArgs2: Parameters<typeof vaultData>[0] = {
          vault,
          input,
          flow: IdentityBridgeFlow.Horizontal,
          portMode: IdentityBridgePortMode.Target,
          lateralAccessPort: false,
        }
        const graphNodeArgs7: Parameters<typeof graphNode>[0] = {
          id: `vault-${vault.storeId}`,
          data: vaultData(vaultDataArgs2),
          x: 800,
          y: vaultStartY + index * gap,
          width: 350,
        }
        return graphNode(graphNodeArgs7)
      })(),
  )
  if (verifiedVaults.length === 0) {
    const graphNodeArgs8: Parameters<typeof graphNode>[0] = {
      id: 'vault-empty',
      data: {
        kind: IdentityBridgeNodeKind.Empty,
        flow: IdentityBridgeFlow.Horizontal,
        portMode: IdentityBridgePortMode.None,
        label: input.copy.noVerifiedVaults,
        description: input.copy.noVerifiedVaultsDescription,
      },
      x: 800,
      y: identityY,
      width: 350,
    }
    vaultNodes.push(graphNode(graphNodeArgs8))
  }
  return {
    nodes: [
      (() => {
        const stageNodeArgs5: Parameters<typeof stageNode>[0] = {
          id: 'stage-protection',
          label: input.copy.protectionStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 0,
          y: -54,
          width: 320,
        }
        return stageNode(stageNodeArgs5)
      })(),
      (() => {
        const stageNodeArgs6: Parameters<typeof stageNode>[0] = {
          id: 'stage-device',
          label: input.copy.deviceStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 350,
          y: -54,
          width: 190,
        }
        return stageNode(stageNodeArgs6)
      })(),
      (() => {
        const stageNodeArgs7: Parameters<typeof stageNode>[0] = {
          id: 'stage-identity',
          label: input.copy.identityStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 570,
          y: -54,
          width: 180,
        }
        return stageNode(stageNodeArgs7)
      })(),
      (() => {
        const stageNodeArgs8: Parameters<typeof stageNode>[0] = {
          id: 'stage-vault',
          label: input.copy.vaultStage,
          flow: IdentityBridgeFlow.Horizontal,
          x: 800,
          y: -54,
          width: 350,
        }
        return stageNode(stageNodeArgs8)
      })(),
      (() => {
        const data = (() => {
          const protectionDataArgs2: Parameters<typeof protectionData>[0] = {
            input,
            flow: IdentityBridgeFlow.Horizontal,
          }
          return protectionData(protectionDataArgs2)
        })()
        const nodeRequest: Parameters<typeof graphNode>[0] = {
          id: 'protection-current',
          data,
          x: 0,
          y: identityY,
          width: 320,
        }
        return graphNode(nodeRequest)
      })(),
      (() => {
        const data = (() => {
          const deviceDataArgs2: Parameters<typeof deviceData>[0] = {
            input,
            flow: IdentityBridgeFlow.Horizontal,
            portMode: IdentityBridgePortMode.Both,
            incomingRelation: input.copy.protectionDeviceRelation,
          }
          return deviceData(deviceDataArgs2)
        })()
        const nodeRequest: Parameters<typeof graphNode>[0] = {
          id: 'device-current',
          data,
          x: 350,
          y: identityY,
          width: 190,
        }
        return graphNode(nodeRequest)
      })(),
      (() => {
        const identityDataArgs2: Parameters<typeof identityData>[0] = {
          input,
          flow: IdentityBridgeFlow.Horizontal,
          portMode: IdentityBridgePortMode.Both,
          lateralAccessPort: false,
        }
        const graphNodeArgs11: Parameters<typeof graphNode>[0] = {
          id: 'identity-current',
          data: identityData(identityDataArgs2),
          x: 570,
          y: identityY,
          width: 180,
        }
        return graphNode(graphNodeArgs11)
      })(),
      ...vaultNodes,
    ],
    edges: [
      (() => {
        const graphEdgeArgs4: Parameters<typeof graphEdge>[0] = {
          id: 'protection-to-device',
          source: 'protection-current',
          target: 'device-current',
          relation: IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
          ariaLabel: input.copy.protectionDeviceRelation,
          lateralAccessPort: false,
        }
        return graphEdge(graphEdgeArgs4)
      })(),
      (() => {
        const graphEdgeArgs5: Parameters<typeof graphEdge>[0] = {
          id: 'device-to-identity',
          source: 'device-current',
          target: 'identity-current',
          relation: IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
          ariaLabel: input.copy.appKeyIdentityRelation,
          lateralAccessPort: false,
        }
        return graphEdge(graphEdgeArgs5)
      })(),
      ...verifiedVaults.map((vault) =>
        (() => {
          const graphEdgeArgs6: Parameters<typeof graphEdge>[0] = {
            id: `identity-to-${vault.storeId}`,
            source: 'identity-current',
            target: `vault-${vault.storeId}`,
            relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
            ariaLabel: input.copy.identityVaultRelation(vault.label),
            lateralAccessPort: false,
          }
          return graphEdge(graphEdgeArgs6)
        })(),
      ),
    ],
    compactHeight: 0,
  }
}

function vaultGraph(input: IdentityBridgeInput): IdentityBridgeDefinition {
  const selectedVault = input.vaults.find(
    (vault) =>
      input.selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected &&
      vault.storeId === input.selectedVault.storeId,
  )
  if (!selectedVault) {
    const compact = input.compact
    const width = compact ? 300 : 370
    return {
      nodes: [
        (() => {
          const stageNodeArgs9: Parameters<typeof stageNode>[0] = {
            id: 'stage-vault',
            label: input.copy.selectedVaultStage,
            flow: IdentityBridgeFlow.Vertical,
            x: compact ? 20 : 350,
            y: compact ? 0 : -54,
            width,
          }
          return stageNode(stageNodeArgs9)
        })(),
        (() => {
          const graphNodeArgs12: Parameters<typeof graphNode>[0] = {
            id: 'vault-empty',
            data: {
              kind: IdentityBridgeNodeKind.Empty,
              flow: IdentityBridgeFlow.Vertical,
              portMode: IdentityBridgePortMode.None,
              label: input.copy.noSelectedVault,
              description: input.copy.noSelectedVaultDescription,
            },
            x: compact ? 20 : 350,
            y: compact ? 44 : 0,
            width,
          }
          return graphNode(graphNodeArgs12)
        })(),
      ],
      edges: [],
      compactHeight: compact ? 280 : 0,
    }
  }
  const verifiedDeviceAccess = selectedVault.verified
  const compact = input.compact
  const flow = compact
    ? IdentityBridgeFlow.Vertical
    : IdentityBridgeFlow.Horizontal
  const vaultX = compact ? 20 : 0
  const vaultY = compact ? 44 : 115
  const deviceX = compact ? 20 : 590
  const deviceY = compact ? 360 : 115
  const vaultWidth = compact ? 300 : 350
  const deviceWidth = compact ? 300 : 310
  const nodes: IdentityBridgeNode[] = [
    (() => {
      const stageNodeArgs10: Parameters<typeof stageNode>[0] = {
        id: 'stage-vault',
        label: input.copy.selectedVaultStage,
        flow,
        x: compact ? 20 : 0,
        y: compact ? 0 : 0,
        width: vaultWidth,
      }
      return stageNode(stageNodeArgs10)
    })(),
    (() => {
      const vaultDataArgs3: Parameters<typeof vaultData>[0] = {
        vault: selectedVault,
        input,
        flow,
        portMode: verifiedDeviceAccess
          ? IdentityBridgePortMode.Source
          : IdentityBridgePortMode.None,
        lateralAccessPort: false,
      }
      const graphNodeArgs13: Parameters<typeof graphNode>[0] = {
        id: 'vault-selected',
        data: vaultData(vaultDataArgs3),
        x: vaultX,
        y: vaultY,
        width: vaultWidth,
      }
      return graphNode(graphNodeArgs13)
    })(),
    (() => {
      const stageNodeArgs11: Parameters<typeof stageNode>[0] = {
        id: 'stage-device',
        label: input.copy.deviceStage,
        flow,
        x: compact ? 20 : 590,
        y: compact ? 310 : 0,
        width: compact ? 300 : 310,
      }
      return stageNode(stageNodeArgs11)
    })(),
  ]
  if (verifiedDeviceAccess) {
    nodes.push(
      (() => {
        const data = (() => {
          const deviceDataArgs3: Parameters<typeof deviceData>[0] = {
            input,
            flow,
            portMode: IdentityBridgePortMode.Target,
            incomingRelation: input.copy.vaultDeviceRelation(
              selectedVault.label,
            ),
          }
          return deviceData(deviceDataArgs3)
        })()
        const nodeRequest: Parameters<typeof graphNode>[0] = {
          id: 'device-current',
          data,
          x: deviceX,
          y: deviceY,
          width: deviceWidth,
        }
        return graphNode(nodeRequest)
      })(),
    )
  } else {
    const graphNodeArgs14: Parameters<typeof graphNode>[0] = {
      id: 'device-empty',
      data: {
        kind: IdentityBridgeNodeKind.Empty,
        flow,
        portMode: IdentityBridgePortMode.None,
        label: input.copy.noAuthorizedIdentity,
        description: input.copy.noAuthorizedIdentityDescription,
      },
      x: deviceX,
      y: deviceY,
      width: deviceWidth,
    }
    nodes.push(graphNode(graphNodeArgs14))
  }
  return {
    nodes,
    edges: verifiedDeviceAccess
      ? [
          (() => {
            const graphEdgeArgs7: Parameters<typeof graphEdge>[0] = {
              id: 'vault-to-device',
              source: 'vault-selected',
              target: 'device-current',
              relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
              ariaLabel: input.copy.vaultDeviceRelation(selectedVault.label),
              lateralAccessPort: false,
            }
            return graphEdge(graphEdgeArgs7)
          })(),
        ]
      : [],
    compactHeight: compact ? 650 : 0,
  }
}

export function buildIdentityBridge(
  input: IdentityBridgeInput,
): IdentityBridgeDefinition {
  return input.perspective === IdentityBridgePerspective.Identities
    ? identityGraph(input)
    : vaultGraph(input)
}

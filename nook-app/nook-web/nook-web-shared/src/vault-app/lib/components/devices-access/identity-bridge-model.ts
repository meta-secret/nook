import {
  IdentityBridgeFlow,
  IdentityBridgeNodeKind,
  IdentityBridgePerspective,
  IdentityBridgePortMode,
  IdentityBridgeRelationKind,
  IdentityBridgeVaultSelectionKind,
  IdentityBridgeDevicePresentation,
  IdentityBridgeEdgePresentation,
  IdentityBridgeGraphNodePresentation,
  IdentityBridgeIdentityPresentation,
  IdentityBridgeProtectionPresentation,
  IdentityBridgeStagePresentation,
  IdentityBridgeVaultPresentation,
  type IdentityBridgeDefinition,
  type IdentityBridgeInput,
  type IdentityBridgeNode,
} from "./identity-bridge-elements";

export * from "./identity-bridge-elements";

export class IdentityBridgePresentation {
  constructor(private readonly request: IdentityBridgeInput) {}
  get graph(): IdentityBridgeDefinition {
    const input = this.request;

    return input.perspective === IdentityBridgePerspective.Identities
      ? this.identityGraph()
      : this.vaultGraph();
  }
  private identityGraph(): IdentityBridgeDefinition {
    const input = this.request;
    const verifiedVaults = input.vaults.filter((vault) => vault.verified);
    if (input.compact) {
      const identityY = 630;
      const vaultStartY = 920;
      const vaultNodes = verifiedVaults.map(
        // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
        (vault, index) =>
          (() => {
            const vaultDataArgs: ConstructorParameters<
              typeof IdentityBridgeVaultPresentation
            >[0] = {
              vault,
              input,
              flow: IdentityBridgeFlow.Vertical,
              portMode: IdentityBridgePortMode.Target,
              lateralAccessPort: true,
            };
            const graphNodeArgs2: ConstructorParameters<
              typeof IdentityBridgeGraphNodePresentation
            >[0] = {
              id: `vault-${vault.storeId}`,
              data: new IdentityBridgeVaultPresentation(vaultDataArgs).data,
              x: 20,
              y: vaultStartY + index * 190,
              width: 300,
            };
            return new IdentityBridgeGraphNodePresentation(graphNodeArgs2).node;
          })(),
      );
      if (verifiedVaults.length === 0) {
        const graphNodeArgs3: ConstructorParameters<
          typeof IdentityBridgeGraphNodePresentation
        >[0] = {
          id: "vault-empty",
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
        };
        vaultNodes.push(
          new IdentityBridgeGraphNodePresentation(graphNodeArgs3).node,
        );
      }
      return {
        nodes: [
          (() => {
            const stageNodeArgs: ConstructorParameters<
              typeof IdentityBridgeStagePresentation
            >[0] = {
              id: "stage-protection",
              label: input.copy.protectionStage,
              flow: IdentityBridgeFlow.Vertical,
              x: 20,
              y: 0,
              width: 300,
            };
            return new IdentityBridgeStagePresentation(stageNodeArgs).node;
          })(),
          (() => {
            const data = (() => {
              const protectionDataArgs: ConstructorParameters<
                typeof IdentityBridgeProtectionPresentation
              >[0] = {
                input,
                flow: IdentityBridgeFlow.Vertical,
              };
              return new IdentityBridgeProtectionPresentation(
                protectionDataArgs,
              ).data;
            })();
            const nodeRequest: ConstructorParameters<
              typeof IdentityBridgeGraphNodePresentation
            >[0] = {
              id: "protection-current",
              data,
              x: 20,
              y: 44,
              width: 300,
            };
            return new IdentityBridgeGraphNodePresentation(nodeRequest).node;
          })(),
          (() => {
            const stageNodeArgs2: ConstructorParameters<
              typeof IdentityBridgeStagePresentation
            >[0] = {
              id: "stage-device",
              label: input.copy.deviceStage,
              flow: IdentityBridgeFlow.Vertical,
              x: 20,
              y: 310,
              width: 300,
            };
            return new IdentityBridgeStagePresentation(stageNodeArgs2).node;
          })(),
          (() => {
            const data = (() => {
              const deviceDataArgs: ConstructorParameters<
                typeof IdentityBridgeDevicePresentation
              >[0] = {
                input,
                flow: IdentityBridgeFlow.Vertical,
                portMode: IdentityBridgePortMode.Both,
                incomingRelation: input.copy.protectionDeviceRelation,
              };
              return new IdentityBridgeDevicePresentation(deviceDataArgs).data;
            })();
            const nodeRequest: ConstructorParameters<
              typeof IdentityBridgeGraphNodePresentation
            >[0] = {
              id: "device-current",
              data,
              x: 20,
              y: 354,
              width: 300,
            };
            return new IdentityBridgeGraphNodePresentation(nodeRequest).node;
          })(),
          (() => {
            const stageNodeArgs3: ConstructorParameters<
              typeof IdentityBridgeStagePresentation
            >[0] = {
              id: "stage-identity",
              label: input.copy.identityStage,
              flow: IdentityBridgeFlow.Vertical,
              x: 20,
              y: 580,
              width: 300,
            };
            return new IdentityBridgeStagePresentation(stageNodeArgs3).node;
          })(),
          (() => {
            const identityDataArgs: ConstructorParameters<
              typeof IdentityBridgeIdentityPresentation
            >[0] = {
              input,
              flow: IdentityBridgeFlow.Vertical,
              portMode: IdentityBridgePortMode.Both,
              lateralAccessPort: true,
            };
            const graphNodeArgs6: ConstructorParameters<
              typeof IdentityBridgeGraphNodePresentation
            >[0] = {
              id: "identity-current",
              data: new IdentityBridgeIdentityPresentation(identityDataArgs)
                .data,
              x: 40,
              y: identityY,
              width: 260,
            };
            return new IdentityBridgeGraphNodePresentation(graphNodeArgs6).node;
          })(),
          (() => {
            const stageNodeArgs4: ConstructorParameters<
              typeof IdentityBridgeStagePresentation
            >[0] = {
              id: "stage-vault",
              label: input.copy.vaultStage,
              flow: IdentityBridgeFlow.Vertical,
              x: 20,
              y: 870,
              width: 300,
            };
            return new IdentityBridgeStagePresentation(stageNodeArgs4).node;
          })(),
          ...vaultNodes,
        ],
        edges: [
          (() => {
            const graphEdgeArgs: ConstructorParameters<
              typeof IdentityBridgeEdgePresentation
            >[0] = {
              id: "protection-to-device",
              source: "protection-current",
              target: "device-current",
              relation: IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
              ariaLabel: input.copy.protectionDeviceRelation,
              lateralAccessPort: false,
            };
            return new IdentityBridgeEdgePresentation(graphEdgeArgs).edge;
          })(),
          (() => {
            const graphEdgeArgs2: ConstructorParameters<
              typeof IdentityBridgeEdgePresentation
            >[0] = {
              id: "device-to-identity",
              source: "device-current",
              target: "identity-current",
              relation: IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
              ariaLabel: input.copy.appKeyIdentityRelation,
              lateralAccessPort: false,
            };
            return new IdentityBridgeEdgePresentation(graphEdgeArgs2).edge;
          })(),
          ...verifiedVaults.map((vault) =>
            (() => {
              const graphEdgeArgs3: ConstructorParameters<
                typeof IdentityBridgeEdgePresentation
              >[0] = {
                id: `identity-to-${vault.storeId}`,
                source: "identity-current",
                target: `vault-${vault.storeId}`,
                relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
                ariaLabel: input.copy.identityVaultRelation(vault.label),
                lateralAccessPort: true,
              };
              return new IdentityBridgeEdgePresentation(graphEdgeArgs3).edge;
            })(),
          ),
        ],
        compactHeight:
          vaultStartY + Math.max(1, verifiedVaults.length) * 190 + 24,
      };
    }

    const gap = 220;
    const identityY = Math.max(
      115,
      150 - ((verifiedVaults.length - 1) * gap) / 2,
    );
    const vaultStartY = Math.max(
      0,
      identityY - ((verifiedVaults.length - 1) * gap) / 2,
    );
    const vaultNodes = verifiedVaults.map(
      // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
      (vault, index) =>
        (() => {
          const vaultDataArgs2: ConstructorParameters<
            typeof IdentityBridgeVaultPresentation
          >[0] = {
            vault,
            input,
            flow: IdentityBridgeFlow.Horizontal,
            portMode: IdentityBridgePortMode.Target,
            lateralAccessPort: false,
          };
          const graphNodeArgs7: ConstructorParameters<
            typeof IdentityBridgeGraphNodePresentation
          >[0] = {
            id: `vault-${vault.storeId}`,
            data: new IdentityBridgeVaultPresentation(vaultDataArgs2).data,
            x: 800,
            y: vaultStartY + index * gap,
            width: 350,
          };
          return new IdentityBridgeGraphNodePresentation(graphNodeArgs7).node;
        })(),
    );
    if (verifiedVaults.length === 0) {
      const graphNodeArgs8: ConstructorParameters<
        typeof IdentityBridgeGraphNodePresentation
      >[0] = {
        id: "vault-empty",
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
      };
      vaultNodes.push(
        new IdentityBridgeGraphNodePresentation(graphNodeArgs8).node,
      );
    }
    return {
      nodes: [
        (() => {
          const stageNodeArgs5: ConstructorParameters<
            typeof IdentityBridgeStagePresentation
          >[0] = {
            id: "stage-protection",
            label: input.copy.protectionStage,
            flow: IdentityBridgeFlow.Horizontal,
            x: 0,
            y: -54,
            width: 320,
          };
          return new IdentityBridgeStagePresentation(stageNodeArgs5).node;
        })(),
        (() => {
          const stageNodeArgs6: ConstructorParameters<
            typeof IdentityBridgeStagePresentation
          >[0] = {
            id: "stage-device",
            label: input.copy.deviceStage,
            flow: IdentityBridgeFlow.Horizontal,
            x: 350,
            y: -54,
            width: 190,
          };
          return new IdentityBridgeStagePresentation(stageNodeArgs6).node;
        })(),
        (() => {
          const stageNodeArgs7: ConstructorParameters<
            typeof IdentityBridgeStagePresentation
          >[0] = {
            id: "stage-identity",
            label: input.copy.identityStage,
            flow: IdentityBridgeFlow.Horizontal,
            x: 570,
            y: -54,
            width: 180,
          };
          return new IdentityBridgeStagePresentation(stageNodeArgs7).node;
        })(),
        (() => {
          const stageNodeArgs8: ConstructorParameters<
            typeof IdentityBridgeStagePresentation
          >[0] = {
            id: "stage-vault",
            label: input.copy.vaultStage,
            flow: IdentityBridgeFlow.Horizontal,
            x: 800,
            y: -54,
            width: 350,
          };
          return new IdentityBridgeStagePresentation(stageNodeArgs8).node;
        })(),
        (() => {
          const data = (() => {
            const protectionDataArgs2: ConstructorParameters<
              typeof IdentityBridgeProtectionPresentation
            >[0] = {
              input,
              flow: IdentityBridgeFlow.Horizontal,
            };
            return new IdentityBridgeProtectionPresentation(protectionDataArgs2)
              .data;
          })();
          const nodeRequest: ConstructorParameters<
            typeof IdentityBridgeGraphNodePresentation
          >[0] = {
            id: "protection-current",
            data,
            x: 0,
            y: identityY,
            width: 320,
          };
          return new IdentityBridgeGraphNodePresentation(nodeRequest).node;
        })(),
        (() => {
          const data = (() => {
            const deviceDataArgs2: ConstructorParameters<
              typeof IdentityBridgeDevicePresentation
            >[0] = {
              input,
              flow: IdentityBridgeFlow.Horizontal,
              portMode: IdentityBridgePortMode.Both,
              incomingRelation: input.copy.protectionDeviceRelation,
            };
            return new IdentityBridgeDevicePresentation(deviceDataArgs2).data;
          })();
          const nodeRequest: ConstructorParameters<
            typeof IdentityBridgeGraphNodePresentation
          >[0] = {
            id: "device-current",
            data,
            x: 350,
            y: identityY,
            width: 190,
          };
          return new IdentityBridgeGraphNodePresentation(nodeRequest).node;
        })(),
        (() => {
          const identityDataArgs2: ConstructorParameters<
            typeof IdentityBridgeIdentityPresentation
          >[0] = {
            input,
            flow: IdentityBridgeFlow.Horizontal,
            portMode: IdentityBridgePortMode.Both,
            lateralAccessPort: false,
          };
          const graphNodeArgs11: ConstructorParameters<
            typeof IdentityBridgeGraphNodePresentation
          >[0] = {
            id: "identity-current",
            data: new IdentityBridgeIdentityPresentation(identityDataArgs2)
              .data,
            x: 570,
            y: identityY,
            width: 180,
          };
          return new IdentityBridgeGraphNodePresentation(graphNodeArgs11).node;
        })(),
        ...vaultNodes,
      ],
      edges: [
        (() => {
          const graphEdgeArgs4: ConstructorParameters<
            typeof IdentityBridgeEdgePresentation
          >[0] = {
            id: "protection-to-device",
            source: "protection-current",
            target: "device-current",
            relation: IdentityBridgeRelationKind.ProtectionUnlocksDeviceKey,
            ariaLabel: input.copy.protectionDeviceRelation,
            lateralAccessPort: false,
          };
          return new IdentityBridgeEdgePresentation(graphEdgeArgs4).edge;
        })(),
        (() => {
          const graphEdgeArgs5: ConstructorParameters<
            typeof IdentityBridgeEdgePresentation
          >[0] = {
            id: "device-to-identity",
            source: "device-current",
            target: "identity-current",
            relation: IdentityBridgeRelationKind.AppKeyBelongsToIdentity,
            ariaLabel: input.copy.appKeyIdentityRelation,
            lateralAccessPort: false,
          };
          return new IdentityBridgeEdgePresentation(graphEdgeArgs5).edge;
        })(),
        ...verifiedVaults.map((vault) =>
          (() => {
            const graphEdgeArgs6: ConstructorParameters<
              typeof IdentityBridgeEdgePresentation
            >[0] = {
              id: `identity-to-${vault.storeId}`,
              source: "identity-current",
              target: `vault-${vault.storeId}`,
              relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
              ariaLabel: input.copy.identityVaultRelation(vault.label),
              lateralAccessPort: false,
            };
            return new IdentityBridgeEdgePresentation(graphEdgeArgs6).edge;
          })(),
        ),
      ],
      compactHeight: 0,
    };
  }
  private vaultGraph(): IdentityBridgeDefinition {
    const input = this.request;
    const selectedVault = input.vaults.find(
      (vault) =>
        input.selectedVault.kind ===
          IdentityBridgeVaultSelectionKind.Selected &&
        vault.storeId === input.selectedVault.storeId,
    );
    if (!selectedVault) {
      const compact = input.compact;
      const width = compact ? 300 : 370;
      return {
        nodes: [
          (() => {
            const stageNodeArgs9: ConstructorParameters<
              typeof IdentityBridgeStagePresentation
            >[0] = {
              id: "stage-vault",
              label: input.copy.selectedVaultStage,
              flow: IdentityBridgeFlow.Vertical,
              x: compact ? 20 : 350,
              y: compact ? 0 : -54,
              width,
            };
            return new IdentityBridgeStagePresentation(stageNodeArgs9).node;
          })(),
          (() => {
            const graphNodeArgs12: ConstructorParameters<
              typeof IdentityBridgeGraphNodePresentation
            >[0] = {
              id: "vault-empty",
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
            };
            return new IdentityBridgeGraphNodePresentation(graphNodeArgs12)
              .node;
          })(),
        ],
        edges: [],
        compactHeight: compact ? 280 : 0,
      };
    }
    const verifiedDeviceAccess = selectedVault.verified;
    const compact = input.compact;
    const flow = compact
      ? IdentityBridgeFlow.Vertical
      : IdentityBridgeFlow.Horizontal;
    const vaultX = compact ? 20 : 0;
    const vaultY = compact ? 44 : 115;
    const deviceX = compact ? 20 : 590;
    const deviceY = compact ? 360 : 115;
    const vaultWidth = compact ? 300 : 350;
    const deviceWidth = compact ? 300 : 310;
    const nodes: IdentityBridgeNode[] = [
      (() => {
        const stageNodeArgs10: ConstructorParameters<
          typeof IdentityBridgeStagePresentation
        >[0] = {
          id: "stage-vault",
          label: input.copy.selectedVaultStage,
          flow,
          x: compact ? 20 : 0,
          y: compact ? 0 : 0,
          width: vaultWidth,
        };
        return new IdentityBridgeStagePresentation(stageNodeArgs10).node;
      })(),
      (() => {
        const vaultDataArgs3: ConstructorParameters<
          typeof IdentityBridgeVaultPresentation
        >[0] = {
          vault: selectedVault,
          input,
          flow,
          portMode: verifiedDeviceAccess
            ? IdentityBridgePortMode.Source
            : IdentityBridgePortMode.None,
          lateralAccessPort: false,
        };
        const graphNodeArgs13: ConstructorParameters<
          typeof IdentityBridgeGraphNodePresentation
        >[0] = {
          id: "vault-selected",
          data: new IdentityBridgeVaultPresentation(vaultDataArgs3).data,
          x: vaultX,
          y: vaultY,
          width: vaultWidth,
        };
        return new IdentityBridgeGraphNodePresentation(graphNodeArgs13).node;
      })(),
      (() => {
        const stageNodeArgs11: ConstructorParameters<
          typeof IdentityBridgeStagePresentation
        >[0] = {
          id: "stage-device",
          label: input.copy.deviceStage,
          flow,
          x: compact ? 20 : 590,
          y: compact ? 310 : 0,
          width: compact ? 300 : 310,
        };
        return new IdentityBridgeStagePresentation(stageNodeArgs11).node;
      })(),
    ];
    if (verifiedDeviceAccess) {
      nodes.push(
        (() => {
          const data = (() => {
            const deviceDataArgs3: ConstructorParameters<
              typeof IdentityBridgeDevicePresentation
            >[0] = {
              input,
              flow,
              portMode: IdentityBridgePortMode.Target,
              incomingRelation: input.copy.vaultDeviceRelation(
                selectedVault.label,
              ),
            };
            return new IdentityBridgeDevicePresentation(deviceDataArgs3).data;
          })();
          const nodeRequest: ConstructorParameters<
            typeof IdentityBridgeGraphNodePresentation
          >[0] = {
            id: "device-current",
            data,
            x: deviceX,
            y: deviceY,
            width: deviceWidth,
          };
          return new IdentityBridgeGraphNodePresentation(nodeRequest).node;
        })(),
      );
    } else {
      const graphNodeArgs14: ConstructorParameters<
        typeof IdentityBridgeGraphNodePresentation
      >[0] = {
        id: "device-empty",
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
      };
      nodes.push(new IdentityBridgeGraphNodePresentation(graphNodeArgs14).node);
    }
    return {
      nodes,
      edges: verifiedDeviceAccess
        ? [
            (() => {
              const graphEdgeArgs7: ConstructorParameters<
                typeof IdentityBridgeEdgePresentation
              >[0] = {
                id: "vault-to-device",
                source: "vault-selected",
                target: "device-current",
                relation: IdentityBridgeRelationKind.VerifiedDeviceAccess,
                ariaLabel: input.copy.vaultDeviceRelation(selectedVault.label),
                lateralAccessPort: false,
              };
              return new IdentityBridgeEdgePresentation(graphEdgeArgs7).edge;
            })(),
          ]
        : [],
      compactHeight: compact ? 650 : 0,
    };
  }
}

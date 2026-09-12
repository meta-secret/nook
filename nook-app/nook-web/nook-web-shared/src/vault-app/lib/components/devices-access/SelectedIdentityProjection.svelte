<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AriaLabelConfig } from "@xyflow/svelte";
  import {
    DeviceAccessProtectionKind,
    NookIdentityLocalAccessKind,
  } from "$app-wasm";
  import { I18N_KEYS } from "../../../../generated/i18n-keys";
  import type { VaultState } from "../../vault.svelte";
  import {
    DashboardReadyProjectionKind,
    DevicesAccessRepresentationKind,
    type DashboardView,
  } from "../devices-access-dashboard-state";
  import { AccessChainPresentation } from "./access-chain";
  import IdentityBridgeGraph from "./IdentityBridgeGraph.svelte";
  import IdentityBridgeNavigation from "./IdentityBridgeNavigation.svelte";
  import {
    IdentityBridgeDeviceIconKind,
    IdentityBridgePerspective,
    IdentityBridgeVaultSelectionKind,
    type IdentityBridgeCopy,
    type IdentityBridgeVaultSelection,
  } from "./identity-bridge-model";
  import { PasskeyCardPresentation } from "./passkey-card";
  import {
    SelectedIdentityVault,
    type SelectedIdentityVaultRequest,
  } from "./selected-identity-vault";
  import type {
    DevicesAccessDashboardReadyProjectionState,
    IdentityDirectoryEntry,
  } from "./identity-directory-view";

  let {
    projection,
    children,
    vault,
    selectedRepresentation,
    selectedPerspective,
    selectedVault,
    onPerspective,
    onVault,
  }: {
    projection: DevicesAccessDashboardReadyProjectionState;
    children: Snippet<[IdentityDirectoryEntry, DashboardView]>;
    vault: VaultState;
    selectedRepresentation: DevicesAccessRepresentationKind;
    selectedPerspective: IdentityBridgePerspective;
    selectedVault: IdentityBridgeVaultSelection;
    onPerspective: (perspective: IdentityBridgePerspective) => void;
    onVault: (storeId: string) => void;
  } = $props();
</script>

{#if projection.kind === DashboardReadyProjectionKind.Selected}
  {@const identity = projection.identity}
  {@const view: DashboardView = {
    ...projection.accessView,
    vaults: [...identity.vaults],
  }}
  {@render children(identity, view)}
  {#if identity.localAccess === NookIdentityLocalAccessKind.OtherInstallation}
    <div
      class="mt-8 rounded-lg border border-border bg-muted/30 p-5"
      data-testid="devices-access-other-identity-notice"
    >
      <p class="text-sm font-medium text-foreground">
        {vault.t(I18N_KEYS.DevicesAccessOtherIdentityEvidenceTitle)}
      </p>
      <p
        class="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground"
      >
        {vault.t(I18N_KEYS.DevicesAccessOtherIdentityEvidenceUnavailable)}
      </p>
    </div>
  {:else if selectedRepresentation === DevicesAccessRepresentationKind.Graph}
    {@const verifiedVaultCount = view.vaults.filter(
      (entry) => entry.verified,
    ).length}
    {@const selectedVaultRequest: SelectedIdentityVaultRequest = {
                  selection: selectedVault,
                  vaults: identity.vaults,
                  fallbackLabel: vault.t(I18N_KEYS.DevicesAccessBridgeVault),
                }}
    {@const selectedVaultView = new SelectedIdentityVault(selectedVaultRequest)}
    {@const selectedVaultIsVerified = selectedVaultView.verified}
    {@const selectedVaultName = selectedVaultView.label}
    {@const selectedVaultExists =
      selectedVault.kind === IdentityBridgeVaultSelectionKind.Selected}
    {@const deviceIdentifier = view.deviceId.displayText(() =>
      vault.t(I18N_KEYS.DevicesAccessUnknown),
    )}
    {@const protectionSummaryRequest: ConstructorParameters<
                  typeof PasskeyCardPresentation
                >[0] = {
                  vault,
                  view,
                }}
    {@const protectionSummary = new PasskeyCardPresentation(
      protectionSummaryRequest,
    ).state}
    {@const companionIdentity =
      view.protection === DeviceAccessProtectionKind.CompanionSession}
    {@const identityTitle = companionIdentity
      ? vault.t(I18N_KEYS.DevicesAccessBridgeCompanionIdentity)
      : vault.t(I18N_KEYS.DevicesAccessBridgeCurrentIdentity)}
    {@const bridgeCopy = {
      protectionStage: vault.t(I18N_KEYS.DevicesAccessBridgeProtectionEvidence),
      deviceStage: vault.t(I18N_KEYS.DevicesAccessBridgeDeviceEvidence),
      identityStage: companionIdentity
        ? vault.t(I18N_KEYS.DevicesAccessBridgeCompanionIdentityContext)
        : vault.t(I18N_KEYS.DevicesAccessBridgeDistributedIdentity),
      vaultStage: vault.t(I18N_KEYS.DevicesAccessBridgeVaultGrants),
      selectedVaultStage: vault.t(I18N_KEYS.DevicesAccessBridgeSelectedVault),
      currentDevice:
        view.protection === DeviceAccessProtectionKind.PasskeyStandard
          ? vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice)
          : (() => {
              const deviceKeyTitleArgs: Parameters<
                AccessChainPresentation["deviceKeyTitle"]
              >[0] = { protection: view.protection };
              return new AccessChainPresentation(vault).deviceKeyTitle(
                deviceKeyTitleArgs,
              );
            })(),
      currentIdentity: identityTitle,
      selectedIdentity: companionIdentity
        ? vault.t(I18N_KEYS.DevicesAccessBridgeCompanionIdentityContext)
        : vault.t(I18N_KEYS.DevicesAccessBridgeSelectedIdentity),
      vaultGrant: vault.t(I18N_KEYS.DevicesAccessBridgeVaultGrant),
      deviceKey: vault.t(I18N_KEYS.DevicesAccessBridgeDetailDevice),
      oneDeviceKey: vault.t(I18N_KEYS.DevicesAccessBridgeOneDeviceKey),
      identityDescription: (() => {
        const protectionLabelArgs: Parameters<
          AccessChainPresentation["protectionLabel"]
        >[0] = { protection: view.protection };
        return new AccessChainPresentation(vault).protectionLabel(
          protectionLabelArgs,
        );
      })(),
      identityState: (() => {
        const identityStateLabelArgs: Parameters<
          AccessChainPresentation["identityStateLabel"]
        >[0] = { state: view.identityState };
        return new AccessChainPresentation(vault).identityStateLabel(
          identityStateLabelArgs,
        );
      })(),
      deviceMetricLabel: vault.t(I18N_KEYS.DevicesAccessBridgeDeviceEvidence),
      vaultMetricLabel: vault.t(I18N_KEYS.DevicesAccessVerifiedVaultsLabel),
      verifiedVaultCount: (() => {
        const tArgs: Parameters<typeof vault.t>[0] = {
          key: I18N_KEYS.DevicesAccessBridgeVerifiedVaultCount,
          replacements: { count: String(verifiedVaultCount) },
        };
        return vault.t(tArgs);
      })(),
      statusMetricLabel: vault.t(I18N_KEYS.DevicesAccessStatusLabel),
      evidenceMetricLabel: vault.t(I18N_KEYS.DevicesAccessLastSuccessfulUse),
      verifiedStatus: vault.t(I18N_KEYS.DevicesAccessRouteVerified),
      unverifiedStatus: vault.t(I18N_KEYS.DevicesAccessRouteUnverified),
      noAuthorizedIdentity: vault.t(I18N_KEYS.DevicesAccessBridgeNoAuthorized),
      noAuthorizedIdentityDescription: vault.t(
        I18N_KEYS.DevicesAccessBridgeNoAuthorizedDesc,
      ),
      noVerifiedVaults: vault.t(I18N_KEYS.DevicesAccessBridgeNoVerifiedVaults),
      noVerifiedVaultsDescription: vault.t(
        I18N_KEYS.DevicesAccessBridgeNoVerifiedVaultsDesc,
      ),
      noSelectedVault: vault.t(I18N_KEYS.DevicesAccessBridgeNoSelectedVault),
      noSelectedVaultDescription: vault.t(
        I18N_KEYS.DevicesAccessBridgeNoSelectedVaultDesc,
      ),
      protectionDeviceRelation: vault.t(
        I18N_KEYS.DevicesAccessBridgeProtectionDeviceRelation,
      ),
      appKeyIdentityRelation: vault.t(
        I18N_KEYS.DevicesAccessBridgeAppKeyIdentityRelation,
      ),
      identityVaultRelation: (vaultLabel: string) =>
        (() => {
          const tArgs2: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.DevicesAccessBridgeIdentityVaultRelation,
            replacements: {
              vault: vaultLabel,
            },
          };
          return vault.t(tArgs2);
        })(),
      deviceVaultRelation: (vaultLabel: string) =>
        (() => {
          const tArgs3: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.DevicesAccessBridgeDeviceVaultRelation,
            replacements: {
              vault: vaultLabel,
            },
          };
          return vault.t(tArgs3);
        })(),
      vaultDeviceRelation: (vaultLabel: string) =>
        (() => {
          const tArgs4: Parameters<typeof vault.t>[0] = {
            key: I18N_KEYS.DevicesAccessBridgeVaultDeviceRelation,
            replacements: {
              vault: vaultLabel,
            },
          };
          return vault.t(tArgs4);
        })(),
      formatEvidence: (value: string) =>
        (() => {
          const formatAccessDateArgs: Parameters<
            AccessChainPresentation["formatAccessDate"]
          >[0] = { value };
          return new AccessChainPresentation(vault).formatAccessDate(
            formatAccessDateArgs,
          );
        })(),
      unknown: vault.t(I18N_KEYS.DevicesAccessUnknown),
    } satisfies IdentityBridgeCopy}
    <div class="mt-8" data-testid="devices-access-relationship-details">
      <div class="flex min-w-0 flex-col gap-6">
        <IdentityBridgeNavigation
          {vault}
          perspective={selectedPerspective}
          {selectedVault}
          vaults={view.vaults}
          {onPerspective}
          {onVault}
        />

        <div class="min-w-0">
          <div class="mb-6">
            <p class="access-micro-label text-primary">
              {selectedPerspective === IdentityBridgePerspective.Identities
                ? vault.t(I18N_KEYS.DevicesAccessBridgeIdentityView)
                : vault.t(I18N_KEYS.DevicesAccessBridgeVaultView)}
            </p>
            <h2
              class="mt-2 max-w-4xl text-3xl font-semibold tracking-[-0.025em] text-balance text-foreground sm:text-4xl"
            >
              {#if selectedPerspective === IdentityBridgePerspective.Identities}
                {(() => {
                  const tArgs5: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.DevicesAccessBridgeIdentityHeadline,
                    replacements: {
                      count: String(verifiedVaultCount),
                      vaults: vault.t(
                        verifiedVaultCount === 1
                          ? I18N_KEYS.DevicesAccessBridgeVaultSingular
                          : I18N_KEYS.DevicesAccessBridgeVaultPlural,
                      ),
                    },
                  };
                  return vault.t(tArgs5);
                })()}
              {:else if selectedVaultExists}
                {(() => {
                  const tArgs6: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.DevicesAccessBridgeVaultHeadline,
                    replacements: {
                      count: selectedVaultIsVerified ? "1" : "0",
                      identities: vault.t(
                        selectedVaultIsVerified
                          ? I18N_KEYS.DevicesAccessBridgeIdentitySingular
                          : I18N_KEYS.DevicesAccessBridgeIdentityPlural,
                      ),
                      vault: selectedVaultName,
                    },
                  };
                  return vault.t(tArgs6);
                })()}
              {:else}
                {vault.t(I18N_KEYS.DevicesAccessBridgeNoSelectedVault)}
              {/if}
            </h2>
            <p
              class="mt-3 max-w-[72ch] text-sm leading-relaxed text-pretty text-muted-foreground"
            >
              {selectedPerspective === IdentityBridgePerspective.Identities
                ? vault.t(I18N_KEYS.DevicesAccessBridgeIdentityLede)
                : selectedVaultExists
                  ? vault.t(I18N_KEYS.DevicesAccessBridgeVaultLede)
                  : vault.t(I18N_KEYS.DevicesAccessBridgeNoSelectedVaultDesc)}
            </p>
          </div>

          <IdentityBridgeGraph
            perspective={selectedPerspective}
            {selectedVault}
            {deviceIdentifier}
            identityStatus={view.identityState}
            {protectionSummary}
            protectionLabel={(() => {
              const protectionLabelArgs2: Parameters<
                AccessChainPresentation["protectionLabel"]
              >[0] = { protection: view.protection };
              return new AccessChainPresentation(vault).protectionLabel(
                protectionLabelArgs2,
              );
            })()}
            deviceIconKind={view.protection ===
            DeviceAccessProtectionKind.PasskeyStandard
              ? IdentityBridgeDeviceIconKind.RecoverableKey
              : view.protection === DeviceAccessProtectionKind.CompanionSession
                ? IdentityBridgeDeviceIconKind.PairedDevice
                : IdentityBridgeDeviceIconKind.Browser}
            vaults={view.vaults}
            copy={bridgeCopy}
            graphLabel={vault.t(I18N_KEYS.DevicesAccessBridgeGraphLabel)}
            controlsLabel={vault.t(I18N_KEYS.DevicesAccessBridgeGraphControls)}
            ariaLabelConfig={{
              "node.a11yDescription.default": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yNode,
              ),
              "node.a11yDescription.keyboardDisabled": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yNode,
              ),
              "node.a11yDescription.ariaLiveMessage": ({
                direction,
                x,
                y,
              }: Parameters<
                NonNullable<
                  AriaLabelConfig["node.a11yDescription.ariaLiveMessage"]
                >
              >[0]) =>
                (() => {
                  const tArgs7: Parameters<typeof vault.t>[0] = {
                    key: I18N_KEYS.DevicesAccessBridgeA11yNodeMoved,
                    replacements: {
                      direction,
                      x: String(x),
                      y: String(y),
                    },
                  };
                  return vault.t(tArgs7);
                })(),
              "edge.a11yDescription.default": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yEdge,
              ),
              "controls.ariaLabel": vault.t(
                I18N_KEYS.DevicesAccessBridgeGraphControls,
              ),
              "controls.zoomIn.ariaLabel": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yZoomIn,
              ),
              "controls.zoomOut.ariaLabel": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yZoomOut,
              ),
              "controls.fitView.ariaLabel": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yFitView,
              ),
              "controls.interactive.ariaLabel": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yInteractivity,
              ),
              "minimap.ariaLabel": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yMinimap,
              ),
              "handle.ariaLabel": vault.t(
                I18N_KEYS.DevicesAccessBridgeA11yHandle,
              ),
            }}
          />
        </div>
      </div>
    </div>
  {/if}
{/if}

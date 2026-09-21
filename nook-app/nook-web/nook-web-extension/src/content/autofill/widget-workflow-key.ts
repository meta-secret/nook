import {
  type AuthenticationObservationBindingToken,
  type AuthenticationPageObservationFacts,
  type AuthenticationPageObservationFactsBatch,
  type AuthenticationWorkflowSnapshot,
  type WebsiteLoginMatchAvailability,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { CompanionWasmSessionMessageType } from '../../../../nook-web-shared/src/extension/companion-wasm-runtime-messages'
import {
  RuntimeMessageDeliveryKind,
  authenticationRuntimeTransport,
} from './runtime-message-adapter'

import type { WidgetVaultPresentation } from './widget-presentation-state'

type AuthenticationWidgetWorkflowKeyRequest = {
  snapshot: AuthenticationWorkflowSnapshot
  loginMatches: WebsiteLoginMatchAvailability
  vaultPresentation: WidgetVaultPresentation
  facts: AuthenticationPageObservationFacts
}

/** Binds a rendered widget and its approval to the same Rust-selected facts. */
export async function authenticationWidgetWorkflowKey({
  snapshot,
  loginMatches,
  vaultPresentation,
  facts,
}: AuthenticationWidgetWorkflowKeyRequest): Promise<string | false> {
  const factsBatch: AuthenticationPageObservationFactsBatch = {
    observations: [facts],
  }
  const binding =
    await authenticationRuntimeTransport.sendCompanionWasmRuntimeMessage({
      type: CompanionWasmSessionMessageType.BindAuthenticationPageObservationFacts,
      payload: { facts: factsBatch },
    })
  if (
    binding.kind === RuntimeMessageDeliveryKind.Unavailable ||
    typeof binding.response !== 'string'
  ) {
    return false
  }
  const factsBindingToken: AuthenticationObservationBindingToken = binding.response
  return [
    snapshot.kind,
    snapshot.stage,
    snapshot.action,
    snapshot.currentStep,
    snapshot.totalSteps,
    snapshot.observationIndex,
    loginMatches.kind,
    'count' in loginMatches ? loginMatches.count : 0,
    vaultPresentation.kind,
    'vaultName' in vaultPresentation ? vaultPresentation.vaultName : '',
    factsBindingToken,
  ].join(':')
}

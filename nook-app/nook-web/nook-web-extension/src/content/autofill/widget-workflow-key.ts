import {
  bind_authentication_page_observation_facts,
  type AuthenticationObservationBindingToken,
  type AuthenticationPageObservationFacts,
  type AuthenticationPageObservationFactsBatch,
  type AuthenticationWorkflowSnapshot,
  type WebsiteLoginMatchAvailability,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

import type { WidgetVaultPresentation } from './widget-presentation-state'

type AuthenticationWidgetWorkflowKeyRequest = {
  snapshot: AuthenticationWorkflowSnapshot
  loginMatches: WebsiteLoginMatchAvailability
  vaultPresentation: WidgetVaultPresentation
  facts: AuthenticationPageObservationFacts
}

/** Binds a rendered widget and its approval to the same Rust-selected facts. */
export function authenticationWidgetWorkflowKey({
  snapshot,
  loginMatches,
  vaultPresentation,
  facts,
}: AuthenticationWidgetWorkflowKeyRequest): string {
  const factsBatch: AuthenticationPageObservationFactsBatch = {
    observations: [facts],
  }
  const factsBindingToken: AuthenticationObservationBindingToken =
    bind_authentication_page_observation_facts(factsBatch)
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

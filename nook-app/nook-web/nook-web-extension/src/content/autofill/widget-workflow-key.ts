import {
  bind_authentication_page_observation_facts,
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
  factsBindingToken?: string | false
}

/** Binds a rendered widget and its approval to the same Rust-selected facts. */
export async function authenticationWidgetWorkflowKey({
  snapshot,
  loginMatches,
  vaultPresentation,
  facts,
  factsBindingToken,
}: AuthenticationWidgetWorkflowKeyRequest): Promise<string | false> {
  let bindingToken = factsBindingToken
  if (!bindingToken && !(typeof chrome === 'object' && chrome.runtime?.id)) {
    const batch: AuthenticationPageObservationFactsBatch = {
      observations: [facts],
    }
    bindingToken = bind_authentication_page_observation_facts(batch)
  }
  if (!bindingToken) return false
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
    bindingToken,
  ].join(':')
}

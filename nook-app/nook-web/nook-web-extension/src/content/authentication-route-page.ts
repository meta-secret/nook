import {
  notifyAuthenticationSubmitValueAssigned,
  observeAuthenticationSubmitValueAssignments,
} from '../../../nook-web-shared/src/extension/authentication-fact-attributes'
import {
  notifyAuthenticationRouteChanged,
  observeAuthenticationRouteHistory,
} from '../../../nook-web-shared/src/extension/authentication-route-history'

observeAuthenticationRouteHistory(notifyAuthenticationRouteChanged)
observeAuthenticationSubmitValueAssignments(
  notifyAuthenticationSubmitValueAssigned,
)

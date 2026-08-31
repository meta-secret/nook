import {
  notifyAuthenticationSubmitValueAssigned,
  observeAuthenticationSubmitValueAssignments,
} from '../../../nook-web-shared/src/extension/authentication-fact-attributes'
import {
  notifyAuthenticationRouteChanged,
  observeAuthenticationRouteHistory,
} from '../../../nook-web-shared/src/extension/authentication-route-history'
import { installPageAuthenticationDirectSubmitBridge } from '../../../nook-web-shared/src/extension/authentication-direct-submit-bridge'

observeAuthenticationRouteHistory(notifyAuthenticationRouteChanged)
observeAuthenticationSubmitValueAssignments(
  notifyAuthenticationSubmitValueAssigned,
)
installPageAuthenticationDirectSubmitBridge()

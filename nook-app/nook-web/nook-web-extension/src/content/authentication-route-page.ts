import { authenticationFactObserver } from '../../../nook-web-shared/src/extension/authentication-fact-attributes'
import { authenticationRouteBrowser } from '../../../nook-web-shared/src/extension/authentication-route-history'
import { authenticationSubmissionBridge } from '../../../nook-web-shared/src/extension/authentication-direct-submit-bridge'

authenticationRouteBrowser.observeAuthenticationRouteHistory(
  authenticationRouteBrowser.notifyAuthenticationRouteChanged.bind(
    authenticationRouteBrowser,
  ),
)
authenticationFactObserver.observeAuthenticationSubmitValueAssignments(
  authenticationFactObserver.notifyAuthenticationSubmitValueAssigned.bind(
    authenticationFactObserver,
  ),
)
authenticationSubmissionBridge.installPageAuthenticationDirectSubmitBridge()

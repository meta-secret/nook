import {
  notifyAuthenticationRouteChanged,
  observeAuthenticationRouteHistory,
} from '../../../nook-web-shared/src/extension/authentication-route-history'

observeAuthenticationRouteHistory(notifyAuthenticationRouteChanged)

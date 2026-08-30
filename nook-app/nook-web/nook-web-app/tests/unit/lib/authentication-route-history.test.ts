import { afterEach, describe, expect, test } from 'vitest'
import { observeAuthenticationRouteHistory } from '../../../../nook-web-shared/src/extension/authentication-route-history'

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('authentication route history', () => {
  test('notifies on pushState, replaceState, and popstate without DOM mutations', () => {
    const routes: string[] = []
    const stop = observeAuthenticationRouteHistory(() => {
      routes.push(location.pathname)
    })

    window.history.pushState({}, '', '/login')
    window.history.replaceState({}, '', '/login/verify')
    window.dispatchEvent(new PopStateEvent('popstate'))

    stop()
    window.history.pushState({}, '', '/ignored')

    expect(routes).toEqual(['/login', '/login/verify', '/login/verify'])
  })
})

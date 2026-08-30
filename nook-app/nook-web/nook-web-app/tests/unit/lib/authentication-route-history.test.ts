import { afterEach, describe, expect, test } from 'vitest'
import {
  AUTHENTICATION_ROUTE_HISTORY_SOURCE,
  isAuthenticationRouteHistoryMessage,
  notifyAuthenticationRouteChanged,
  observeAuthenticationRouteHistory,
} from '../../../../nook-web-shared/src/extension/authentication-route-history'

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

  test('notifies on Navigation API same-document entry changes', () => {
    const listeners: Array<() => void> = []
    const navigation = {
      addEventListener(type: string, listener: () => void) {
        if (type === 'currententrychange') listeners.push(listener)
      },
      removeEventListener(type: string, listener: () => void) {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      },
    }
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: navigation,
    })
    const routes: string[] = []
    const stop = observeAuthenticationRouteHistory(() => {
      routes.push(location.pathname)
    })
    listeners[0]?.()
    stop()
    listeners[0]?.()
    Reflect.deleteProperty(window, 'navigation')
    expect(routes).toEqual(['/'])
    expect(listeners).toHaveLength(0)
  })

  test('notifies on hashchange without DOM mutations', () => {
    const routes: string[] = []
    const stop = observeAuthenticationRouteHistory(() => {
      routes.push(location.hash)
    })

    window.location.hash = '#/login'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    stop()
    window.location.hash = '#/ignored'

    expect(routes).toEqual(['#/login'])
  })

  test('bridges MAIN-world navigation to the isolated listener', () => {
    const posted: Array<{ message: unknown; targetOrigin: string }> = []
    const originalPostMessage = window.postMessage.bind(window)
    window.postMessage = ((message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin })
    }) as typeof window.postMessage
    notifyAuthenticationRouteChanged()
    window.postMessage = originalPostMessage

    expect(posted).toEqual([
      {
        message: { source: AUTHENTICATION_ROUTE_HISTORY_SOURCE },
        targetOrigin: location.origin,
      },
    ])
    const event = new MessageEvent('message', {
      data: { source: AUTHENTICATION_ROUTE_HISTORY_SOURCE },
      origin: location.origin,
      source: window,
    })
    expect(isAuthenticationRouteHistoryMessage(event)).toBe(true)
    expect(AUTHENTICATION_ROUTE_HISTORY_SOURCE).toBe(
      'nook-authentication-route-v1',
    )
  })

  test('does not post route notifications to an opaque origin', () => {
    const posted: Array<{ message: unknown; targetOrigin: string }> = []
    const originalPostMessage = window.postMessage.bind(window)
    window.postMessage = ((message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin })
      if (targetOrigin === 'null') {
        throw new Error('opaque origin')
      }
    }) as typeof window.postMessage
    const originalOrigin = location.origin
    Object.defineProperty(location, 'origin', {
      configurable: true,
      value: 'null',
    })
    expect(() => notifyAuthenticationRouteChanged()).not.toThrow()
    expect(posted).toEqual([])
    Object.defineProperty(location, 'origin', {
      configurable: true,
      value: originalOrigin,
    })
    window.postMessage = originalPostMessage
    expect(
      isAuthenticationRouteHistoryMessage(
        new MessageEvent('message', {
          data: { source: AUTHENTICATION_ROUTE_HISTORY_SOURCE },
          origin: 'null',
          source: window,
        }),
      ),
    ).toBe(false)
  })
})

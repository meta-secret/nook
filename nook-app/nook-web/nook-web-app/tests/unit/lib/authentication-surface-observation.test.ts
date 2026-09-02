import { afterEach, describe, expect, test } from 'vitest'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  authenticationMutationImpact,
  mutationBelongsOnlyToMountedWidget,
  mutationCanChangeAuthenticationWorkflows,
  mutationTouchesAuthenticationWorkflow,
} from '../../../../nook-web-extension/src/content/autofill/authentication-surface-observation'

function childListMutation(
  target: Node,
  addedNodes: Node[] = [],
  removedNodes: Node[] = [],
): MutationRecord {
  return {
    type: 'childList',
    target,
    addedNodes,
    removedNodes,
  } as unknown as MutationRecord
}

function attributeMutation(target: Node): MutationRecord {
  return { type: 'attributes', target } as MutationRecord
}

function observation(form: HTMLFormElement): PasswordFormObservation {
  return {
    root: document,
    formScope: { kind: 'owned', owner: form },
    summary: {
      passwordFieldCount: 1,
      currentPasswordFieldCount: 1,
      newPasswordFieldCount: 0,
      genericPasswordFieldCount: 0,
      usernameFieldCount: 1,
      oneTimeCodeFieldCount: 0,
      manualCheckpointPresent: false,
      passkeyControlPresent: false,
      formCount: 1,
      observedAt: 1,
    },
  } as unknown as PasswordFormObservation
}

afterEach(() => document.body.replaceChildren())

describe('authentication surface mutation filtering', () => {
  test('ignores mutations owned entirely by the mounted extension widget', () => {
    const host = document.createElement('section')
    const child = document.createElement('button')
    host.append(child)

    const childAttributeRequest: Parameters<
      typeof mutationBelongsOnlyToMountedWidget
    >[0] = { record: attributeMutation(child), mountedHost: host }
    expect(mutationBelongsOnlyToMountedWidget(childAttributeRequest)).toBe(true)

    const hostInsertionRequest: Parameters<
      typeof mutationBelongsOnlyToMountedWidget
    >[0] = {
      record: childListMutation(document.body, [host]),
      mountedHost: host,
    }
    expect(mutationBelongsOnlyToMountedWidget(hostInsertionRequest)).toBe(true)

    const formInsertionRequest: Parameters<
      typeof mutationBelongsOnlyToMountedWidget
    >[0] = {
      record: childListMutation(document.body, [
        document.createElement('form'),
      ]),
      mountedHost: host,
    }
    expect(mutationBelongsOnlyToMountedWidget(formInsertionRequest)).toBe(false)
  })

  test('tracks externally associated controls as part of an owned form', () => {
    document.body.innerHTML = `
      <form id="login"><input autocomplete="username" /></form>
      <button id="submit" form="login" type="submit">Sign in</button>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    const submit = document.querySelector<HTMLButtonElement>('#submit')
    if (!form || !submit) throw new Error('expected form fixture')

    const request: Parameters<typeof mutationTouchesAuthenticationWorkflow>[0] =
      {
        record: attributeMutation(submit),
        workflow: observation(form),
      }
    expect(mutationTouchesAuthenticationWorkflow(request)).toBe(true)
  })

  test('observes submit destination changes', () => {
    expect(AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER).toContain('formaction')
  })

  test('keeps the rendered workflow mounted for unrelated controls', () => {
    document.body.innerHTML = `
      <form id="login"><input type="password" /></form>
      <button id="navigation">Next slide</button>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    const navigation = document.querySelector<HTMLButtonElement>('#navigation')
    if (!form || !navigation) throw new Error('expected mutation fixture')
    const request: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [attributeMutation(navigation)],
      mountedHost: false,
      renderedWorkflow: observation(form),
    }
    expect(authenticationMutationImpact(request)).toEqual({
      shouldRemountRenderedWorkflow: false,
      shouldScheduleScan: true,
    })
  })

  test('ignores unrelated prose and a detached Nook host', () => {
    const prose = document.createTextNode('12:01')
    document.body.append(prose)
    const textMutation = {
      type: 'characterData',
      target: prose,
    } as unknown as MutationRecord
    const detachedHost = document.createElement('section')
    detachedHost.id = 'nook-auth-widget'
    const hostRemoval = childListMutation(document.body, [], [detachedHost])
    for (const record of [textMutation, hostRemoval]) {
      const request: Parameters<typeof authenticationMutationImpact>[0] = {
        records: [record],
        mountedHost: false,
        renderedWorkflow: false,
      }
      expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(
        false,
      )
    }
  })

  test('rescans controls and forms without treating prose as auth evidence', () => {
    const form = document.createElement('form')
    form.innerHTML = '<input type="password" />'
    expect(
      mutationCanChangeAuthenticationWorkflows(
        childListMutation(document.body, [form]),
      ),
    ).toBe(true)

    const prose = document.createElement('p')
    prose.textContent = 'Marketing copy changed'
    expect(
      mutationCanChangeAuthenticationWorkflows(
        childListMutation(document.body, [prose]),
      ),
    ).toBe(false)
  })

  test('rescans dynamically inserted passkey links and QR evidence', () => {
    const passkeyLink = document.createElement('a')
    passkeyLink.href = '/passkey'
    passkeyLink.setAttribute('aria-label', 'Use passkey')
    const qrImage = document.createElement('img')
    qrImage.alt = 'Authenticator QR code'

    for (const evidence of [passkeyLink, qrImage]) {
      const request: Parameters<typeof authenticationMutationImpact>[0] = {
        records: [childListMutation(document.body, [evidence])],
        mountedHost: false,
        renderedWorkflow: false,
      }
      expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(
        true,
      )
    }
  })
})

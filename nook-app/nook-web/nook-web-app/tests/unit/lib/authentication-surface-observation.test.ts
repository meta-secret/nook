import { afterEach, describe, expect, test } from 'vitest'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  authenticationMutationImpact,
  mutationBelongsOnlyToMountedWidget,
  mutationCanChangeAuthenticationWorkflows,
  mutationTouchesAuthenticationWorkflow,
  recordAuthenticationRecoveryEvidenceState,
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

afterEach(() => {
  document.body.replaceChildren()
  recordAuthenticationRecoveryEvidenceState()
})

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
    const paragraph = document.createElement('p')
    const prose = document.createTextNode('12:01')
    paragraph.append(prose)
    document.body.append(paragraph)
    const textMutation = {
      type: 'characterData',
      target: prose,
    } as unknown as MutationRecord
    const detachedHost = document.createElement('section')
    detachedHost.id = 'nook-auth-widget'
    const hostRemoval = childListMutation(document.body, [], [detachedHost])
    const paragraphInsertion = childListMutation(document.body, [paragraph])
    for (const record of [textMutation, paragraphInsertion, hostRemoval]) {
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

    const prose = document.createElement('div')
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

  test('rescans dynamically inserted and updated CAPTCHA frames', () => {
    const insertedFrame = document.createElement('iframe')
    insertedFrame.src = 'https://captcha.example.test/recaptcha'
    const updatedFrame = document.createElement('iframe')
    document.body.append(insertedFrame, updatedFrame)
    updatedFrame.title = 'Complete CAPTCHA'

    for (const record of [
      childListMutation(document.body, [insertedFrame]),
      attributeMutation(updatedFrame),
    ]) {
      const request: Parameters<typeof authenticationMutationImpact>[0] = {
        records: [record],
        mountedHost: false,
        renderedWorkflow: false,
      }
      expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(
        true,
      )
    }
  })

  test('rescans dynamically associated labels', () => {
    const input = document.createElement('input')
    input.id = 'login-email'
    document.body.append(input)
    const label = document.createElement('label')
    label.htmlFor = 'login-email'

    for (const record of [
      childListMutation(document.body, [label]),
      attributeMutation(label),
    ]) {
      const request: Parameters<typeof authenticationMutationImpact>[0] = {
        records: [record],
        mountedHost: false,
        renderedWorkflow: false,
      }
      expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(
        true,
      )
    }
  })

  test('rescans dynamically inserted backup-code evidence', () => {
    const heading = document.createElement('h2')
    heading.textContent = 'Recovery codes'
    const listItem = document.createElement('li')
    listItem.textContent = 'A1B2-C3D4-E5F6'
    const code = document.createElement('code')
    code.textContent = 'ABCD-EFGH-IJK1'
    const paragraph = document.createElement('p')
    const paragraphText = document.createTextNode('Backup codes')
    paragraph.append(paragraphText)
    document.body.append(heading, listItem, code, paragraph)

    for (const record of [
      childListMutation(document.body, [heading, listItem, code]),
      {
        type: 'characterData',
        target: paragraphText,
      } as unknown as MutationRecord,
    ]) {
      const request: Parameters<typeof authenticationMutationImpact>[0] = {
        records: [record],
        mountedHost: false,
        renderedWorkflow: false,
      }
      expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(
        true,
      )
    }
  })

  test('rescans when the last backup-code evidence disappears', () => {
    const heading = document.createElement('h2')
    heading.textContent = 'Recovery codes'
    const code = document.createElement('code')
    code.textContent = 'A1B2-C3D4-E5F6'
    document.body.append(heading, code)
    recordAuthenticationRecoveryEvidenceState()
    heading.remove()
    code.remove()
    const request: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [childListMutation(document.body, [], [heading, code])],
      mountedHost: false,
      renderedWorkflow: false,
    }

    expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(true)

    document.body.append(heading, code)
    recordAuthenticationRecoveryEvidenceState()
    heading.hidden = true
    const hiddenRequest: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [attributeMutation(heading)],
      mountedHost: false,
      renderedWorkflow: false,
    }
    expect(authenticationMutationImpact(hiddenRequest).shouldScheduleScan).toBe(
      true,
    )

    heading.hidden = false
    recordAuthenticationRecoveryEvidenceState()
    const headingText = heading.firstChild
    if (!(headingText instanceof Text)) {
      throw new Error('expected recovery heading text')
    }
    headingText.data = 'Account details'
    code.textContent = '12:01'
    const textRequest: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [
        {
          type: 'characterData',
          target: headingText,
        } as unknown as MutationRecord,
      ],
      mountedHost: false,
      renderedWorkflow: false,
    }
    expect(authenticationMutationImpact(textRequest).shouldScheduleScan).toBe(
      true,
    )
  })
})

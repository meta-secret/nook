import { afterEach, describe, expect, test } from 'vitest'
import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER,
  authenticationMutationImpact,
  mutationBelongsOnlyToMountedWidget,
  mutationCanChangeAuthenticationWorkflows,
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

function observation(
  form: HTMLFormElement,
  root: ParentNode = document,
): PasswordFormObservation {
  return {
    root,
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

  test('remounts for external controls and their native labels', () => {
    document.body.innerHTML = `
      <form id="login"><input autocomplete="username" /></form>
      <label id="submit-label" for="submit">Account action</label>
      <button id="submit" form="login" type="submit">Sign in</button>
    `
    const form = document.querySelector<HTMLFormElement>('#login')
    const submit = document.querySelector<HTMLButtonElement>('#submit')
    const label = document.querySelector<HTMLLabelElement>('#submit-label')
    const labelText = label?.firstChild
    if (!form || !submit || !label || !(labelText instanceof Text)) {
      throw new Error('expected form fixture')
    }

    for (const record of [
      attributeMutation(submit),
      attributeMutation(label),
      { type: 'characterData', target: labelText } as unknown as MutationRecord,
    ]) {
      const request: Parameters<typeof authenticationMutationImpact>[0] = {
        records: [record],
        mountedHost: false,
        renderedWorkflow: observation(form),
      }
      expect(
        authenticationMutationImpact(request).shouldRemountRenderedWorkflow,
      ).toBe(true)
    }
  })

  test('bounds invalidation while retaining explicit owner and label dependencies', () => {
    document.body.innerHTML = `<form id="login" action="/login"><header><input id="search" /><span id="username-label">Account</span></header>
      <main class="login-panel"><input aria-labelledby="username-label" autocomplete="username" /><input type="password" /></main>
      <footer><button type="submit">Subscribe</button></footer></form>`
    const form = document.querySelector<HTMLFormElement>('#login')
    const root = document.querySelector<HTMLElement>('.login-panel')
    const search = document.querySelector<HTMLInputElement>('#search')
    const label = document.querySelector<HTMLElement>('#username-label')
    if (!form || !root || !search || !label) {
      throw new Error('expected bounded mutation fixture')
    }
    const renderedWorkflow = observation(form, root)
    const insertedSearch = document.createElement('input')
    const impact = (record: MutationRecord) =>
      authenticationMutationImpact({
        records: [record],
        mountedHost: false,
        renderedWorkflow,
      }).shouldRemountRenderedWorkflow

    expect(impact(attributeMutation(search))).toBe(false)
    expect(impact(childListMutation(form, [insertedSearch]))).toBe(false)
    expect(impact(attributeMutation(form))).toBe(true)
    expect(impact(attributeMutation(label))).toBe(true)
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
    insertedFrame.src = 'about:blank#recaptcha'
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

  test('rescans text changes in externally referenced labels', () => {
    document.body.innerHTML = `
      <span id="action-label">Continue</span>
      <button aria-labelledby="action-label"></button>
    `
    const label = document.querySelector('#action-label')
    const labelText = label?.firstChild
    if (!(labelText instanceof Text)) throw new Error('expected label text')
    labelText.data = 'Use passkey'
    const request: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [
        {
          type: 'characterData',
          target: labelText,
        } as unknown as MutationRecord,
      ],
      mountedHost: false,
      renderedWorkflow: false,
    }

    expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(true)
  })

  test('rescans dynamically inserted email-verification checkpoints', () => {
    const checkpoint = document.createElement('div')
    checkpoint.textContent = 'Please verify your email before continuing.'
    document.body.append(checkpoint)
    const request: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [childListMutation(document.body, [checkpoint])],
      mountedHost: false,
      renderedWorkflow: false,
    }

    expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(true)
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
    heading.textContent = 'Backup codes'
    const instructions = document.createElement('p')
    instructions.textContent = 'Save these recovery codes somewhere secure.'
    const code = document.createElement('code')
    code.textContent = 'A1B2-C3D4-E5F6'
    document.body.append(heading, instructions, code)
    recordAuthenticationRecoveryEvidenceState()
    heading.remove()
    instructions.remove()
    code.remove()
    const request: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [
        childListMutation(document.body, [], [heading, instructions, code]),
      ],
      mountedHost: false,
      renderedWorkflow: false,
    }

    expect(authenticationMutationImpact(request).shouldScheduleScan).toBe(true)

    document.body.append(heading, instructions, code)
    recordAuthenticationRecoveryEvidenceState()
    heading.hidden = true
    instructions.hidden = true
    code.hidden = true
    const hiddenRequest: Parameters<typeof authenticationMutationImpact>[0] = {
      records: [attributeMutation(heading)],
      mountedHost: false,
      renderedWorkflow: false,
    }
    expect(authenticationMutationImpact(hiddenRequest).shouldScheduleScan).toBe(
      true,
    )

    heading.hidden = false
    instructions.hidden = false
    code.hidden = false
    recordAuthenticationRecoveryEvidenceState()
    const headingText = heading.firstChild
    if (!(headingText instanceof Text)) {
      throw new Error('expected recovery heading text')
    }
    headingText.data = 'Account details'
    instructions.textContent = 'Your account is ready.'
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

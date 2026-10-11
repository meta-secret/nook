import { afterEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { AuthenticationContainerIdentity } from '../../nook-web-shared/src/extension/password-form-container-identity'
import {
  AuthenticationFieldCandidateDiagnosticBuilder,
  AuthenticationFieldCandidateDisposition,
  AuthenticationFieldCandidateKind,
  AuthenticationFieldCandidateSelectorMatch,
  type AuthenticationFieldCandidateDiagnosticRequest,
} from '../../nook-web-shared/src/extension/password-form-field-candidate-diagnostics'
import {
  AuthenticationWorkflowScopeDiagnosticBuilder,
  AuthenticationWorkflowScopeDiagnosticCandidateKind,
  AuthenticationWorkflowScopeDiagnosticDisposition,
  type AuthenticationWorkflowScopeDiagnosticRequest,
} from '../../nook-web-shared/src/extension/password-form-scope-diagnostics'

class NamedFormFixture {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Happy DOM supplies the browser document contract in an isolated test realm.
  static readonly document = new Window().document as unknown as Document
  readonly document = NamedFormFixture.document
  readonly form = this.document.createElement('form')
  readonly username = this.document.createElement('input')
  readonly password = this.document.createElement('input')

  constructor(property: string) {
    this.form.setAttribute('id', 'login-form')
    this.form.setAttribute('class', 'account-panel')
    this.form.setAttribute('method', 'post')
    this.form.setAttribute('action', '/Account/Login')
    this.form.setAttribute('autocomplete', 'off')
    this.username.name = 'UserName'
    this.password.type = 'password'
    this.password.name = 'Password'
    const metadata = this.document.createElement('input')
    metadata.type = 'hidden'
    metadata.name = property
    metadata.value = 'private-form-value'
    const submit = this.document.createElement('button')
    submit.type = 'submit'
    submit.textContent = 'Log In'
    this.form.append(metadata, this.username, this.password, submit)
    this.document.body.append(this.form)
    // Happy DOM does not implement HTMLFormElement's named-property override.
    // Reproduce the browser contract here; the extension E2E uses native forms.
    const namedProperty: PropertyDescriptor = { value: metadata }
    Object.defineProperty(this.form, property, namedProperty)
  }

  fieldDiagnostic() {
    const request: AuthenticationFieldCandidateDiagnosticRequest = {
      field: this.password,
      candidateKind: AuthenticationFieldCandidateKind.Password,
      selectorMatch: AuthenticationFieldCandidateSelectorMatch.Password,
      disposition: AuthenticationFieldCandidateDisposition.Accepted,
      root: this.document,
    }
    return new AuthenticationFieldCandidateDiagnosticBuilder().build(request)
  }

  scopeDiagnostic() {
    const request: AuthenticationWorkflowScopeDiagnosticRequest = {
      field: this.username,
      container: this.form,
      candidateKind:
        AuthenticationWorkflowScopeDiagnosticCandidateKind.Username,
      candidateCount: 1,
      controls: [],
      gates: [],
      disposition: AuthenticationWorkflowScopeDiagnosticDisposition.Accepted,
    }
    return new AuthenticationWorkflowScopeDiagnosticBuilder().build(request)
  }
}

afterEach(() => NamedFormFixture.document.body.replaceChildren())

describe('login forms with named DOM properties', () => {
  test.each(['id', 'className'])(
    'reads attributes when a control shadows %s',
    (property) => {
      const fixture = new NamedFormFixture(property)
      const expectedAncestor = {
        tag: 'form',
        idTokens: ['login-form'],
        classTokens: ['account-panel'],
      }
      const field = fixture.fieldDiagnostic()
      const scope = fixture.scopeDiagnostic()
      expect(field.ancestors[0]).toMatchObject(expectedAncestor)
      expect(scope.ancestors[0]).toMatchObject(expectedAncestor)
      expect(JSON.stringify([field, scope])).not.toContain('private-form-value')
      expect(new AuthenticationContainerIdentity(fixture.form).text).toBe(
        'login-form account-panel',
      )
    },
  )

  test('does not invent identity attributes for an unnamed container', () => {
    const fixture = new NamedFormFixture('id')
    fixture.form.removeAttribute('id')
    fixture.form.removeAttribute('class')
    expect(new AuthenticationContainerIdentity(fixture.form).text).toBe('')
    expect(fixture.fieldDiagnostic().ancestors[0]?.idTokens).toEqual([])
    expect(fixture.scopeDiagnostic().ancestors[0]?.classTokens).toEqual([])
  })
})

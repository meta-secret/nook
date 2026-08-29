import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'

export const AUTHENTICATION_MUTATION_ATTRIBUTE_FILTER = [
  'aria-disabled',
  'aria-hidden',
  'aria-label',
  'aria-labelledby',
  'alt',
  'action',
  'autocomplete',
  'class',
  'data-qa',
  'data-auto-submit',
  'data-autosubmit',
  'data-nook-manual-checkpoint',
  'data-nook-passkey-control',
  'data-submit-on-input',
  'data-testid',
  'disabled',
  'form',
  'formaction',
  'for',
  'hidden',
  'href',
  'id',
  'inert',
  'name',
  'open',
  'onchange',
  'oninput',
  'placeholder',
  'readonly',
  'role',
  'src',
  'style',
  'tabindex',
  'title',
  'type',
  'value',
] as const

export const AUTHENTICATION_VIEWPORT_EVENTS = ['resize', 'scroll'] as const

export type MountedWidgetMutationRequest = {
  record: MutationRecord
  mountedHost: HTMLElement | undefined
}

export type AuthenticationWorkflowMutationRequest = {
  record: MutationRecord
  workflow: PasswordFormObservation
}

export type AuthenticationMutationImpactRequest = {
  records: MutationRecord[]
  mountedHost: HTMLElement | undefined
  renderedWorkflow: PasswordFormObservation | undefined
}

export type AuthenticationMutationImpact = {
  shouldRemountRenderedWorkflow: boolean
  shouldScheduleScan: boolean
}

type OwnedFormAssociationRequest = {
  node: Node
  boundary: HTMLFormElement
}

const AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR = [
  'form',
  'input',
  'button',
  'select',
  'textarea',
  '[role="button"]',
  '[data-nook-manual-checkpoint]',
  '[data-nook-passkey-control]',
].join(',')

export function mutationBelongsOnlyToMountedWidget(
  request: MountedWidgetMutationRequest,
): boolean {
  const { record, mountedHost } = request
  if (!mountedHost && record.type === 'childList') {
    const changedNodes = [...record.addedNodes, ...record.removedNodes]
    return (
      changedNodes.length > 0 &&
      changedNodes.every(
        (node) => node instanceof HTMLElement && node.id === 'nook-auth-widget',
      )
    )
  }
  if (!mountedHost) return false
  if (record.target === mountedHost || mountedHost.contains(record.target)) {
    return true
  }
  if (record.type !== 'childList') return false
  const changedNodes = [...record.addedNodes, ...record.removedNodes]
  return (
    changedNodes.length > 0 &&
    changedNodes.every((node) => node === mountedHost)
  )
}

export function authenticationWorkflowBoundary(
  workflow: PasswordFormObservation,
): ParentNode {
  return workflow.formScope.kind === 'unowned'
    ? workflow.root
    : workflow.formScope.owner
}

function nodeTouchesOwnedFormAssociation(
  request: OwnedFormAssociationRequest,
): boolean {
  const { node, boundary } = request
  const controlBelongsToBoundary = (control: HTMLElement): boolean =>
    (control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLOutputElement) &&
    control.form === boundary
  const element =
    node instanceof Element
      ? node
      : node.parentElement instanceof Element
        ? node.parentElement
        : undefined
  if (!element) return false
  if (
    Array.from(boundary.elements).some(
      (control) =>
        control === element ||
        control.contains(element) ||
        element.contains(control),
    )
  ) {
    return true
  }
  const associatedLabel = element.closest('label')
  if (
    associatedLabel?.control &&
    controlBelongsToBoundary(associatedLabel.control)
  ) {
    return true
  }
  return Array.from(element.querySelectorAll('label')).some(
    (label) =>
      Boolean(label.control) &&
      controlBelongsToBoundary(label.control as HTMLElement),
  )
}

export function mutationTouchesAuthenticationWorkflow(
  request: AuthenticationWorkflowMutationRequest,
): boolean {
  const { record, workflow } = request
  const boundary = authenticationWorkflowBoundary(workflow)
  if (!(boundary instanceof Node)) return true
  if (boundary === record.target || boundary.contains(record.target)) {
    return true
  }
  if (
    record.type === 'attributes' &&
    record.target instanceof Element &&
    record.target.contains(boundary)
  ) {
    return true
  }
  if (
    boundary instanceof HTMLFormElement &&
    (() => {
      const associationRequest: OwnedFormAssociationRequest = {
        node: record.target,
        boundary,
      }
      return nodeTouchesOwnedFormAssociation(associationRequest)
    })()
  ) {
    return true
  }
  if (record.type !== 'childList') return false
  return [...record.addedNodes, ...record.removedNodes].some((node) => {
    if (boundary.contains(node) || node.contains(boundary)) return true
    if (!(boundary instanceof HTMLFormElement)) return false
    const associationRequest: OwnedFormAssociationRequest = { node, boundary }
    return nodeTouchesOwnedFormAssociation(associationRequest)
  })
}

export function mutationCanChangeAuthenticationWorkflows(
  record: MutationRecord,
): boolean {
  const containsAuthenticationControl = (node: Node): boolean =>
    node instanceof Element &&
    (node.matches(AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR) ||
      Boolean(node.querySelector(AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR)))
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some(
      containsAuthenticationControl,
    )
  }
  if (record.type === 'attributes') {
    return containsAuthenticationControl(record.target)
  }
  return Boolean(
    record.target.parentElement?.closest(
      AUTHENTICATION_WORKFLOW_MUTATION_SELECTOR,
    ),
  )
}

export function authenticationMutationImpact({
  records,
  mountedHost,
  renderedWorkflow,
}: AuthenticationMutationImpactRequest): AuthenticationMutationImpact {
  const pageMutations = records.filter((record) => {
    const mountedWidgetRequest: MountedWidgetMutationRequest = {
      record,
      mountedHost,
    }
    return !mutationBelongsOnlyToMountedWidget(mountedWidgetRequest)
  })
  const relevantMutations = pageMutations.filter((record) => {
    if (mutationCanChangeAuthenticationWorkflows(record)) return true
    if (!renderedWorkflow) return false
    const workflowRequest: AuthenticationWorkflowMutationRequest = {
      record,
      workflow: renderedWorkflow,
    }
    return mutationTouchesAuthenticationWorkflow(workflowRequest)
  })
  return {
    shouldRemountRenderedWorkflow:
      Boolean(renderedWorkflow) &&
      relevantMutations.some((record) => {
        const workflowRequest: AuthenticationWorkflowMutationRequest = {
          record,
          workflow: renderedWorkflow as PasswordFormObservation,
        }
        return mutationTouchesAuthenticationWorkflow(workflowRequest)
      }),
    shouldScheduleScan: relevantMutations.length > 0,
  }
}

import { authenticationFactMutationTouchesLabelDependency } from '../../../../nook-web-shared/src/extension/authentication-fact-attributes'
import {
  pageHasManualCheckpoint,
  type PasswordFormObservation,
} from '../../../../nook-web-shared/src/extension/password-forms'
import { pageHasDocumentBackupCodeHint } from '../../lib/backup-code-candidates'

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
  'data-nook-otpauth-uri',
  'data-nook-passkey-control',
  'data-submit-on-input',
  'data-testid',
  'disabled',
  'form',
  'formaction',
  'formmethod',
  'for',
  'hidden',
  'href',
  'id',
  'inert',
  'name',
  'method',
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
  mountedHost: HTMLElement | false
}

export type AuthenticationWorkflowMutationRequest = {
  record: MutationRecord
  workflow: PasswordFormObservation
}

export type AuthenticationMutationImpactRequest = {
  records: MutationRecord[]
  mountedHost: HTMLElement | false
  renderedWorkflow: PasswordFormObservation | false
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
  'a[href]',
  'canvas',
  'form',
  'img',
  'iframe',
  'input',
  'button',
  'label',
  'legend',
  'select',
  'textarea',
  'svg',
  '[role="button"]',
  '[data-nook-manual-checkpoint]',
  '[data-nook-otpauth-uri]',
  '[data-nook-passkey-control]',
].join(',')

const AUTHENTICATION_RECOVERY_MUTATION_SELECTOR =
  'h1, h2, h3, h4, h5, h6, [role="heading"], p, li, code, pre'

enum AuthenticationRecoveryEvidenceKind {
  Absent = 'absent',
  Present = 'present',
}

type AuthenticationRecoveryEvidenceState = {
  kind: AuthenticationRecoveryEvidenceKind
}

let authenticationRecoveryEvidenceState: AuthenticationRecoveryEvidenceState = {
  kind: AuthenticationRecoveryEvidenceKind.Absent,
}

export function recordAuthenticationRecoveryEvidenceState(): void {
  authenticationRecoveryEvidenceState = {
    kind: pageHasDocumentBackupCodeHint()
      ? AuthenticationRecoveryEvidenceKind.Present
      : AuthenticationRecoveryEvidenceKind.Absent,
  }
}

function mutationTouchesAuthenticationRecoveryCopy(
  record: MutationRecord,
): boolean {
  const containsRecoveryCopyElement = (node: Node): boolean =>
    node instanceof Element &&
    (node.matches(AUTHENTICATION_RECOVERY_MUTATION_SELECTOR) ||
      Boolean(node.querySelector(AUTHENTICATION_RECOVERY_MUTATION_SELECTOR)))
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some(
      containsRecoveryCopyElement,
    )
  }
  if (record.type === 'attributes') {
    return containsRecoveryCopyElement(record.target)
  }
  return Boolean(
    record.target.parentElement?.closest(
      AUTHENTICATION_RECOVERY_MUTATION_SELECTOR,
    ),
  )
}

function mutationCanIntroduceAuthenticationRecoveryEvidence(
  record: MutationRecord,
): boolean {
  if (!mutationTouchesAuthenticationRecoveryCopy(record)) return false
  return (
    pageHasDocumentBackupCodeHint() ||
    authenticationRecoveryEvidenceState.kind ===
      AuthenticationRecoveryEvidenceKind.Present
  )
}

function mutationCanIntroduceManualCheckpoint(record: MutationRecord): boolean {
  const nodeHasManualCheckpoint = (node: Node): boolean => {
    const root = node instanceof Element ? node : node.parentElement
    return Boolean(root && pageHasManualCheckpoint(root))
  }
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some(
      nodeHasManualCheckpoint,
    )
  }
  return nodeHasManualCheckpoint(record.target)
}

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
  if (
    workflow.formScope.kind === 'owned' &&
    workflow.root === workflow.formScope.owner.ownerDocument
  ) {
    return workflow.formScope.owner
  }
  return workflow.root
}

function nodeTouchesOwnedFormAssociation({
  node,
  boundary,
}: OwnedFormAssociationRequest): boolean {
  const controls = Array.from(boundary.elements)
  let element: Element
  if (node instanceof Element) element = node
  else if (node.parentElement instanceof Element) element = node.parentElement
  else return false
  if (
    controls.some(
      (control) =>
        control === element ||
        control.contains(element) ||
        element.contains(control),
    )
  ) {
    return true
  }
  return Array.from(element.querySelectorAll('label')).some((label) => {
    const control = label.control
    return control ? controls.includes(control) : false
  })
}

type WorkflowLabelDependencyRequest = {
  record: MutationRecord
  boundary: ParentNode
}

function mutationTouchesWorkflowLabelDependency(
  request: WorkflowLabelDependencyRequest,
): boolean {
  const { record, boundary } = request
  const referencedIds = new Set<string>()
  for (const control of boundary.querySelectorAll<HTMLElement>(
    '[aria-labelledby]',
  )) {
    const labelledBy = control.getAttribute('aria-labelledby')
    if (!labelledBy) continue
    for (const id of labelledBy.split(/\s+/u)) {
      if (id) referencedIds.add(id)
    }
  }
  const controlIds = new Set<string>()
  const nativeLabels = new Set<HTMLLabelElement>()
  for (const control of boundary.querySelectorAll<
    | HTMLButtonElement
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
  >('button, input, select, textarea')) {
    if (control.id) controlIds.add(control.id)
    if (control.labels) {
      for (const label of control.labels) nativeLabels.add(label)
    }
  }
  const changedNodes =
    record.type === 'childList'
      ? [...record.addedNodes, ...record.removedNodes]
      : [record.target]
  if (record.type === 'childList' && record.target instanceof Element) {
    const target = record.target
    if (
      [...nativeLabels].some(
        (label) => label === target || label.contains(target),
      ) ||
      (target.id && referencedIds.has(target.id)) ||
      (target instanceof HTMLLabelElement && controlIds.has(target.htmlFor))
    ) {
      return true
    }
  }
  const previousIdentityRequest: PreviousIdentityDependencyRequest = {
    record,
    referencedIds,
    controlIds,
  }
  return (
    changedNodes.some((node) => {
      const element =
        node instanceof Element
          ? node
          : node.parentElement instanceof Element
            ? node.parentElement
            : false
      if (!element) return false
      if (
        [...nativeLabels].some(
          (label) => label.contains(element) || element.contains(label),
        )
      ) {
        return true
      }
      const identifiedElements = [
        element,
        ...element.querySelectorAll<HTMLElement>('[id]'),
      ]
      if (
        identifiedElements.some(
          (candidate) => candidate.id && referencedIds.has(candidate.id),
        )
      ) {
        return true
      }
      const labels = [
        ...(element instanceof HTMLLabelElement ? [element] : []),
        ...element.querySelectorAll<HTMLLabelElement>('label'),
      ]
      return labels.some((label) => controlIds.has(label.htmlFor))
    }) || mutationPreviousIdentityTouchesWorkflow(previousIdentityRequest)
  )
}

type PreviousIdentityDependencyRequest = {
  record: MutationRecord
  referencedIds: ReadonlySet<string>
  controlIds: ReadonlySet<string>
}

function mutationPreviousIdentityTouchesWorkflow({
  record,
  referencedIds,
  controlIds,
}: PreviousIdentityDependencyRequest): boolean {
  if (record.type !== 'attributes' || !record.oldValue) return false
  if (record.attributeName === 'id') return referencedIds.has(record.oldValue)
  return record.attributeName === 'for' && controlIds.has(record.oldValue)
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
  const labelDependencyRequest: WorkflowLabelDependencyRequest = {
    record,
    boundary,
  }
  if (mutationTouchesWorkflowLabelDependency(labelDependencyRequest)) {
    return true
  }
  if (boundary instanceof HTMLFormElement) {
    const associationRequest: OwnedFormAssociationRequest = {
      node: record.target,
      boundary,
    }
    if (nodeTouchesOwnedFormAssociation(associationRequest)) return true
  }
  if (record.type !== 'childList') return false
  return [...record.addedNodes, ...record.removedNodes].some((node) => {
    if (boundary.contains(node) || node.contains(boundary)) return true
    if (boundary instanceof HTMLFormElement) {
      const associationRequest: OwnedFormAssociationRequest = { node, boundary }
      return nodeTouchesOwnedFormAssociation(associationRequest)
    }
    return false
  })
}

export function mutationCanChangeAuthenticationWorkflows(
  record: MutationRecord,
): boolean {
  if (authenticationFactMutationTouchesLabelDependency(record)) return true
  if (mutationCanIntroduceManualCheckpoint(record)) return true
  if (mutationCanIntroduceAuthenticationRecoveryEvidence(record)) return true
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

import type {
  AuthenticationLoginChecklistPresentation,
  AuthenticationLoginChecklistRow,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { BROWSER_MESSAGE_KEYS } from '../../lib/browser-message-keys'

export interface LoginChecklistSurface {
  readonly body: HTMLDivElement
  readonly title: HTMLHeadingElement
  readonly description: HTMLParagraphElement
}

enum ChecklistRowsCacheKind {
  Empty = 'empty',
  Rendered = 'rendered',
}
type ChecklistRowsCache =
  | { kind: ChecklistRowsCacheKind.Empty }
  | { kind: ChecklistRowsCacheKind.Rendered; rows: string }
enum ChecklistRenderUpdate {
  Retain = 'retain',
  Replace = 'replace',
}
enum ChecklistListVisibility {
  Visible = 'visible',
  Hidden = 'hidden',
}
type ChecklistCopyUpdate = { element: HTMLElement; copy: string }

/** Renders the ordered Rust projection without interpreting authentication evidence. */
export class LoginChecklistRendering {
  private readonly list: HTMLOListElement
  private renderedRows: ChecklistRowsCache = {
    kind: ChecklistRowsCacheKind.Empty,
  }

  constructor(private readonly surface: LoginChecklistSurface) {
    this.list = document.createElement('ol')
    this.list.className = 'pilot-checklist'
    this.list.setAttribute('data-testid', 'nook-auth-checklist')
    this.list.setAttribute(
      'aria-label',
      chrome.i18n.getMessage(BROWSER_MESSAGE_KEYS.WidgetChecklistLabel),
    )
    surface.description.after(this.list)
    surface.description.setAttribute('role', 'status')
    surface.description.setAttribute('aria-live', 'polite')
    surface.description.setAttribute('aria-atomic', 'true')
  }

  render(presentation: AuthenticationLoginChecklistPresentation): void {
    switch (this.listVisibility()) {
      case ChecklistListVisibility.Hidden:
        this.list.hidden = false
        break
      case ChecklistListVisibility.Visible:
        break
    }
    switch (this.statusUpdate(presentation)) {
      case ChecklistRenderUpdate.Replace:
        this.list.dataset.status = presentation.status
        break
      case ChecklistRenderUpdate.Retain:
        break
    }
    const rows = JSON.stringify(presentation.rows)
    switch (this.rowsUpdate(rows)) {
      case ChecklistRenderUpdate.Retain:
        return
      case ChecklistRenderUpdate.Replace:
        break
    }
    this.renderedRows = { kind: ChecklistRowsCacheKind.Rendered, rows }
    this.list.replaceChildren(
      ...presentation.rows.map(this.renderRow.bind(this)),
    )
  }

  renderStatus(presentation: AuthenticationLoginChecklistPresentation): void {
    this.render(presentation)
    const title: ChecklistCopyUpdate = {
      element: this.surface.title,
      copy: chrome.i18n.getMessage(BROWSER_MESSAGE_KEYS.WidgetChecklistLabel),
    }
    const description: ChecklistCopyUpdate = {
      element: this.surface.description,
      copy: chrome.i18n.getMessage(presentation.status_key),
    }
    this.updateCopy(title)
    this.updateCopy(description)
  }

  private updateCopy(request: ChecklistCopyUpdate): void {
    switch (this.copyUpdate(request)) {
      case ChecklistRenderUpdate.Retain:
        return
      case ChecklistRenderUpdate.Replace:
        request.element.textContent = request.copy
    }
  }
  private copyUpdate(request: ChecklistCopyUpdate): ChecklistRenderUpdate {
    switch (request.element.textContent === request.copy) {
      case true:
        return ChecklistRenderUpdate.Retain
      case false:
        return ChecklistRenderUpdate.Replace
    }
  }
  private listVisibility(): ChecklistListVisibility {
    switch (this.list.hidden) {
      case true:
      case 'until-found':
        return ChecklistListVisibility.Hidden
      case false:
        return ChecklistListVisibility.Visible
    }
  }
  private statusUpdate(
    presentation: AuthenticationLoginChecklistPresentation,
  ): ChecklistRenderUpdate {
    switch (this.list.dataset.status === presentation.status) {
      case true:
        return ChecklistRenderUpdate.Retain
      case false:
        return ChecklistRenderUpdate.Replace
    }
  }
  private rowsUpdate(rows: string): ChecklistRenderUpdate {
    switch (this.renderedRows.kind) {
      case ChecklistRowsCacheKind.Empty:
        return ChecklistRenderUpdate.Replace
      case ChecklistRowsCacheKind.Rendered:
        switch (this.renderedRows.rows === rows) {
          case true:
            return ChecklistRenderUpdate.Retain
          case false:
            return ChecklistRenderUpdate.Replace
        }
    }
  }

  unavailable(): void {
    this.renderedRows = { kind: ChecklistRowsCacheKind.Empty }
    this.list.replaceChildren()
    this.list.hidden = true
    this.surface.title.textContent = chrome.i18n.getMessage(
      BROWSER_MESSAGE_KEYS.WidgetManualTitle,
    )
    this.surface.description.textContent = chrome.i18n.getMessage(
      BROWSER_MESSAGE_KEYS.WidgetManualDescription,
    )
  }

  private renderRow(row: AuthenticationLoginChecklistRow): HTMLLIElement {
    const item = document.createElement('li')
    item.className = 'pilot-checklist-step'
    item.dataset.step = row.step
    item.dataset.state = row.state
    const mark = document.createElement('span')
    mark.className = 'pilot-checklist-mark'
    mark.setAttribute('aria-hidden', 'true')
    switch (row.state) {
      case 'Current':
        item.setAttribute('aria-current', 'step')
        mark.textContent = String(row.ordinal)
        break
      case 'Pending':
        mark.textContent = String(row.ordinal)
        break
      case 'Done':
        mark.textContent = '✓'
        break
      case 'Attention':
        mark.textContent = '!'
        break
    }
    const copy = document.createElement('div')
    copy.className = 'pilot-checklist-copy'
    const label = document.createElement('span')
    label.className = 'pilot-checklist-label'
    label.textContent = chrome.i18n.getMessage(row.label_key)
    const detail = document.createElement('small')
    detail.className = 'pilot-checklist-detail'
    detail.textContent = chrome.i18n.getMessage(row.detail_key)
    copy.append(label, detail)
    item.append(mark, copy)
    return item
  }
}

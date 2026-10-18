import type { PasswordFormObservation } from '../../../../nook-web-shared/src/extension/password-forms'
import {
  SidePanelPageWorkflowDiscovery,
  SidePanelPageWorkflowKind,
  type SidePanelPageWorkflowSource,
  type SidePanelSelectedPageWorkflow,
} from './side-panel-page-workflow'

export enum SidePanelLoginWorkflowKind {
  Found = 'found',
  Absent = 'absent',
  Unavailable = 'unavailable',
}

/** The top document's login form, as Rust classified it when Fill arrived. */
export type SidePanelLoginWorkflow =
  | {
      readonly kind: SidePanelLoginWorkflowKind.Found
      readonly workflow: PasswordFormObservation
    }
  | { readonly kind: SidePanelLoginWorkflowKind.Absent }
  | { readonly kind: SidePanelLoginWorkflowKind.Unavailable }

export interface SidePanelLoginWorkflowSource {
  loginWorkflow(): Promise<SidePanelLoginWorkflow>
}

/**
 * The document's workflow when a saved login may fill it. Only Rust's
 * fill-saved-login decision (a Login workflow, including a username-only
 * step) makes the selected form fillable.
 */
export class SidePanelLoginWorkflowDiscovery implements SidePanelLoginWorkflowSource {
  private readonly absent: SidePanelLoginWorkflow = {
    kind: SidePanelLoginWorkflowKind.Absent,
  }
  private readonly pages: SidePanelPageWorkflowSource =
    new SidePanelPageWorkflowDiscovery()

  async loginWorkflow(): Promise<SidePanelLoginWorkflow> {
    const page = await this.pages.pageWorkflow()
    switch (page.kind) {
      case SidePanelPageWorkflowKind.None:
        return this.absent
      case SidePanelPageWorkflowKind.Unavailable:
        return { kind: SidePanelLoginWorkflowKind.Unavailable }
      case SidePanelPageWorkflowKind.Selected:
        return this.fillable(page)
    }
  }

  private fillable(
    page: SidePanelSelectedPageWorkflow,
  ): SidePanelLoginWorkflow {
    switch (page.savedLoginCapability) {
      case 'unavailable':
        return this.absent
      case 'fill-saved-login':
        return {
          kind: SidePanelLoginWorkflowKind.Found,
          workflow: page.workflow,
        }
    }
  }
}

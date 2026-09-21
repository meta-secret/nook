import {
  AuthenticationWorkflowActivity,
  type AuthenticationDisplayProgress,
} from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { passwordFormInteraction } from '../../../../nook-web-shared/src/extension/password-forms'

const activities = [
  AuthenticationWorkflowActivity.ReadyLogin,
  AuthenticationWorkflowActivity.FillingLogin,
  AuthenticationWorkflowActivity.VerifyingLogin,
  AuthenticationWorkflowActivity.FillingAuthenticator,
  AuthenticationWorkflowActivity.SaveOffer,
] as const

class AuthenticationActivityProgressCache {
  private progress = new Map<
    AuthenticationWorkflowActivity,
    AuthenticationDisplayProgress
  >()

  prepare(): boolean {
    const next = new Map<
      AuthenticationWorkflowActivity,
      AuthenticationDisplayProgress
    >()
    for (const activity of activities) {
      const progress = passwordFormInteraction.authenticationActivityProgress(
        activity,
      )
      if (!progress) return false
      next.set(activity, progress)
    }
    this.progress = next
    return true
  }

  project(activity: AuthenticationWorkflowActivity): AuthenticationDisplayProgress {
    const progress = this.progress.get(activity)
    if (!progress) throw new Error('Authentication activity progress unavailable')
    return progress
  }
}

export const authenticationActivityProgress =
  new AuthenticationActivityProgressCache()

export function authentication_workflow_activity_progress(
  activity: AuthenticationWorkflowActivity,
): AuthenticationDisplayProgress {
  return authenticationActivityProgress.project(activity)
}

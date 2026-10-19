import { Effect } from 'effect'
import { err, ok, type Result } from 'neverthrow'
import type initNookWasm from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  validate_reviewed_authenticator_labels,
  type NookReviewedAuthenticatorLabels,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { ReviewedAuthenticatorLabelsVerdictResponse } from '../../../nook-web-shared/src/extension/authenticator-enrollment-candidates'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../lib/session-operation-queue'
import { vaultWasmStartup } from './vault-wasm-startup'

/** What the validator needs from the offscreen document; tests supply their own. */
export type ReviewedAuthenticatorLabelValidation = {
  readonly ensureWasm: () => ReturnType<typeof initNookWasm>
}

type LabelVerdictResult = Result<
  ReviewedAuthenticatorLabelsVerdictResponse,
  SessionOperationFailure
>

type LabelVerdictOutcome = {
  readonly onFailure: () => LabelVerdictResult
  readonly onSuccess: (
    response: ReviewedAuthenticatorLabelsVerdictResponse,
  ) => LabelVerdictResult
}

/**
 * Asks Rust whether the Service and Account a user is reviewing would save,
 * so the preview can keep its action disabled before the site enables 2FA.
 */
export class ReviewedAuthenticatorLabelValidator {
  private readonly outcome: LabelVerdictOutcome = {
    onFailure: () =>
      err(new SessionOperationFailure(SessionOperationFailureKind.Failed)),
    onSuccess: (response) => ok(response),
  }

  constructor(
    private readonly validation: ReviewedAuthenticatorLabelValidation,
  ) {}

  validate(
    labels: NookReviewedAuthenticatorLabels,
  ): Promise<LabelVerdictResult> {
    return Effect.runPromise(
      Effect.tryPromise(() => this.validation.ensureWasm()).pipe(
        Effect.andThen(() =>
          Effect.try(() => validate_reviewed_authenticator_labels(labels)),
        ),
        Effect.map((verdict): ReviewedAuthenticatorLabelsVerdictResponse => ({
          verdict,
        })),
        Effect.match(this.outcome),
      ),
    )
  }
}

const offscreenValidation: ReviewedAuthenticatorLabelValidation = {
  ensureWasm: () => vaultWasmStartup.ensure(),
}

export const reviewedAuthenticatorLabelValidator =
  new ReviewedAuthenticatorLabelValidator(offscreenValidation)

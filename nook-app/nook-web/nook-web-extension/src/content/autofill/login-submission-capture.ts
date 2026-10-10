import { Effect, Schema } from 'effect'
import {
  LoginSubmissionDomObservationKind,
  LoginSubmissionDomSensor,
  type LoginSubmissionDomSnapshot,
} from './login-submission-dom-sensor'
import { SessionOperationFailureKind } from '../../lib/session-operation-queue'

export type CapturedLoginSubmission = {
  readonly snapshot: LoginSubmissionDomSnapshot
}
export type LoginSubmissionCaptureRuntime = {
  readonly stage: (submission: CapturedLoginSubmission) => Promise<void>
}
type LoginSubmissionCaptureFailureFields = {
  readonly kind: Schema.Codec<SessionOperationFailureKind.Failed>
}
class LoginSubmissionCaptureFailureSchema {
  static readonly fields: LoginSubmissionCaptureFailureFields = {
    kind: Schema.Literal(SessionOperationFailureKind.Failed),
  }
}
export class LoginSubmissionCaptureFailure extends Schema.TaggedError<LoginSubmissionCaptureFailure>()(
  'LoginSubmissionCaptureFailure',
  LoginSubmissionCaptureFailureSchema.fields,
) {}
enum LoginSubmissionCaptureLifecycle {
  Enabled = 'enabled',
  Disabled = 'disabled',
}

/** Hands the first snapshot to background ownership before any classifier wait. */
export class LoginSubmissionCapture {
  readonly sensor = new LoginSubmissionDomSensor()
  private lifecycle = LoginSubmissionCaptureLifecycle.Enabled
  private readonly eventTurnRoots = new Set<ParentNode>()
  constructor(private readonly runtime: LoginSubmissionCaptureRuntime) {}
  enable(): void {
    this.lifecycle = LoginSubmissionCaptureLifecycle.Enabled
  }
  discard(): void {
    this.lifecycle = LoginSubmissionCaptureLifecycle.Disabled
  }
  capture(event: Event): Promise<void> {
    return Effect.runPromise(this.captureEffect(event))
  }
  captureEffect(
    event: Event,
  ): Effect.Effect<void, LoginSubmissionCaptureFailure> {
    switch (this.lifecycle) {
      case LoginSubmissionCaptureLifecycle.Disabled:
        return Effect.void
      case LoginSubmissionCaptureLifecycle.Enabled:
        break
    }
    const observed = this.sensor.observe(event)
    switch (observed.kind) {
      case LoginSubmissionDomObservationKind.Ignored:
        return Effect.void
      case LoginSubmissionDomObservationKind.Observed:
        break
    }
    const { snapshot } = observed
    switch (this.eventTurnRoots.has(snapshot.root)) {
      case true:
        snapshot.dispose()
        return Effect.void
      case false:
        break
    }
    this.eventTurnRoots.add(snapshot.root)
    queueMicrotask(() => this.eventTurnRoots.delete(snapshot.root))
    const submission: CapturedLoginSubmission = { snapshot }
    let operation: Promise<void>
    try {
      operation = this.runtime.stage(submission)
    } catch {
      snapshot.dispose()
      const failure: ConstructorParameters<
        typeof LoginSubmissionCaptureFailure
      >[0] = { kind: SessionOperationFailureKind.Failed }
      return Effect.fail(new LoginSubmissionCaptureFailure(failure))
    }
    const attempt: Parameters<
      typeof Effect.tryPromise<void, LoginSubmissionCaptureFailure>
    >[0] = {
      try: () => operation,
      catch: () => {
        const failure: ConstructorParameters<
          typeof LoginSubmissionCaptureFailure
        >[0] = { kind: SessionOperationFailureKind.Failed }
        return new LoginSubmissionCaptureFailure(failure)
      },
    }
    return Effect.tryPromise(attempt).pipe(
      Effect.ensuring(Effect.sync(() => snapshot.dispose())),
    )
  }
}

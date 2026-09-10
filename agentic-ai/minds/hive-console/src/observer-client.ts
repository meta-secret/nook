import { err, ok, type Result } from 'neverthrow';
import type { ObservedTask, ObserverSnapshot } from './generated/index';
import isObservedTask from './generated/ObservedTask.validator.js';
import isObserverSnapshot from './generated/ObserverSnapshot.validator.js';
import { DurableTaskLookupKind, type DurableTaskLookup } from './app-state';

export enum ObserverFailureKind {
  Cancelled = 'cancelled',
  Unavailable = 'unavailable',
  Http = 'http',
  Schema = 'schema',
}
export type ObserverFailure =
  | {
      readonly kind:
        | ObserverFailureKind.Cancelled
        | ObserverFailureKind.Unavailable
        | ObserverFailureKind.Schema;
    }
  | { readonly kind: ObserverFailureKind.Http; readonly status: number };

class ObserverResponse {
  constructor(
    private readonly response: Response,
    private readonly request: RequestInit,
  ) {}
  async decode<T>(
    admit: (value: unknown) => value is T,
  ): Promise<Result<T, ObserverFailure>> {
    let value: unknown;
    try {
      value = await this.response.json();
    } catch {
      return err({
        kind: this.request.signal?.aborted
          ? ObserverFailureKind.Cancelled
          : ObserverFailureKind.Schema,
      });
    }
    if (this.request.signal?.aborted)
      return err({ kind: ObserverFailureKind.Cancelled });
    return admit(value) ? ok(value) : err({ kind: ObserverFailureKind.Schema });
  }
}
class ObserverRequest {
  constructor(
    private readonly url: string,
    private readonly init: RequestInit,
  ) {}
  async send(): Promise<Result<Response, ObserverFailure>> {
    try {
      const response = await fetch(this.url, this.init);
      if (this.init.signal?.aborted)
        return err({ kind: ObserverFailureKind.Cancelled });
      return ok(response);
    } catch {
      return err({
        kind: this.init.signal?.aborted
          ? ObserverFailureKind.Cancelled
          : ObserverFailureKind.Unavailable,
      });
    }
  }
}
export class ObserverClient {
  constructor(private readonly locale: string) {}
  async snapshot(
    init: RequestInit,
  ): Promise<Result<ObserverSnapshot, ObserverFailure>> {
    const response = await new ObserverRequest(
      `/api/overview?locale=${encodeURIComponent(this.locale)}`,
      init,
    ).send();
    if (response.isErr()) return err(response.error);
    if (!response.value.ok)
      return err({
        kind: ObserverFailureKind.Http,
        status: response.value.status,
      });
    return new ObserverResponse(response.value, init).decode<ObserverSnapshot>(
      isObserverSnapshot,
    );
  }
  async task(
    taskId: string,
    signal: AbortSignal,
  ): Promise<Result<DurableTaskLookup, ObserverFailure>> {
    const init = { signal };
    const response = await new ObserverRequest(
      `/api/tasks/${encodeURIComponent(taskId)}?locale=${encodeURIComponent(this.locale)}`,
      init,
    ).send();
    if (response.isErr()) return err(response.error);
    if (response.value.status === 404)
      return ok({ kind: DurableTaskLookupKind.NotFound });
    if (!response.value.ok)
      return err({
        kind: ObserverFailureKind.Http,
        status: response.value.status,
      });
    const task = await new ObserverResponse(
      response.value,
      init,
    ).decode<ObservedTask>(isObservedTask);
    return task.map((task) => ({ kind: DurableTaskLookupKind.Found, task }));
  }
}

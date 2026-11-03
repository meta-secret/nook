export enum S3KeyFormRequestKind {
  Closed = "closed",
  Open = "open",
}

/** Whether the Sync page opens one S3 provider's Add key form: the invite
 * page asks for it when the key the new device needs is not saved yet. */
export type S3KeyFormRequest =
  | { readonly kind: S3KeyFormRequestKind.Closed }
  | { readonly kind: S3KeyFormRequestKind.Open; readonly providerId: string };

/** A form request and the provider whose form may open. */
export type S3KeyFormMatch = {
  readonly request: S3KeyFormRequest;
  readonly providerId: string;
};

export class S3KeyFormRequests {
  static readonly CLOSED: S3KeyFormRequest = {
    kind: S3KeyFormRequestKind.Closed,
  };

  static open(providerId: string): S3KeyFormRequest {
    return { kind: S3KeyFormRequestKind.Open, providerId };
  }

  /** Whether the request opens this provider's form. */
  static opens({ request, providerId }: S3KeyFormMatch): boolean {
    switch (request.kind) {
      case S3KeyFormRequestKind.Closed:
        return false;
      case S3KeyFormRequestKind.Open:
        return request.providerId === providerId;
    }
  }
}

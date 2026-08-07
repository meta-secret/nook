export enum ResultKind {
  Ok = 'ok',
  Err = 'err',
}

export type Ok<T> = {
  readonly kind: ResultKind.Ok
  readonly value: T
}

export type Err = {
  readonly kind: ResultKind.Err
  readonly message: string
}

export type Result<T> = Ok<T> | Err

export function ok<T>(value: T): Ok<T> {
  return { kind: ResultKind.Ok, value }
}

export function err(message: string): Err {
  return { kind: ResultKind.Err, message }
}

export enum MaybeKind {
  Present = 'present',
  Absent = 'absent',
}

export type Present<T> = {
  readonly kind: MaybeKind.Present
  readonly value: T
}

export type Absent = {
  readonly kind: MaybeKind.Absent
}

export type Maybe<T> = Present<T> | Absent

export function present<T>(value: T): Present<T> {
  return { kind: MaybeKind.Present, value }
}

export function absent(): Absent {
  return { kind: MaybeKind.Absent }
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.kind === ResultKind.Ok
}

export function unwrapOrThrow<T>(result: Result<T>): T {
  if (result.kind === ResultKind.Err) {
    throw new Error(result.message)
  }
  return result.value
}

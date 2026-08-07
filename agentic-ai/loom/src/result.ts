export type Ok<T> = {
  readonly kind: 'ok'
  readonly value: T
}

export type Err = {
  readonly kind: 'err'
  readonly message: string
}

export type Result<T> = Ok<T> | Err

export function ok<T>(value: T): Ok<T> {
  return { kind: 'ok', value }
}

export function err(message: string): Err {
  return { kind: 'err', message }
}

export type Present<T> = {
  readonly kind: 'present'
  readonly value: T
}

export type Absent = {
  readonly kind: 'absent'
}

export type Maybe<T> = Present<T> | Absent

export function present<T>(value: T): Present<T> {
  return { kind: 'present', value }
}

export function absent(): Absent {
  return { kind: 'absent' }
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.kind === 'ok'
}

export function unwrapOrThrow<T>(result: Result<T>): T {
  if (result.kind === 'err') {
    throw new Error(result.message)
  }
  return result.value
}

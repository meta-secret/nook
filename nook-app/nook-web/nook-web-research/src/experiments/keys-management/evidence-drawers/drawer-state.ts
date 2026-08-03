/**
 * Which drawer is pulled out, and how every other face reads because of it.
 *
 * These live in a module rather than the component script because the Vite
 * script preprocessor inlines enum member reads and then drops the enum
 * object, which leaves template references to it undefined at runtime.
 */

import type { NodeRef } from '../_shared/key-graph'

/** How a single drawer face renders under the current pull. */
export enum DrawerState {
  /** @public The pulled drawer itself. Used from Svelte templates. */
  Open = 'open',
  /** @public Connected to the pulled drawer. Used from Svelte templates. */
  Lit = 'lit',
  /** @public Nothing is pulled; the cabinet is closed. */
  Rest = 'rest',
  /** @public Unreachable from the pulled drawer. */
  Dim = 'dim',
}

export enum PullKind {
  /** @public Every drawer is shut. Used from Svelte templates. */
  Shut = 'shut',
  /** @public One drawer is out. Used from Svelte templates. */
  Open = 'open',
}

export type Pull =
  | { kind: PullKind.Shut }
  | { kind: PullKind.Open; node: NodeRef }

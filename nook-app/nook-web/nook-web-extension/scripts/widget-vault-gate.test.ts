import { describe, expect, test } from 'bun:test'
import {
  WidgetVaultGate,
  WidgetVaultGateKind,
  WidgetVaultPresentationKind,
  WidgetVaultRequirement,
  type WidgetVaultPresentation,
} from '../src/content/autofill/widget-presentation-state'

type GateCase = readonly [string, WidgetVaultPresentation, WidgetVaultGateKind]

const vaultActionCases: readonly GateCase[] = [
  [
    'a vault that is not connected offers Connect vault',
    { kind: WidgetVaultPresentationKind.NotConnected },
    WidgetVaultGateKind.Connect,
  ],
  [
    'a locked vault offers Unlock',
    { kind: WidgetVaultPresentationKind.Locked },
    WidgetVaultGateKind.Unlock,
  ],
  [
    'a connected vault offers the action',
    { kind: WidgetVaultPresentationKind.Connected },
    WidgetVaultGateKind.Open,
  ],
  [
    'matching logins offer the action',
    { kind: WidgetVaultPresentationKind.CredentialAvailable, count: 2 },
    WidgetVaultGateKind.Open,
  ],
  [
    'no matching login offers the action (Open Nook)',
    { kind: WidgetVaultPresentationKind.NoMatchingCredential, count: 0 },
    WidgetVaultGateKind.Open,
  ],
  [
    'an unreadable vault state keeps the action and its own failure',
    { kind: WidgetVaultPresentationKind.Unavailable },
    WidgetVaultGateKind.Open,
  ],
]

describe('widget vault gate', () => {
  test.each(vaultActionCases)('%s', (_, presentation, expected) => {
    expect(
      WidgetVaultGate.decide({
        presentation,
        requirement: WidgetVaultRequirement.Required,
      }),
    ).toBe(expected)
  })

  test.each([
    WidgetVaultPresentationKind.NotConnected,
    WidgetVaultPresentationKind.Locked,
  ] as const)(
    'an action that needs no vault stays available when the vault is %s',
    (kind) => {
      expect(
        WidgetVaultGate.decide({
          presentation: { kind },
          requirement: WidgetVaultRequirement.NotRequired,
        }),
      ).toBe(WidgetVaultGateKind.Open)
    },
  )
})

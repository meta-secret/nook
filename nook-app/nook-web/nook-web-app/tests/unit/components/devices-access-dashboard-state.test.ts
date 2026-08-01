import { describe, expect, test } from 'vitest'
import {
  DevicesAccessNudgePreference,
  parseDevicesAccessNudgePreference,
} from '../../../../nook-web-shared/src/vault-app/lib/components/devices-access-dashboard-state'

describe('Devices & access dashboard state', () => {
  test('normalizes persisted nudge preferences into explicit enum members', () => {
    expect(parseDevicesAccessNudgePreference()).toBe(
      DevicesAccessNudgePreference.Visible,
    )
    expect(parseDevicesAccessNudgePreference('dismissed')).toBe(
      DevicesAccessNudgePreference.Dismissed,
    )
    expect(parseDevicesAccessNudgePreference('unexpected')).toBe(
      DevicesAccessNudgePreference.Visible,
    )
  })

  test('preserves the legacy dismissal preference at the storage boundary', () => {
    expect(parseDevicesAccessNudgePreference('1')).toBe(
      DevicesAccessNudgePreference.Dismissed,
    )
  })
})

import { describe, expect, test } from 'bun:test'
import {
  classifyPinDeviceEntrySurface,
  PinDeviceEntrySurfaceKind,
  type PinDeviceEntrySurfaceObservation,
} from '../e2e/helpers/pin-device'

describe('PIN device popup entry state', () => {
  test('selects the PIN unlock surface after delayed popup hydration', () => {
    const observation: PinDeviceEntrySurfaceObservation = {
      companionHomeVisible: false,
      pinUnlockVisible: true,
      initialSetupVisible: false,
    }

    expect(classifyPinDeviceEntrySurface(observation)).toBe(
      PinDeviceEntrySurfaceKind.PinUnlock,
    )
  })

  test('selects the initial setup surface when no protected device exists', () => {
    const observation: PinDeviceEntrySurfaceObservation = {
      companionHomeVisible: false,
      pinUnlockVisible: false,
      initialSetupVisible: true,
    }

    expect(classifyPinDeviceEntrySurface(observation)).toBe(
      PinDeviceEntrySurfaceKind.InitialSetup,
    )
  })

  test('does not select a surface when none is visible', () => {
    const observation: PinDeviceEntrySurfaceObservation = {
      companionHomeVisible: false,
      pinUnlockVisible: false,
      initialSetupVisible: false,
    }

    expect(classifyPinDeviceEntrySurface(observation)).toBe(
      PinDeviceEntrySurfaceKind.Waiting,
    )
  })

  test('rejects an ambiguous popup state', () => {
    const observation: PinDeviceEntrySurfaceObservation = {
      companionHomeVisible: true,
      pinUnlockVisible: true,
      initialSetupVisible: false,
    }

    expect(classifyPinDeviceEntrySurface(observation)).toBe(
      PinDeviceEntrySurfaceKind.Ambiguous,
    )
  })
})

import { describe, expect, test } from 'bun:test'
import {
  localUpdateCatalogFitsRuntimeMessage,
  type LocalUpdateCatalogMessageLengths,
} from '../src/content/local-update-catalog-budget'

const mebibyte = 1024 * 1024

type CatalogBudgetCase = {
  readonly label: string
  readonly lengths: LocalUpdateCatalogMessageLengths
  readonly fits: boolean
}

const catalogBudgetCases: CatalogBudgetCase[] = [
  {
    label: 'retains a bounded catalog with a normal bulk event log',
    lengths: {
      eventLogRecordsJsonCodeUnits: 5 * mebibyte,
      vaultStoreIdCodeUnits: 100,
      catalogCodeUnits: 4 * mebibyte,
    },
    fits: true,
  },
  {
    label: 'drops a string above the native catalog size limit',
    lengths: {
      eventLogRecordsJsonCodeUnits: 100,
      vaultStoreIdCodeUnits: 100,
      catalogCodeUnits: 4 * mebibyte + 1,
    },
    fits: false,
  },
  {
    label: 'drops a small catalog from a near-limit ordinary event update',
    lengths: {
      eventLogRecordsJsonCodeUnits: 64 * mebibyte - 4096,
      vaultStoreIdCodeUnits: 100,
      catalogCodeUnits: 16_384,
    },
    fits: false,
  },
  {
    label: 'reserves the bytes needed to escape strings in the envelope',
    lengths: {
      eventLogRecordsJsonCodeUnits: Math.floor((64 * mebibyte - 1024) / 3),
      vaultStoreIdCodeUnits: 100,
      catalogCodeUnits: 100,
    },
    fits: false,
  },
]

describe('local update catalog delivery budget', () => {
  test.each(catalogBudgetCases)('$label', ({ lengths, fits }) => {
    expect(localUpdateCatalogFitsRuntimeMessage(lengths)).toBe(fits)
  })
})

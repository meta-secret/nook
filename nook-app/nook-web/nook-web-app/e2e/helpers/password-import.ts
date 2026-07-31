import type { Page } from '@playwright/test'
import { expect } from '../fixtures'
import { expandSettingsSection } from './settings-auth'

export async function openPasswordManagerImport(
  page: Page,
  providerId: string,
): Promise<void> {
  await expandSettingsSection(page, 'import')
  const section = page.getByTestId(`${providerId}-import-section`)
  const toggle = section.getByRole('button').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  await expect(page.getByTestId(`${providerId}-import-panel`)).toBeVisible()
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build an uncompressed ZIP buffer for password-manager import fixtures. */
export function storedZip(entries: Record<string, string>): Buffer {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let offset = 0

  for (const [name, text] of Object.entries(entries)) {
    const fileName = Buffer.from(name)
    const data = Buffer.from(text)
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    localRecords.push(local, fileName, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    centralRecords.push(central, fileName)
    offset += local.length + fileName.length + data.length
  }

  const centralDirectory = Buffer.concat(centralRecords)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localRecords, centralDirectory, end])
}

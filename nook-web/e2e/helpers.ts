import { expect, type Page } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env.test.local'),
})

export const githubPat = process.env.NOOK_GITHUB_PAT?.trim() ?? ''

const GITHUB_VAULT_PATH = 'nook-vault.yaml'

const githubApiHeaders = (pat: string) => ({
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'nook-e2e',
  'Cache-Control': 'no-cache',
})

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function githubRepoForPat(pat: string) {
  const headers = githubApiHeaders(pat)
  const userRes = await fetch('https://api.github.com/user', {
    headers,
    cache: 'no-store',
  })
  if (!userRes.ok) {
    throw new Error(`GitHub user fetch failed: ${userRes.status}`)
  }
  const { login } = (await userRes.json()) as { login: string }
  return { headers, repo: `${login}/nook` }
}

async function deleteGithubFileIfExists(
  headers: ReturnType<typeof githubApiHeaders>,
  repo: string,
  vaultPath: string,
) {
  const contentsUrl = `https://api.github.com/repos/${repo}/contents/${vaultPath}`

  for (let attempt = 0; attempt < 15; attempt++) {
    const fileRes = await fetch(contentsUrl, { headers, cache: 'no-store' })
    if (fileRes.status === 404) {
      return
    }
    if (!fileRes.ok) {
      throw new Error(
        `GitHub vault fetch failed for ${vaultPath}: ${fileRes.status}`,
      )
    }

    const file = (await fileRes.json()) as { sha: string }
    const deleteRes = await fetch(contentsUrl, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Reset nook e2e vault',
        sha: file.sha,
      }),
      cache: 'no-store',
    })

    if (deleteRes.ok || deleteRes.status === 404) {
      await sleep(400)
      continue
    }

    // SHA race or cached metadata — refetch and retry.
    if (deleteRes.status === 409 || deleteRes.status === 422) {
      await sleep(400)
      continue
    }

    throw new Error(
      `GitHub vault delete failed for ${vaultPath}: ${deleteRes.status}`,
    )
  }

  const verify = await fetch(contentsUrl, { headers, cache: 'no-store' })
  if (verify.status === 404) {
    return
  }
  throw new Error(`GitHub vault ${vaultPath} still present after reset`)
}

/** Wipe remote vault file so a fresh local encryption key can connect. */
export async function resetGithubVault(pat: string) {
  const { headers, repo } = await githubRepoForPat(pat)
  await deleteGithubFileIfExists(headers, repo, GITHUB_VAULT_PATH)
}

export async function clearBrowserVault(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        localStorage.clear()
        const request = indexedDB.deleteDatabase('nook_db')
        request.onsuccess = () => resolve()
        request.onerror = () =>
          reject(request.error ?? new Error('IndexedDB delete failed'))
        request.onblocked = () => resolve()
      }),
  )
}

export function uniqueSecretKey(prefix: string) {
  return `${prefix}-${Date.now()}`
}

export async function waitForEngine(page: Page) {
  const button = page.getByTestId('connect-vault-btn')
  await expect(button).toBeVisible()
  await expect(button).not.toContainText('Loading engine', { timeout: 20_000 })
  return button
}

async function assertGithubConnected(page: Page) {
  const error = page.getByTestId('connect-error')
  if (await error.isVisible()) {
    throw new Error(`GitHub connect failed: ${await error.textContent()}`)
  }
  await expect(page.getByTestId('connected-badge')).toBeVisible({
    timeout: 90_000,
  })
}

export async function connectLocalVault(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /^Local/ }).click()
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await expect(page.getByTestId('connect-success')).toContainText(
    'Local vault loaded',
    { timeout: 20_000 },
  )
  await expect(page.getByTestId('connected-badge')).toBeVisible()
}

export async function connectGithubVault(page: Page, pat: string) {
  await page.goto('/')
  await page.getByRole('button', { name: /^GitHub/ }).click()
  await page.getByLabel('Personal access token').fill(pat)
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await expect(page.getByTestId('connect-success')).toContainText(
    'Connected to GitHub',
    { timeout: 90_000 },
  )
  await assertGithubConnected(page)
}

/** Reconnect after reload — PAT and storage mode are restored from localStorage. */
export async function reconnectGithubVault(page: Page) {
  await page.getByTestId('nav-setup').click()
  await expect(page.getByRole('button', { name: /^GitHub/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const connectButton = await waitForEngine(page)
  await connectButton.click()
  await expect(page.getByTestId('connect-success')).toContainText(
    'Connected to GitHub',
    { timeout: 90_000 },
  )
  await assertGithubConnected(page)
}

export async function openVaultTab(page: Page) {
  await page.getByTestId('nav-vault').click()
  await expect(page.getByTestId('vault-panel')).toBeVisible()
}

export async function addSecret(page: Page, key: string, value: string) {
  await openVaultTab(page)
  await page.getByTestId('secret-label').fill(key)
  await page.getByTestId('secret-value').fill(value)
  await page.getByTestId('save-secret-btn').click()
  await expect(page.getByTestId('app-success')).toContainText(
    'Secret saved successfully',
    { timeout: 45_000 },
  )
  await expect(page.getByTestId('secret-row').filter({ hasText: key })).toBeVisible()
}

export async function deleteSecret(page: Page, key: string) {
  const row = page.getByTestId('secret-row').filter({ hasText: key })
  await row.getByRole('button', { name: 'Delete secret' }).click()
  await expect(page.getByTestId('app-success')).toContainText(
    'Secret deleted successfully',
    { timeout: 45_000 },
  )
  await expect(row).toHaveCount(0)
}

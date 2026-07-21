import {
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import packageJson from '../package.json'
import { createManifest } from '../src/manifest'
import {
  DEFAULT_SIMPLE_VAULT_URL,
  normalizeSimpleVaultBaseUrl,
} from '../src/lib/simple-vault-target'
import { extensionChannelIdentity } from './channel-identity'

const projectRoot = resolve(import.meta.dir, '..')
const webGroupRoot = resolve(projectRoot, '..')
const webRoot = join(webGroupRoot, 'nook-web-app')
const sharedRoot = join(webGroupRoot, 'nook-web-shared')
const coreLocalesRoot = join(webGroupRoot, '..', 'nook-core', 'locales')
const distDir = join(projectRoot, 'dist')
const requireFromWeb = createRequire(join(webRoot, 'package.json'))
const simpleVaultBaseUrl = normalizeSimpleVaultBaseUrl(
  process.env.NOOK_SIMPLE_VAULT_URL?.trim() || DEFAULT_SIMPLE_VAULT_URL,
)
const simpleVaultDefine = {
  __NOOK_SIMPLE_VAULT_URL__: JSON.stringify(simpleVaultBaseUrl),
}
const deployment = extensionChannelIdentity(
  process.env.NOOK_EXTENSION_CHANNEL?.trim() || 'production',
)
const requestedVersion =
  process.env.NOOK_EXTENSION_VERSION?.trim() || packageJson.version
const manifestVersion = requestedVersion.match(/^\d+\.\d+\.\d+/)?.[0]
if (!manifestVersion) {
  throw new Error('NOOK_EXTENSION_VERSION must begin with a semantic version.')
}
const commit = process.env.NOOK_EXTENSION_COMMIT?.trim()
const versionName = commit
  ? `${requestedVersion} (${deployment.channel}, ${commit.slice(0, 12)})`
  : `${requestedVersion} (${deployment.channel})`

async function ensureNodeModulesLink() {
  try {
    await symlink(
      '../nook-web-app/node_modules',
      join(projectRoot, 'node_modules'),
      'dir',
    )
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return
    }
    throw error
  }
}

async function buildEntrypoint(entrypoint: string, outdir: string) {
  const result = await Bun.build({
    entrypoints: [join(projectRoot, entrypoint)],
    outdir: join(distDir, outdir),
    target: 'browser',
    format: 'esm',
    sourcemap: 'external',
    minify: false,
    splitting: false,
    naming: '[name].js',
    define: simpleVaultDefine,
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error(`Failed to build ${entrypoint}`)
  }
}

async function copyStaticFile(source: string, destination: string) {
  const outputPath = join(distDir, destination)
  await mkdir(dirname(outputPath), { recursive: true })
  await copyFile(source, outputPath)
}

async function importWebDependency<TModule>(specifier: string) {
  const resolved = requireFromWeb.resolve(specifier)
  return import(pathToFileURL(resolved).href) as Promise<TModule>
}

async function buildSveltePage(page: 'popup') {
  const { build: viteBuild } =
    await importWebDependency<typeof import('vite')>('vite')
  const { svelte } = await importWebDependency<
    typeof import('@sveltejs/vite-plugin-svelte')
  >('@sveltejs/vite-plugin-svelte')

  await viteBuild({
    root: join(projectRoot, `src/${page}`),
    configFile: false,
    base: './',
    publicDir: false,
    plugins: [svelte()],
    define: simpleVaultDefine,
    build: {
      outDir: join(distDir, page),
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      rollupOptions: {
        input: join(projectRoot, `src/${page}/index.html`),
      },
    },
    resolve: {
      alias: {
        '@nook/shared': join(sharedRoot, 'src'),
      },
      dedupe: ['svelte'],
    },
  })
}

type NookLocaleCatalog = {
  extension: {
    widget: {
      open_vault: string
      dismiss: string
      collapse: string
      expand: string
      pilot_label: string
      vault_connected: string
      vault_not_connected: string
      connect_vault: string
      login_title: string
      login_description: string
      signup_title: string
      signup_description: string
      password_change_title: string
      password_change_description: string
      save_login_title: string
      save_login_description: string
      update_login_title: string
      update_login_description: string
      save_login: string
      update_login: string
      save_login_not_now: string
      save_login_failed: string
      save_login_saved_title: string
      save_login_saved_description: string
      totp_title: string
      totp_description: string
      manual_title: string
      manual_description: string
      take_over: string
      filling_title: string
      verifying_title: string
      submitted: string
      gate_step: string
      gate_title: string
      gate_description: string
      continue: string
      working: string
      unlock_then_continue: string
      no_match: string
      choose_account: string
      saved_login: string
      fill_failed: string
      filled_manual: string
      authenticator_step: string
      authenticator_title: string
      authenticator_description: string
      fill_authenticator: string
      authenticator_working: string
      authenticator_unlock: string
      no_authenticator: string
      add_authenticator: string
      choose_authenticator: string
      saved_authenticator: string
      authenticator_fill_failed: string
      authenticator_filled: string
    }
    passkey: {
      save_title: string
      use_title: string
      use_browser: string
    }
  }
}

async function buildChromeLocales() {
  await Promise.all(
    ['en', 'ru'].map(async (locale) => {
      const catalog = JSON.parse(
        await readFile(join(coreLocalesRoot, `${locale}.json`), 'utf8'),
      ) as NookLocaleCatalog
      const messages = {
        widgetOpenVault: { message: catalog.extension.widget.open_vault },
        widgetDismiss: { message: catalog.extension.widget.dismiss },
        widgetCollapse: { message: catalog.extension.widget.collapse },
        widgetExpand: { message: catalog.extension.widget.expand },
        widgetPilotLabel: { message: catalog.extension.widget.pilot_label },
        widgetVaultConnected: {
          message: catalog.extension.widget.vault_connected,
        },
        widgetVaultNotConnected: {
          message: catalog.extension.widget.vault_not_connected,
        },
        widgetConnectVault: {
          message: catalog.extension.widget.connect_vault,
        },
        widgetLoginTitle: { message: catalog.extension.widget.login_title },
        widgetLoginDescription: {
          message: catalog.extension.widget.login_description,
        },
        widgetSignupTitle: { message: catalog.extension.widget.signup_title },
        widgetSignupDescription: {
          message: catalog.extension.widget.signup_description,
        },
        widgetPasswordChangeTitle: {
          message: catalog.extension.widget.password_change_title,
        },
        widgetPasswordChangeDescription: {
          message: catalog.extension.widget.password_change_description,
        },
        widgetSaveLoginTitle: {
          message: catalog.extension.widget.save_login_title,
        },
        widgetSaveLoginDescription: {
          message: catalog.extension.widget.save_login_description,
        },
        widgetUpdateLoginTitle: {
          message: catalog.extension.widget.update_login_title,
        },
        widgetUpdateLoginDescription: {
          message: catalog.extension.widget.update_login_description,
        },
        widgetSaveLogin: { message: catalog.extension.widget.save_login },
        widgetUpdateLogin: { message: catalog.extension.widget.update_login },
        widgetSaveLoginNotNow: {
          message: catalog.extension.widget.save_login_not_now,
        },
        widgetSaveLoginFailed: {
          message: catalog.extension.widget.save_login_failed,
        },
        widgetSaveLoginSavedTitle: {
          message: catalog.extension.widget.save_login_saved_title,
        },
        widgetSaveLoginSavedDescription: {
          message: catalog.extension.widget.save_login_saved_description,
        },
        widgetTotpTitle: { message: catalog.extension.widget.totp_title },
        widgetTotpDescription: {
          message: catalog.extension.widget.totp_description,
        },
        widgetManualTitle: { message: catalog.extension.widget.manual_title },
        widgetManualDescription: {
          message: catalog.extension.widget.manual_description,
        },
        widgetTakeOver: { message: catalog.extension.widget.take_over },
        widgetFillingTitle: { message: catalog.extension.widget.filling_title },
        widgetVerifyingTitle: {
          message: catalog.extension.widget.verifying_title,
        },
        widgetSubmitted: { message: catalog.extension.widget.submitted },
        widgetGateStep: { message: catalog.extension.widget.gate_step },
        widgetGateTitle: { message: catalog.extension.widget.gate_title },
        widgetGateDescription: {
          message: catalog.extension.widget.gate_description,
        },
        widgetContinue: { message: catalog.extension.widget.continue },
        widgetWorking: { message: catalog.extension.widget.working },
        widgetUnlockThenContinue: {
          message: catalog.extension.widget.unlock_then_continue,
        },
        widgetNoMatch: { message: catalog.extension.widget.no_match },
        widgetChooseAccount: {
          message: catalog.extension.widget.choose_account,
        },
        widgetSavedLogin: { message: catalog.extension.widget.saved_login },
        widgetFillFailed: { message: catalog.extension.widget.fill_failed },
        widgetFilledManual: {
          message: catalog.extension.widget.filled_manual,
        },
        widgetAuthenticatorStep: {
          message: catalog.extension.widget.authenticator_step,
        },
        widgetAuthenticatorTitle: {
          message: catalog.extension.widget.authenticator_title,
        },
        widgetAuthenticatorDescription: {
          message: catalog.extension.widget.authenticator_description,
        },
        widgetFillAuthenticator: {
          message: catalog.extension.widget.fill_authenticator,
        },
        widgetAuthenticatorWorking: {
          message: catalog.extension.widget.authenticator_working,
        },
        widgetAuthenticatorUnlock: {
          message: catalog.extension.widget.authenticator_unlock,
        },
        widgetNoAuthenticator: {
          message: catalog.extension.widget.no_authenticator,
        },
        widgetAddAuthenticator: {
          message: catalog.extension.widget.add_authenticator,
        },
        widgetChooseAuthenticator: {
          message: catalog.extension.widget.choose_authenticator,
        },
        widgetSavedAuthenticator: {
          message: catalog.extension.widget.saved_authenticator,
        },
        widgetAuthenticatorFillFailed: {
          message: catalog.extension.widget.authenticator_fill_failed,
        },
        widgetAuthenticatorFilled: {
          message: catalog.extension.widget.authenticator_filled,
        },
        passkeySaveTitle: { message: catalog.extension.passkey.save_title },
        passkeyUseTitle: { message: catalog.extension.passkey.use_title },
        passkeyUseBrowser: { message: catalog.extension.passkey.use_browser },
      }
      const localeDir = join(distDir, '_locales', locale)
      await mkdir(localeDir, { recursive: true })
      await writeFile(
        join(localeDir, 'messages.json'),
        `${JSON.stringify(messages, undefined, 2)}\n`,
      )
    }),
  )
}

await ensureNodeModulesLink()
await rm(distDir, { force: true, recursive: true })
await mkdir(distDir, { recursive: true })

await Promise.all([
  buildEntrypoint('src/background/service-worker.ts', 'background'),
  buildEntrypoint('src/content/autofill.ts', 'content'),
  buildEntrypoint('src/content/webauthn-content.ts', 'content'),
  buildEntrypoint('src/content/webauthn-page.ts', 'content'),
  buildEntrypoint('src/content/simple-vault-bridge.ts', 'content'),
  buildEntrypoint('src/offscreen/session.ts', 'offscreen'),
])

await Promise.all([buildSveltePage('popup'), buildChromeLocales()])

await writeFile(
  join(distDir, 'manifest.json'),
  `${JSON.stringify(
    createManifest(manifestVersion, simpleVaultBaseUrl, {
      key: deployment.manifestKey,
      name: deployment.name,
      shortName: deployment.shortName,
      versionName,
    }),
    null,
    2,
  )}\n`,
)

await Promise.all([
  copyStaticFile(join(webRoot, 'public/favicon.png'), 'icons/nook.png'),
  copyStaticFile(
    join(projectRoot, 'src/offscreen/session.html'),
    'offscreen/session.html',
  ),
  copyStaticFile(
    join(sharedRoot, 'src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm'),
    'background/nook_wasm_bg.wasm',
  ),
  copyStaticFile(
    join(sharedRoot, 'src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm'),
    'offscreen/nook_wasm_bg.wasm',
  ),
])

console.log(`Built Nook extension at ${distDir}`)

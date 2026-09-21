import {
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import packageJson from '../package.json'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import { SimpleVaultTarget } from '../src/lib/simple-vault-target'
import { normalize_simple_vault_base_url } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  createManifest,
  type CreateExtensionManifestArgs,
  ExtensionManifestBuildKind,
} from '../src/manifest'
import { extensionChannelIdentity } from './channel-identity'
import {
  ExtensionDiagnosticBuildAvailability,
  ExtensionDiagnosticBuildPolicy,
  extensionEntrypointBuildPolicy,
} from './build-contract'

await companionWasmReady

const projectRoot = resolve(import.meta.dir, '..')
const webGroupRoot = resolve(projectRoot, '..')
const webRoot = join(webGroupRoot, 'nook-web-app')
const sharedRoot = join(webGroupRoot, 'nook-web-shared')
const appCommonLocalesRoot = join(
  webGroupRoot,
  '..',
  'nook-platform',
  'nook-app-common',
  'locales',
)
const distDir = join(projectRoot, 'dist')
const simpleVaultBaseUrl = normalize_simple_vault_base_url(
  process.env.NOOK_SIMPLE_VAULT_URL?.trim() || SimpleVaultTarget.defaultBase(),
)
const simpleVaultDefine = {
  __NOOK_SIMPLE_VAULT_URL__: JSON.stringify(simpleVaultBaseUrl),
}
const deployment = extensionChannelIdentity(
  process.env.NOOK_EXTENSION_CHANNEL?.trim() || 'production',
)
const extensionDiagnosticBuildPolicy = new ExtensionDiagnosticBuildPolicy()
const extensionDiagnosticsEnabled =
  extensionDiagnosticBuildPolicy.availability({
    channel: deployment.channel,
  }) === ExtensionDiagnosticBuildAvailability.Enabled
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

const identityJsonReplacer = (_key: string, value: unknown): unknown => value

type ResolvedViteModule = {
  readonly build: typeof import('vite').build
}

type ResolvedSvelteModule = {
  readonly svelte: typeof import('@sveltejs/vite-plugin-svelte').svelte
  readonly vitePreprocess: typeof import('@sveltejs/vite-plugin-svelte').vitePreprocess
}

enum ExtensionBuildDependencySpecifier {
  Vite = 'vite',
  Svelte = '@sveltejs/vite-plugin-svelte',
}

class ExtensionBuildDependencyLoader {
  async importVite(): Promise<Pick<typeof import('vite'), 'build'>> {
    return this.importResolved(ExtensionBuildDependencySpecifier.Vite)
  }

  async importSvelte(): Promise<
    Pick<
      typeof import('@sveltejs/vite-plugin-svelte'),
      'svelte' | 'vitePreprocess'
    >
  > {
    return this.importResolved(ExtensionBuildDependencySpecifier.Svelte)
  }

  private importResolved(
    specifier: ExtensionBuildDependencySpecifier.Vite,
  ): Promise<ResolvedViteModule>
  private importResolved(
    specifier: ExtensionBuildDependencySpecifier.Svelte,
  ): Promise<ResolvedSvelteModule>
  private importResolved(
    specifier: ExtensionBuildDependencySpecifier,
  ): Promise<ResolvedViteModule | ResolvedSvelteModule> {
    switch (specifier) {
      case ExtensionBuildDependencySpecifier.Vite:
        return import('vite')
      case ExtensionBuildDependencySpecifier.Svelte:
        return import('@sveltejs/vite-plugin-svelte')
    }
  }
}

const extensionBuildDependencyLoader = new ExtensionBuildDependencyLoader()

async function ensureNodeModulesLink() {
  try {
    await symlink(
      '../nook-web-app/node_modules',
      join(projectRoot, 'node_modules'),
      'dir',
    )
  } catch (error) {
    if (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return
    }
    throw error
  }
}

async function companionWasmBytesDefine(entrypoint: string): Promise<{
  __NOOK_COMPANION_WASM_BYTES__: string
}> {
  // Content autofill must not fetch chrome-extension WASM (or use import.meta);
  // embed the package bytes so classic content scripts can initialize Pilot.
  if (!entrypoint.includes('/content/autofill.ts')) {
    return { __NOOK_COMPANION_WASM_BYTES__: JSON.stringify('') }
  }
  const wasmPath = join(
    sharedRoot,
    'src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
  )
  const wasmBase64 = Buffer.from(await readFile(wasmPath)).toString('base64')
  return { __NOOK_COMPANION_WASM_BYTES__: JSON.stringify(wasmBase64) }
}

function stripClassicContentScriptForbiddenSyntax(source: string): string {
  // wasm-bindgen keeps a default path that references import.meta.url. Classic
  // content scripts reject that at parse time even when callers always pass bytes.
  return source.replace(
    /module_or_path = new URL\(["']nook_companion_wasm_bg\.wasm["'],\s*import\.meta\.url\);/g,
    'throw new Error("Companion WASM module_or_path must be provided.");',
  )
}

async function buildEntrypoint(entrypoint: string, outdir: string) {
  const result = await Bun.build({
    entrypoints: [join(projectRoot, entrypoint)],
    outdir: join(distDir, outdir),
    target: 'browser',
    format: extensionEntrypointBuildPolicy.format({ entrypoint }),
    sourcemap: 'external',
    minify: false,
    splitting: false,
    naming: '[name].js',
    define: {
      ...simpleVaultDefine,
      __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__: JSON.stringify(
        extensionDiagnosticsEnabled,
      ),
      ...(await companionWasmBytesDefine(entrypoint)),
    },
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error(`Failed to build ${entrypoint}`)
  }

  if (!entrypoint.includes('/content/')) {
    return
  }
  const entryName = entrypoint.split('/').pop()?.replace(/\.ts$/, '.js')
  if (!entryName) {
    return
  }
  const outputPath = join(distDir, outdir, entryName)
  const bundled = await readFile(outputPath, 'utf8')
  const classicSafe = stripClassicContentScriptForbiddenSyntax(bundled)
  if (
    classicSafe.includes('import.meta') ||
    /^\s*import\s/m.test(classicSafe) ||
    /^\s*export\s/m.test(classicSafe)
  ) {
    throw new Error(
      `Content bundle ${entryName} still contains classic-script-forbidden ESM syntax.`,
    )
  }
  if (classicSafe !== bundled) {
    await writeFile(outputPath, classicSafe)
  }
}

async function copyStaticFile(source: string, destination: string) {
  const outputPath = join(distDir, destination)
  await mkdir(dirname(outputPath), { recursive: true })
  await copyFile(source, outputPath)
}

async function buildSveltePage(page: 'popup') {
  const { build: viteBuild } = await extensionBuildDependencyLoader.importVite()
  const { svelte, vitePreprocess } =
    await extensionBuildDependencyLoader.importSvelte()

  await viteBuild({
    root: join(projectRoot, `src/${page}`),
    configFile: false,
    base: './',
    publicDir: false,
    plugins: [svelte({ preprocess: vitePreprocess({ script: true }) })],
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

type NookLocaleCatalogShape = {
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
      generate_password: string
      generate_password_working: string
      generate_password_failed: string
      generated_password_filled: string
      use_passkey: string
      create_passkey: string
      use_passkey_working: string
      create_passkey_working: string
      passkey_control_missing: string
      passkey_ceremony_started: string
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
      login_picker_opened: string
      login_picker_canceled: string
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
      authenticator_picker_opened: string
      authenticator_picker_canceled: string
      enroll_title: string
      enroll_description: string
      add_from_page: string
      save_backup_codes: string
      enroll_working: string
      enroll_unsupported: string
      enroll_no_qr: string
      enroll_ambiguous: string
      enroll_preview: string
      enroll_confirm: string
      enroll_cancel: string
      enroll_staging: string
      enroll_verify_filled: string
      enroll_verify_pending: string
      enroll_saved: string
      enroll_failed: string
      enroll_unlock: string
      enroll_issuer: string
      enroll_account: string
      enroll_origin: string
      enroll_algorithm: string
      enroll_digits: string
      enroll_period: string
      backup_title: string
      backup_description: string
      backup_working: string
      backup_empty: string
      backup_review: string
      backup_paste: string
      backup_confirm: string
      backup_cancel: string
      backup_saved: string
      backup_failed: string
      backup_choose_authenticator: string
      backup_mode_replace: string
      backup_mode_merge: string
    }
    passkey: {
      save_title: string
      use_title: string
      use_browser: string
    }
  }
}

type ExtensionLocaleCatalogAdmissionArgs = {
  value: unknown
  locale: string
}

type WidgetLocaleMessageKey =
  keyof NookLocaleCatalogShape['extension']['widget']
type PasskeyLocaleMessageKey =
  keyof NookLocaleCatalogShape['extension']['passkey']

class LocaleMessageSection<Key extends string> {
  private readonly messages: Record<string, unknown>

  constructor(value: unknown, label: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} locale catalog has an invalid shape.`)
    }
    this.messages = Object.fromEntries(Object.entries(value))
    for (const message of Object.values(this.messages)) {
      if (typeof message !== 'string') {
        throw new Error(`${label} locale catalog has an invalid shape.`)
      }
    }
  }

  message(key: Key, label: string): string {
    if (!(key in this.messages)) {
      throw new Error(`${label} locale catalog is missing ${key}.`)
    }
    const message: unknown = Reflect.get(this.messages, key)
    if (typeof message !== 'string') {
      throw new Error(`${label} locale catalog has an invalid message.`)
    }
    return message
  }
}

type NookLocaleCatalog = {
  extension: {
    widget: LocaleMessageSection<WidgetLocaleMessageKey>
    passkey: LocaleMessageSection<PasskeyLocaleMessageKey>
  }
}

class ExtensionLocaleCatalogAdmission {
  admit({
    value,
    locale,
  }: ExtensionLocaleCatalogAdmissionArgs): NookLocaleCatalog {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('extension' in value) ||
      !value.extension ||
      typeof value.extension !== 'object' ||
      Array.isArray(value.extension) ||
      !('widget' in value.extension) ||
      !('passkey' in value.extension)
    ) {
      throw new Error(`Locale catalog ${locale} has an invalid shape.`)
    }
    return {
      extension: {
        widget: new LocaleMessageSection<WidgetLocaleMessageKey>(
          value.extension.widget,
          `${locale} widget`,
        ),
        passkey: new LocaleMessageSection<PasskeyLocaleMessageKey>(
          value.extension.passkey,
          `${locale} passkey`,
        ),
      },
    }
  }
}

const identityJsonParse: (value: string) => unknown = JSON.parse
const extensionLocaleCatalogAdmission = new ExtensionLocaleCatalogAdmission()

async function buildChromeLocales() {
  await Promise.all(
    ['en', 'ru'].map(async (locale) => {
      const catalogValue = identityJsonParse(
        await readFile(join(appCommonLocalesRoot, `${locale}.json`), 'utf8'),
      )
      const admissionArgs: ExtensionLocaleCatalogAdmissionArgs = {
        value: catalogValue,
        locale,
      }
      const catalog = extensionLocaleCatalogAdmission.admit(admissionArgs)
      const messages = {
        widgetOpenVault: {
          message: catalog.extension.widget.message('open_vault', locale),
        },
        widgetDismiss: {
          message: catalog.extension.widget.message('dismiss', locale),
        },
        widgetCollapse: {
          message: catalog.extension.widget.message('collapse', locale),
        },
        widgetExpand: {
          message: catalog.extension.widget.message('expand', locale),
        },
        widgetPilotLabel: {
          message: catalog.extension.widget.message('pilot_label', locale),
        },
        widgetVaultConnected: {
          message: catalog.extension.widget.message('vault_connected', locale),
        },
        widgetVaultNotConnected: {
          message: catalog.extension.widget.message(
            'vault_not_connected',
            locale,
          ),
        },
        widgetConnectVault: {
          message: catalog.extension.widget.message('connect_vault', locale),
        },
        widgetLoginTitle: {
          message: catalog.extension.widget.message('login_title', locale),
        },
        widgetLoginDescription: {
          message: catalog.extension.widget.message(
            'login_description',
            locale,
          ),
        },
        widgetSignupTitle: {
          message: catalog.extension.widget.message('signup_title', locale),
        },
        widgetSignupDescription: {
          message: catalog.extension.widget.message(
            'signup_description',
            locale,
          ),
        },
        widgetPasswordChangeTitle: {
          message: catalog.extension.widget.message(
            'password_change_title',
            locale,
          ),
        },
        widgetPasswordChangeDescription: {
          message: catalog.extension.widget.message(
            'password_change_description',
            locale,
          ),
        },
        widgetGeneratePassword: {
          message: catalog.extension.widget.message(
            'generate_password',
            locale,
          ),
        },
        widgetGeneratePasswordWorking: {
          message: catalog.extension.widget.message(
            'generate_password_working',
            locale,
          ),
        },
        widgetGeneratePasswordFailed: {
          message: catalog.extension.widget.message(
            'generate_password_failed',
            locale,
          ),
        },
        widgetGeneratedPasswordFilled: {
          message: catalog.extension.widget.message(
            'generated_password_filled',
            locale,
          ),
        },
        widgetUsePasskey: {
          message: catalog.extension.widget.message('use_passkey', locale),
        },
        widgetCreatePasskey: {
          message: catalog.extension.widget.message('create_passkey', locale),
        },
        widgetUsePasskeyWorking: {
          message: catalog.extension.widget.message(
            'use_passkey_working',
            locale,
          ),
        },
        widgetCreatePasskeyWorking: {
          message: catalog.extension.widget.message(
            'create_passkey_working',
            locale,
          ),
        },
        widgetPasskeyControlMissing: {
          message: catalog.extension.widget.message(
            'passkey_control_missing',
            locale,
          ),
        },
        widgetPasskeyCeremonyStarted: {
          message: catalog.extension.widget.message(
            'passkey_ceremony_started',
            locale,
          ),
        },
        widgetSaveLoginTitle: {
          message: catalog.extension.widget.message('save_login_title', locale),
        },
        widgetSaveLoginDescription: {
          message: catalog.extension.widget.message(
            'save_login_description',
            locale,
          ),
        },
        widgetUpdateLoginTitle: {
          message: catalog.extension.widget.message(
            'update_login_title',
            locale,
          ),
        },
        widgetUpdateLoginDescription: {
          message: catalog.extension.widget.message(
            'update_login_description',
            locale,
          ),
        },
        widgetSaveLogin: {
          message: catalog.extension.widget.message('save_login', locale),
        },
        widgetUpdateLogin: {
          message: catalog.extension.widget.message('update_login', locale),
        },
        widgetSaveLoginNotNow: {
          message: catalog.extension.widget.message(
            'save_login_not_now',
            locale,
          ),
        },
        widgetSaveLoginFailed: {
          message: catalog.extension.widget.message(
            'save_login_failed',
            locale,
          ),
        },
        widgetSaveLoginSavedTitle: {
          message: catalog.extension.widget.message(
            'save_login_saved_title',
            locale,
          ),
        },
        widgetSaveLoginSavedDescription: {
          message: catalog.extension.widget.message(
            'save_login_saved_description',
            locale,
          ),
        },
        widgetTotpTitle: {
          message: catalog.extension.widget.message('totp_title', locale),
        },
        widgetTotpDescription: {
          message: catalog.extension.widget.message('totp_description', locale),
        },
        widgetManualTitle: {
          message: catalog.extension.widget.message('manual_title', locale),
        },
        widgetManualDescription: {
          message: catalog.extension.widget.message(
            'manual_description',
            locale,
          ),
        },
        widgetTakeOver: {
          message: catalog.extension.widget.message('take_over', locale),
        },
        widgetFillingTitle: {
          message: catalog.extension.widget.message('filling_title', locale),
        },
        widgetVerifyingTitle: {
          message: catalog.extension.widget.message('verifying_title', locale),
        },
        widgetSubmitted: {
          message: catalog.extension.widget.message('submitted', locale),
        },
        widgetGateStep: {
          message: catalog.extension.widget.message('gate_step', locale),
        },
        widgetGateTitle: {
          message: catalog.extension.widget.message('gate_title', locale),
        },
        widgetGateDescription: {
          message: catalog.extension.widget.message('gate_description', locale),
        },
        widgetContinue: {
          message: catalog.extension.widget.message('continue', locale),
        },
        widgetWorking: {
          message: catalog.extension.widget.message('working', locale),
        },
        widgetUnlockThenContinue: {
          message: catalog.extension.widget.message(
            'unlock_then_continue',
            locale,
          ),
        },
        widgetNoMatch: {
          message: catalog.extension.widget.message('no_match', locale),
        },
        widgetChooseAccount: {
          message: catalog.extension.widget.message('choose_account', locale),
        },
        widgetSavedLogin: {
          message: catalog.extension.widget.message('saved_login', locale),
        },
        widgetLoginPickerOpened: {
          message: catalog.extension.widget.message(
            'login_picker_opened',
            locale,
          ),
        },
        widgetLoginPickerCanceled: {
          message: catalog.extension.widget.message(
            'login_picker_canceled',
            locale,
          ),
        },
        widgetFillFailed: {
          message: catalog.extension.widget.message('fill_failed', locale),
        },
        widgetFilledManual: {
          message: catalog.extension.widget.message('filled_manual', locale),
        },
        widgetAuthenticatorStep: {
          message: catalog.extension.widget.message(
            'authenticator_step',
            locale,
          ),
        },
        widgetAuthenticatorTitle: {
          message: catalog.extension.widget.message(
            'authenticator_title',
            locale,
          ),
        },
        widgetAuthenticatorDescription: {
          message: catalog.extension.widget.message(
            'authenticator_description',
            locale,
          ),
        },
        widgetFillAuthenticator: {
          message: catalog.extension.widget.message(
            'fill_authenticator',
            locale,
          ),
        },
        widgetAuthenticatorWorking: {
          message: catalog.extension.widget.message(
            'authenticator_working',
            locale,
          ),
        },
        widgetAuthenticatorUnlock: {
          message: catalog.extension.widget.message(
            'authenticator_unlock',
            locale,
          ),
        },
        widgetNoAuthenticator: {
          message: catalog.extension.widget.message('no_authenticator', locale),
        },
        widgetAddAuthenticator: {
          message: catalog.extension.widget.message(
            'add_authenticator',
            locale,
          ),
        },
        widgetChooseAuthenticator: {
          message: catalog.extension.widget.message(
            'choose_authenticator',
            locale,
          ),
        },
        widgetSavedAuthenticator: {
          message: catalog.extension.widget.message(
            'saved_authenticator',
            locale,
          ),
        },
        widgetAuthenticatorFillFailed: {
          message: catalog.extension.widget.message(
            'authenticator_fill_failed',
            locale,
          ),
        },
        widgetAuthenticatorFilled: {
          message: catalog.extension.widget.message(
            'authenticator_filled',
            locale,
          ),
        },
        widgetAuthenticatorPickerOpened: {
          message: catalog.extension.widget.message(
            'authenticator_picker_opened',
            locale,
          ),
        },
        widgetAuthenticatorPickerCanceled: {
          message: catalog.extension.widget.message(
            'authenticator_picker_canceled',
            locale,
          ),
        },
        widgetEnrollTitle: {
          message: catalog.extension.widget.message('enroll_title', locale),
        },
        widgetEnrollDescription: {
          message: catalog.extension.widget.message(
            'enroll_description',
            locale,
          ),
        },
        widgetAddFromPage: {
          message: catalog.extension.widget.message('add_from_page', locale),
        },
        widgetSaveBackupCodes: {
          message: catalog.extension.widget.message(
            'save_backup_codes',
            locale,
          ),
        },
        widgetEnrollWorking: {
          message: catalog.extension.widget.message('enroll_working', locale),
        },
        widgetEnrollUnsupported: {
          message: catalog.extension.widget.message(
            'enroll_unsupported',
            locale,
          ),
        },
        widgetEnrollNoQr: {
          message: catalog.extension.widget.message('enroll_no_qr', locale),
        },
        widgetEnrollAmbiguous: {
          message: catalog.extension.widget.message('enroll_ambiguous', locale),
        },
        widgetEnrollPreview: {
          message: catalog.extension.widget.message('enroll_preview', locale),
        },
        widgetEnrollConfirm: {
          message: catalog.extension.widget.message('enroll_confirm', locale),
        },
        widgetEnrollCancel: {
          message: catalog.extension.widget.message('enroll_cancel', locale),
        },
        widgetEnrollStaging: {
          message: catalog.extension.widget.message('enroll_staging', locale),
        },
        widgetEnrollVerifyFilled: {
          message: catalog.extension.widget.message(
            'enroll_verify_filled',
            locale,
          ),
        },
        widgetEnrollVerifyPending: {
          message: catalog.extension.widget.message(
            'enroll_verify_pending',
            locale,
          ),
        },
        widgetEnrollSaved: {
          message: catalog.extension.widget.message('enroll_saved', locale),
        },
        widgetEnrollFailed: {
          message: catalog.extension.widget.message('enroll_failed', locale),
        },
        widgetEnrollUnlock: {
          message: catalog.extension.widget.message('enroll_unlock', locale),
        },
        widgetEnrollIssuer: {
          message: catalog.extension.widget.message('enroll_issuer', locale),
        },
        widgetEnrollAccount: {
          message: catalog.extension.widget.message('enroll_account', locale),
        },
        widgetEnrollOrigin: {
          message: catalog.extension.widget.message('enroll_origin', locale),
        },
        widgetEnrollAlgorithm: {
          message: catalog.extension.widget.message('enroll_algorithm', locale),
        },
        widgetEnrollDigits: {
          message: catalog.extension.widget.message('enroll_digits', locale),
        },
        widgetEnrollPeriod: {
          message: catalog.extension.widget.message('enroll_period', locale),
        },
        widgetBackupTitle: {
          message: catalog.extension.widget.message('backup_title', locale),
        },
        widgetBackupDescription: {
          message: catalog.extension.widget.message(
            'backup_description',
            locale,
          ),
        },
        widgetBackupWorking: {
          message: catalog.extension.widget.message('backup_working', locale),
        },
        widgetBackupEmpty: {
          message: catalog.extension.widget.message('backup_empty', locale),
        },
        widgetBackupReview: {
          message: catalog.extension.widget.message('backup_review', locale),
        },
        widgetBackupPaste: {
          message: catalog.extension.widget.message('backup_paste', locale),
        },
        widgetBackupConfirm: {
          message: catalog.extension.widget.message('backup_confirm', locale),
        },
        widgetBackupCancel: {
          message: catalog.extension.widget.message('backup_cancel', locale),
        },
        widgetBackupSaved: {
          message: catalog.extension.widget.message('backup_saved', locale),
        },
        widgetBackupFailed: {
          message: catalog.extension.widget.message('backup_failed', locale),
        },
        widgetBackupChooseAuthenticator: {
          message: catalog.extension.widget.message(
            'backup_choose_authenticator',
            locale,
          ),
        },
        widgetBackupModeReplace: {
          message: catalog.extension.widget.message(
            'backup_mode_replace',
            locale,
          ),
        },
        widgetBackupModeMerge: {
          message: catalog.extension.widget.message(
            'backup_mode_merge',
            locale,
          ),
        },
        passkeySaveTitle: {
          message: catalog.extension.passkey.message('save_title', locale),
        },
        passkeyUseTitle: {
          message: catalog.extension.passkey.message('use_title', locale),
        },
        passkeyUseBrowser: {
          message: catalog.extension.passkey.message('use_browser', locale),
        },
      }
      const localeDir = join(distDir, '_locales', locale)
      await mkdir(localeDir, { recursive: true })
      await writeFile(
        join(localeDir, 'messages.json'),
        `${JSON.stringify(messages, identityJsonReplacer, 2)}\n`,
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
  buildEntrypoint('src/content/companion-wasm-host.ts', 'content'),
  buildEntrypoint('src/content/authentication-route-page.ts', 'content'),
  buildEntrypoint('src/content/webauthn-content.ts', 'content'),
  buildEntrypoint('src/content/webauthn-page.ts', 'content'),
  buildEntrypoint('src/content/simple-vault-bridge.ts', 'content'),
  buildEntrypoint('src/offscreen/session.ts', 'offscreen'),
])

await Promise.all([buildSveltePage('popup'), buildChromeLocales()])

const manifestArgs: CreateExtensionManifestArgs = {
  kind: ExtensionManifestBuildKind.Channel,
  version: manifestVersion,
  simpleVaultBaseUrl,
  deployment: {
    key: deployment.manifestKey,
    name: deployment.name,
    shortName: deployment.shortName,
    versionName,
  },
}

await writeFile(
  join(distDir, 'manifest.json'),
  `${JSON.stringify(createManifest(manifestArgs), identityJsonReplacer, 2)}\n`,
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
  copyStaticFile(
    join(
      sharedRoot,
      'src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm',
    ),
    'content/nook_companion_wasm_bg.wasm',
  ),
  copyStaticFile(
    join(projectRoot, 'src/content/companion-wasm-host.html'),
    'content/companion-wasm-host.html',
  ),
])

console.log(`Built Nook extension at ${distDir}`)

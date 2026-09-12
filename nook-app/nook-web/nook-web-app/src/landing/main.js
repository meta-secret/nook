import { LANDING_MESSAGE_KEYS } from './generated-message-keys'
import './shell-and-hero.css'
import './vault-visual.css'
import './product-sections.css'
import './responsive.css'
import { landingMessages } from './messages.js'
import { replaceWithSafeTranslationHtml } from './translation-html.js'
import {
  GitHubStarsCacheLookupKind,
  GitHubStarsStateKind,
  githubStarsNotLoaded,
  loadedGitHubStars,
  readCachedGitHubStarCount,
} from './github-stars-state'
import {
  ExtensionMetadataStateKind,
  loadedExtensionMetadata,
  loadingExtensionMetadata,
  unavailableExtensionMetadata,
} from './extension-metadata-state'
import { localizeLandingStructuredData } from './structured-data'

/** @typedef {'en' | 'ru'} LandingLocale */
/** @typedef {'dark' | 'light'} LandingTheme */
/** @typedef {{ x: number, y: number }} DiagramPosition */
/** @typedef {DiagramPosition & { align: 'left' | 'center' | 'right' }} SignalSlot */
/** @typedef {{ schema_version: 2, channel: 'production', version: string, extension_id: string, install_url: string, install_method: 'chrome_web_store' } | { schema_version: 2, channel: string, version: string, extension_id: string, install_url: string, download_url: string, install_method: 'manual_zip' }} ExtensionMetadata */

class LandingDocument {
  /**
   * @param {string} selector
   * @returns {HTMLElement}
   */
  static element(selector) {
    const element = document.querySelector(selector)
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Landing element is unavailable: ${selector}`)
    }
    return element
  }

  /**
   * @param {string} selector
   * @returns {HTMLAnchorElement}
   */
  static anchor(selector) {
    const element = document.querySelector(selector)
    if (!(element instanceof HTMLAnchorElement)) {
      throw new Error(`Landing link is unavailable: ${selector}`)
    }
    return element
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement[]}
   */
  static elements(selector) {
    const elements = Array.from(document.querySelectorAll(selector))
    if (!elements.every((element) => element instanceof HTMLElement)) {
      throw new Error(`Landing elements have an invalid type: ${selector}`)
    }
    return elements
  }

  /** @returns {LandingLocale} */
  static locale() {
    const locale = document.documentElement.lang
    if (locale !== 'en' && locale !== 'ru') {
      throw new Error('Invalid landing locale.')
    }
    return locale
  }

  /**
   * @param {{ messages: Record<string, string>, key: string }} request
   */
  static message(request) {
    const { messages, key } = request
    const message = messages[key]
    if (!message) throw new Error(`Landing message is unavailable: ${key}`)
    return message
  }
}

const cryptoTerms = LandingDocument.elements('.crypto-term')
const readoutCode = LandingDocument.element('.readout-code')
const readoutTitle = LandingDocument.element('.readout-title')
const readoutDetail = LandingDocument.element('.readout-detail')
const themeToggle = LandingDocument.element('.theme-toggle')
const extensionInstallAction = LandingDocument.anchor(
  '.extension-install-action',
)
const extensionInstallStatus = LandingDocument.element(
  '.extension-install-status',
)
const extensionStoreNote = LandingDocument.element('.extension-store-note')
const extensionManual = LandingDocument.element('.extension-manual')
const githubStarsLink = LandingDocument.anchor('.github-stars')
const githubStarsCount = LandingDocument.element('.github-stars-count')
const landingColorScheme = matchMedia('(prefers-color-scheme: dark)')
/** @type {import('./extension-metadata-state').ExtensionMetadataState<ExtensionMetadata>} */
let extensionMetadataState = loadingExtensionMetadata()
let githubStarsState = githubStarsNotLoaded()
let followsSystemTheme = true

/** @param {HTMLElement} term */
function selectCryptoTerm(term) {
  for (const candidate of cryptoTerms) {
    const selected = candidate === term
    candidate.classList.toggle('is-active', selected)
    candidate.setAttribute('aria-pressed', String(selected))
  }
  const code = term.dataset.code
  const detail = term.dataset.detail
  if (!code || !detail) throw new Error('Landing term metadata is unavailable.')
  readoutCode.textContent = code
  readoutTitle.textContent = term.textContent.trim()
  readoutDetail.textContent = detail
}

/** @returns {LandingLocale} */
function resolveLandingLocale() {
  try {
    const savedLocale = localStorage.getItem('nook_locale')
    if (savedLocale === 'en' || savedLocale === 'ru') return savedLocale
  } catch {
    // Browser storage may be unavailable in privacy-restricted contexts.
  }

  const browserLanguages = [
    ...((v) => (v ? v : []))(navigator.languages),
    navigator.language,
  ]
  for (const language of browserLanguages) {
    const baseLanguage = language?.toLowerCase().split('-')[0]
    if (baseLanguage === 'en' || baseLanguage === 'ru') {
      return baseLanguage
    }
  }
  return 'en'
}

/**
 * @param {unknown} metadata
 * @returns {ExtensionMetadata}
 */
function validateExtensionMetadata(metadata) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('schema_version' in metadata) ||
    metadata.schema_version !== 2 ||
    !('channel' in metadata) ||
    typeof metadata.channel !== 'string' ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string' ||
    !('extension_id' in metadata) ||
    typeof metadata.extension_id !== 'string' ||
    !('install_url' in metadata) ||
    typeof metadata.install_url !== 'string' ||
    !('install_method' in metadata) ||
    (metadata.install_method !== 'chrome_web_store' &&
      metadata.install_method !== 'manual_zip') ||
    !/^[a-p]{32}$/.test(metadata.extension_id)
  ) {
    throw new Error('Invalid extension deployment metadata.')
  }

  const installUrl = new URL(metadata.install_url)
  if (metadata.channel === 'production') {
    const expectedStoreUrl = `https://chromewebstore.google.com/detail/${metadata.extension_id}`
    if (
      metadata.install_method !== 'chrome_web_store' ||
      installUrl.toString() !== expectedStoreUrl
    ) {
      throw new Error('Invalid Chrome Web Store installation target.')
    }
    return {
      schema_version: 2,
      channel: 'production',
      version: metadata.version,
      extension_id: metadata.extension_id,
      install_url: metadata.install_url,
      install_method: 'chrome_web_store',
    }
  } else {
    if (
      !('download_url' in metadata) ||
      typeof metadata.download_url !== 'string'
    ) {
      throw new Error('Invalid manual extension installation target.')
    }
    const downloadUrl = new URL(metadata.download_url)
    if (
      metadata.install_method !== 'manual_zip' ||
      installUrl.toString() !== downloadUrl.toString() ||
      downloadUrl.origin !== location.origin
    ) {
      throw new Error('Invalid manual extension installation target.')
    }
    return {
      schema_version: 2,
      channel: metadata.channel,
      version: metadata.version,
      extension_id: metadata.extension_id,
      install_url: metadata.install_url,
      download_url: metadata.download_url,
      install_method: 'manual_zip',
    }
  }
}

/** @param {LandingLocale} [locale] */
function updateExtensionInstallState(locale = LandingDocument.locale()) {
  const messages = landingMessages[locale]
  if (extensionMetadataState.kind === ExtensionMetadataStateKind.Unavailable) {
    extensionInstallStatus.textContent =
      messages[LANDING_MESSAGE_KEYS.ExtensionUnavailable]
    extensionInstallAction.hidden = true
    extensionStoreNote.hidden = true
    extensionManual.hidden = true
    return
  }
  if (extensionMetadataState.kind === ExtensionMetadataStateKind.Loading) {
    extensionInstallStatus.textContent =
      messages[LANDING_MESSAGE_KEYS.ExtensionLoading]
    return
  }

  const extensionMetadata = extensionMetadataState.metadata
  const storeInstall = extensionMetadata.install_method === 'chrome_web_store'
  const actionKey = storeInstall
    ? LANDING_MESSAGE_KEYS.ExtensionAddStore
    : LANDING_MESSAGE_KEYS.ExtensionDownloadZip
  extensionInstallAction.dataset.i18n = actionKey
  extensionInstallAction.textContent = messages[actionKey]
  extensionInstallAction.href = extensionMetadata.install_url
  extensionInstallAction.target = storeInstall ? '_blank' : ''
  extensionInstallAction.toggleAttribute('download', !storeInstall)
  extensionInstallAction.hidden = false
  extensionStoreNote.hidden = !storeInstall
  extensionManual.hidden = storeInstall
  extensionInstallStatus.textContent = `${messages[LANDING_MESSAGE_KEYS.ExtensionChannel]}: ${extensionMetadata.channel} · ${messages[LANDING_MESSAGE_KEYS.ExtensionVersion]}: ${extensionMetadata.version}`
}

async function loadExtensionMetadata() {
  try {
    const response = await fetch('./downloads/extension.json', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error('Extension metadata unavailable.')
    extensionMetadataState = loadedExtensionMetadata(
      validateExtensionMetadata(await response.json()),
    )
  } catch {
    extensionMetadataState = unavailableExtensionMetadata()
  }
  updateExtensionInstallState()
}

/** @param {LandingLocale} [locale] */
function updateGitHubStars(locale = LandingDocument.locale()) {
  const messages = landingMessages[locale]
  if (githubStarsState.kind === GitHubStarsStateKind.NotLoaded) {
    githubStarsCount.textContent = '—'
    githubStarsLink.setAttribute(
      'aria-label',
      messages[LANDING_MESSAGE_KEYS.GithubLinkLabel],
    )
    return
  }

  githubStarsCount.textContent = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(githubStarsState.count)
  githubStarsLink.setAttribute(
    'aria-label',
    `${messages[LANDING_MESSAGE_KEYS.GithubLinkLabel]} · ${messages[LANDING_MESSAGE_KEYS.GithubStarsLabel]}: ${new Intl.NumberFormat(locale).format(githubStarsState.count)}`,
  )
}

async function loadGitHubStars() {
  const cached = readCachedGitHubStarCount(localStorage)
  if (cached.kind === GitHubStarsCacheLookupKind.Found) {
    githubStarsState = loadedGitHubStars(cached.count)
    updateGitHubStars()
  }

  try {
    const response = await fetch(
      'https://api.github.com/repos/meta-secret/nook',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!response.ok) throw new Error('GitHub repository unavailable.')
    /** @type {unknown} */
    const repository = await response.json()
    if (
      !repository ||
      typeof repository !== 'object' ||
      !('stargazers_count' in repository) ||
      typeof repository.stargazers_count !== 'number' ||
      !Number.isSafeInteger(repository.stargazers_count) ||
      repository.stargazers_count < 0
    ) {
      throw new Error('Invalid GitHub repository metadata.')
    }
    const starCount = repository.stargazers_count
    githubStarsState = loadedGitHubStars(starCount)
    try {
      localStorage.setItem(
        'nook_github_stars',
        JSON.stringify({
          count: starCount,
          updatedAt: Date.now(),
        }),
      )
    } catch {
      // The live count remains visible when persistence is unavailable.
    }
  } catch {
    // Keep the cached count or neutral placeholder when GitHub is offline.
  }
  updateGitHubStars()
}

/**
 * @param {LandingLocale} locale
 * @param {boolean} [persist]
 */
function applyLandingLocale(locale, persist = false) {
  const messages = landingMessages[locale]
  document.documentElement.lang = locale
  document.title = messages[LANDING_MESSAGE_KEYS.MetaTitle]
  LandingDocument.element('meta[name="description"]').setAttribute(
    'content',
    messages[LANDING_MESSAGE_KEYS.MetaDescription],
  )

  for (const element of LandingDocument.elements('[data-i18n]')) {
    const messageKey = element.dataset.i18n
    if (!messageKey) throw new Error('Landing message key is unavailable.')
    element.textContent = LandingDocument.message({ messages, key: messageKey })
  }
  for (const element of LandingDocument.elements('[data-i18n-html]')) {
    const messageKey = element.dataset.i18nHtml
    if (!messageKey) throw new Error('Landing HTML message key is unavailable.')
    replaceWithSafeTranslationHtml(
      element,
      LandingDocument.message({ messages, key: messageKey }),
    )
  }
  for (const element of LandingDocument.elements('[data-i18n-aria-label]')) {
    const messageKey = element.dataset.i18nAriaLabel
    if (!messageKey) throw new Error('Landing label key is unavailable.')
    element.setAttribute(
      'aria-label',
      LandingDocument.message({ messages, key: messageKey }),
    )
  }
  for (const term of cryptoTerms) {
    const messageKey = term.dataset.i18nDetail
    if (!messageKey) throw new Error('Landing detail key is unavailable.')
    term.dataset.detail = LandingDocument.message({ messages, key: messageKey })
  }
  for (const button of LandingDocument.elements('[data-locale]')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.locale === locale),
    )
  }
  for (const label of LandingDocument.elements('.system-label')) {
    if (!('termIndex' in label.dataset)) continue
    const term = cryptoTerms[Number(label.dataset.termIndex)]
    if (!term) throw new Error('Landing term is unavailable.')
    label.dataset.detail = term.dataset.detail
    label.setAttribute(
      'aria-label',
      `${term.textContent.trim()}: ${term.dataset.detail}`,
    )
  }

  const activeTerm = cryptoTerms.find((term) =>
    term.classList.contains('is-active'),
  )
  if (activeTerm) selectCryptoTerm(activeTerm)

  updateThemeToggleLabel(locale)
  updateExtensionInstallState(locale)
  updateGitHubStars(locale)

  const structuredDataElement = LandingDocument.element('#structured-data')
  structuredDataElement.textContent = localizeLandingStructuredData({
    serialized: structuredDataElement.textContent,
    description: messages[LANDING_MESSAGE_KEYS.MetaDescription],
    locale,
  })

  if (persist) {
    try {
      localStorage.setItem('nook_locale', locale)
    } catch {
      // The visible locale still changes when persistence is unavailable.
    }
  }
}

/** @param {LandingLocale} [locale] */
function updateThemeToggleLabel(locale = LandingDocument.locale()) {
  const messageKey =
    document.documentElement.dataset.theme === 'dark'
      ? LANDING_MESSAGE_KEYS.ThemeSwitchLight
      : LANDING_MESSAGE_KEYS.ThemeSwitchDark
  themeToggle.dataset.i18nAriaLabel = messageKey
  themeToggle.setAttribute('aria-label', landingMessages[locale][messageKey])
}

/**
 * @param {LandingTheme} theme
 * @param {boolean} [persist]
 */
function applyLandingTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme
  updateThemeToggleLabel()
  if (persist) {
    followsSystemTheme = false
    try {
      localStorage.setItem('nook_color_mode', theme)
    } catch {
      // The visible theme still changes when persistence is unavailable.
    }
  }
}

try {
  const savedTheme = localStorage.getItem('nook_color_mode')
  followsSystemTheme = savedTheme !== 'light' && savedTheme !== 'dark'
} catch {
  followsSystemTheme = true
}

applyLandingLocale(resolveLandingLocale())
void loadExtensionMetadata()
void loadGitHubStars()

for (const button of LandingDocument.elements('[data-locale]')) {
  button.addEventListener('click', () => {
    const locale = button.dataset.locale
    if (locale !== 'en' && locale !== 'ru') {
      throw new Error('Invalid landing locale control.')
    }
    applyLandingLocale(locale, true)
  })
}

themeToggle.addEventListener('click', () => {
  const nextTheme =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  applyLandingTheme(nextTheme, true)
})

landingColorScheme.addEventListener('change', (event) => {
  if (followsSystemTheme) {
    applyLandingTheme(event.matches ? 'dark' : 'light')
  }
})

for (const term of cryptoTerms) {
  term.addEventListener('pointerenter', () => selectCryptoTerm(term))
  term.addEventListener('focus', () => selectCryptoTerm(term))
  term.addEventListener('click', () => selectCryptoTerm(term))
}

/**
 * @param {HTMLElement[]} values
 * @returns {HTMLElement[]}
 */
function shuffled(values) {
  return [...values]
    .map((value) => ({ value, order: Math.random() }))
    .sort((left, right) => left.order - right.order)
    .map(({ value }) => value)
}

/** @type {DiagramPosition[][]} */
const principleLayouts = [
  [
    { x: 34, y: 18 },
    { x: 68, y: 76 },
  ],
  [
    { x: 31, y: 70 },
    { x: 69, y: 18 },
  ],
  [
    { x: 35, y: 30 },
    { x: 70, y: 73 },
  ],
  [
    { x: 30, y: 66 },
    { x: 70, y: 29 },
  ],
]
const principleList = LandingDocument.element('.capsule-principles')
const principleLabels = LandingDocument.elements('.capsule-principles li')
const principleLayoutIndex = Math.floor(Math.random() * principleLayouts.length)
const selectedPrinciplePositions = principleLayouts[principleLayoutIndex]
if (!selectedPrinciplePositions) {
  throw new Error('Landing principle layout is unavailable.')
}
const principlePositions = selectedPrinciplePositions
principleList.dataset.layoutIndex = String(principleLayoutIndex)
for (const [index, principle] of principleLabels.entries()) {
  const position = principlePositions[index]
  if (!position) throw new Error('Landing principle position is unavailable.')
  principle.style.setProperty('--principle-x', `${position.x}%`)
  principle.style.setProperty('--principle-y', `${position.y}%`)
}

/** @type {SignalSlot[]} */
const signalSlots = [
  { x: 8, y: 14, align: 'left' },
  { x: 48, y: 10, align: 'center' },
  { x: 92, y: 17, align: 'right' },
  { x: 5, y: 34, align: 'left' },
  { x: 95, y: 37, align: 'right' },
  { x: 4, y: 57, align: 'left' },
  { x: 96, y: 59, align: 'right' },
  { x: 10, y: 76, align: 'left' },
  { x: 48, y: 77, align: 'center' },
  { x: 90, y: 75, align: 'right' },
]
const signalSlotSectors = [
  [0, 3],
  [1, 2, 4],
  [5, 6, 7, 8, 9],
]

const diagramLabels = LandingDocument.elements('.system-label')
const reduceMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches

/**
 * @param {number} leftIndex
 * @param {number} rightIndex
 */
function slotsConflict(leftIndex, rightIndex) {
  const left = signalSlots[leftIndex]
  const right = signalSlots[rightIndex]
  if (!left || !right) throw new Error('Landing signal slot is unavailable.')
  return positionsConflict(left, right)
}

/**
 * @param {DiagramPosition} left
 * @param {DiagramPosition} right
 */
function positionsConflict(left, right) {
  const horizontalDistance = Math.abs(left.x - right.x)
  const verticalDistance = Math.abs(left.y - right.y)

  return (
    (verticalDistance < 15 && horizontalDistance < 58) ||
    (horizontalDistance < 20 && verticalDistance < 20)
  )
}

/** @param {number} slotIndex */
function signalConflictsWithPrinciples(slotIndex) {
  const slot = signalSlots[slotIndex]
  if (!slot) throw new Error('Landing signal slot is unavailable.')
  return principlePositions.some((position) =>
    positionsConflict(slot, position),
  )
}

/**
 * @param {number} count
 * @returns {number[]}
 */
function pickDistributedSlots(count) {
  const sectors = signalSlotSectors.slice(0, count)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selected = sectors.map((sector) => {
      const slotIndex = sector[Math.floor(Math.random() * sector.length)]
      if (typeof slotIndex !== 'number') {
        throw new Error('Landing signal sector is empty.')
      }
      return slotIndex
    })
    const conflict = selected.some(
      (slotIndex, index) =>
        signalConflictsWithPrinciples(slotIndex) ||
        selected
          .slice(index + 1)
          .some((otherIndex) => slotsConflict(slotIndex, otherIndex)),
    )
    if (!conflict) return selected
  }

  return [0, 4, 8].slice(0, count)
}

/**
 * @param {HTMLElement} label
 * @param {HTMLElement} term
 * @param {number} slotIndex
 */
function assignSignal(label, term, slotIndex) {
  const slot = signalSlots[slotIndex]
  if (!slot) throw new Error('Landing signal slot is unavailable.')
  const jitterX = (Math.random() - 0.5) * 4
  const jitterY = (Math.random() - 0.5) * 3
  const x = Math.max(2, Math.min(98, slot.x + jitterX))
  const y = Math.max(8, Math.min(79, slot.y + jitterY))

  const code = term.dataset.code
  const detail = term.dataset.detail
  if (!code || !detail) throw new Error('Landing term metadata is unavailable.')
  label.textContent = code
  label.dataset.detail = detail
  label.dataset.termIndex = String(cryptoTerms.indexOf(term))
  label.dataset.slotIndex = String(slotIndex)
  label.dataset.tooltipX = slot.align
  label.dataset.tooltipY = y < 45 ? 'below' : 'above'
  label.style.setProperty('--signal-x', `${x}%`)
  label.style.setProperty('--signal-y', `${y}%`)
  label.style.setProperty(
    '--signal-shift-x',
    slot.align === 'left' ? '0%' : slot.align === 'right' ? '-100%' : '-50%',
  )
  label.style.setProperty(
    '--signal-drift-x',
    `${Math.round((Math.random() - 0.5) * 22)}px`,
  )
  label.style.setProperty(
    '--signal-drift-y',
    `${Math.round((Math.random() - 0.5) * 18)}px`,
  )
  label.style.setProperty(
    '--signal-duration',
    `${(7 + Math.random() * 5).toFixed(2)}s`,
  )
  label.style.setProperty(
    '--signal-delay',
    `${(-Math.random() * 6).toFixed(2)}s`,
  )
  label.setAttribute(
    'aria-label',
    `${term.textContent.trim()}: ${term.dataset.detail}`,
  )
}

const initialTerms = shuffled(cryptoTerms).slice(0, diagramLabels.length)
const initialSlots = pickDistributedSlots(diagramLabels.length)

for (const [index, label] of diagramLabels.entries()) {
  label.dataset.sectorIndex = String(index)
  const term = initialTerms[index]
  const slotIndex = initialSlots[index]
  if (!term || typeof slotIndex !== 'number') {
    throw new Error('Landing initial signal is unavailable.')
  }
  assignSignal(label, term, slotIndex)
  label.addEventListener('click', () => {
    const selectedTerm = cryptoTerms[Number(label.dataset.termIndex)]
    if (!selectedTerm) throw new Error('Landing term is unavailable.')
    selectCryptoTerm(selectedTerm)
  })
}

let signalRotationInProgress = false

/** @param {HTMLElement} label */
function rotateSignal(label) {
  if (
    document.hidden ||
    label.matches(':hover') ||
    document.activeElement === label ||
    signalRotationInProgress
  ) {
    scheduleSignalRotation(label, false)
    return
  }
  signalRotationInProgress = true

  const visibleTermIndexes = new Set(
    diagramLabels.map((candidate) => candidate.dataset.termIndex),
  )
  const nextTermIndexes = cryptoTerms
    .map((_, index) => index)
    .filter((index) => !visibleTermIndexes.has(String(index)))
  const occupiedSlotIndexes = new Set(
    diagramLabels
      .filter((candidate) => candidate !== label)
      .map((candidate) => Number(candidate.dataset.slotIndex)),
  )
  const [sectorSlots = signalSlots.map((_, index) => index)] = [
    signalSlotSectors[Number(label.dataset.sectorIndex)],
  ]
  const nextSlots = sectorSlots.filter(
    (index) =>
      !occupiedSlotIndexes.has(index) &&
      index !== Number(label.dataset.slotIndex) &&
      !signalConflictsWithPrinciples(index) &&
      [...occupiedSlotIndexes].every(
        (occupiedIndex) => !slotsConflict(index, occupiedIndex),
      ),
  )

  if (nextTermIndexes.length === 0 || nextSlots.length === 0) {
    signalRotationInProgress = false
    scheduleSignalRotation(label, false)
    return
  }

  const termIndex =
    nextTermIndexes[Math.floor(Math.random() * nextTermIndexes.length)]
  const slotIndex = nextSlots[Math.floor(Math.random() * nextSlots.length)]
  if (typeof termIndex !== 'number') {
    throw new Error('Landing rotated term is unavailable.')
  }
  const term = cryptoTerms[termIndex]
  if (!term || typeof slotIndex !== 'number') {
    throw new Error('Landing rotated signal is unavailable.')
  }
  label.classList.add('is-changing')
  window.setTimeout(() => {
    assignSignal(label, term, slotIndex)
    label.classList.remove('is-changing')
    signalRotationInProgress = false
    scheduleSignalRotation(label, false)
  }, 420)
}

/**
 * @param {HTMLElement} label
 * @param {boolean} initial
 * @param {number} [initialIndex]
 */
function scheduleSignalRotation(label, initial, initialIndex = 0) {
  const delay = initial
    ? 1300 + initialIndex * 1050 + Math.random() * 450
    : 4800 + Math.random() * 3700
  window.setTimeout(() => rotateSignal(label), delay)
}

if (!reduceMotion) {
  for (const [index, label] of diagramLabels.entries()) {
    scheduleSignalRotation(label, true, index)
  }
}

import './shell-and-hero.css'
import './vault-visual.css'
import './product-sections.css'
import './responsive.css'
import { landingMessages } from './messages.js'
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

const cryptoTerms = Array.from(document.querySelectorAll('.crypto-term'))
const readoutCode = document.querySelector('.readout-code')
const readoutTitle = document.querySelector('.readout-title')
const readoutDetail = document.querySelector('.readout-detail')
const themeToggle = document.querySelector('.theme-toggle')
const extensionInstallAction = document.querySelector(
  '.extension-install-action',
)
const extensionInstallStatus = document.querySelector(
  '.extension-install-status',
)
const extensionStoreNote = document.querySelector('.extension-store-note')
const extensionManual = document.querySelector('.extension-manual')
const githubStarsLink = document.querySelector('.github-stars')
const githubStarsCount = document.querySelector('.github-stars-count')
const landingColorScheme = matchMedia('(prefers-color-scheme: dark)')
let extensionMetadataState = loadingExtensionMetadata()
let githubStarsState = githubStarsNotLoaded()
let followsSystemTheme = true

function selectCryptoTerm(term) {
  for (const candidate of cryptoTerms) {
    const selected = candidate === term
    candidate.classList.toggle('is-active', selected)
    candidate.setAttribute('aria-pressed', String(selected))
  }
  readoutCode.textContent = term.dataset.code
  readoutTitle.textContent = term.textContent.trim()
  readoutDetail.textContent = term.dataset.detail
}

function resolveLandingLocale() {
  try {
    const savedLocale = localStorage.getItem('nook_locale')
    if (savedLocale === 'en' || savedLocale === 'ru') return savedLocale
  } catch {
    // Browser storage may be unavailable in privacy-restricted contexts.
  }

  const browserLanguages = [...(navigator.languages ?? []), navigator.language]
  for (const language of browserLanguages) {
    const baseLanguage = language?.toLowerCase().split('-')[0]
    if (baseLanguage === 'en' || baseLanguage === 'ru') {
      return baseLanguage
    }
  }
  return 'en'
}

function validateExtensionMetadata(metadata) {
  if (
    !metadata ||
    metadata.schema_version !== 2 ||
    typeof metadata.channel !== 'string' ||
    typeof metadata.version !== 'string' ||
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
  } else {
    const downloadUrl = new URL(metadata.download_url)
    if (
      metadata.install_method !== 'manual_zip' ||
      installUrl.toString() !== downloadUrl.toString() ||
      downloadUrl.origin !== location.origin
    ) {
      throw new Error('Invalid manual extension installation target.')
    }
  }
  return metadata
}

function updateExtensionInstallState(locale = document.documentElement.lang) {
  const messages = landingMessages[locale]
  if (extensionMetadataState.kind === ExtensionMetadataStateKind.Unavailable) {
    extensionInstallStatus.textContent = messages['extension.unavailable']
    extensionInstallAction.hidden = true
    extensionStoreNote.hidden = true
    extensionManual.hidden = true
    return
  }
  if (extensionMetadataState.kind === ExtensionMetadataStateKind.Loading) {
    extensionInstallStatus.textContent = messages['extension.loading']
    return
  }

  const extensionMetadata = extensionMetadataState.metadata
  const storeInstall = extensionMetadata.install_method === 'chrome_web_store'
  const actionKey = storeInstall
    ? 'extension.add_store'
    : 'extension.download_zip'
  extensionInstallAction.dataset.i18n = actionKey
  extensionInstallAction.textContent = messages[actionKey]
  extensionInstallAction.href = extensionMetadata.install_url
  extensionInstallAction.target = storeInstall ? '_blank' : ''
  extensionInstallAction.toggleAttribute('download', !storeInstall)
  extensionInstallAction.hidden = false
  extensionStoreNote.hidden = !storeInstall
  extensionManual.hidden = storeInstall
  extensionInstallStatus.textContent = `${messages['extension.channel']}: ${extensionMetadata.channel} · ${messages['extension.version']}: ${extensionMetadata.version}`
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

function updateGitHubStars(locale = document.documentElement.lang) {
  const messages = landingMessages[locale]
  if (githubStarsState.kind === GitHubStarsStateKind.NotLoaded) {
    githubStarsCount.textContent = '—'
    githubStarsLink.setAttribute('aria-label', messages['github.link_label'])
    return
  }

  githubStarsCount.textContent = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(githubStarsState.count)
  githubStarsLink.setAttribute(
    'aria-label',
    `${messages['github.link_label']} · ${messages['github.stars_label']}: ${new Intl.NumberFormat(locale).format(githubStarsState.count)}`,
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
    const repository = await response.json()
    if (
      !Number.isSafeInteger(repository.stargazers_count) ||
      repository.stargazers_count < 0
    ) {
      throw new Error('Invalid GitHub repository metadata.')
    }
    githubStarsState = loadedGitHubStars(repository.stargazers_count)
    try {
      localStorage.setItem(
        'nook_github_stars',
        JSON.stringify({
          count: githubStarsState.count,
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

function applyLandingLocale(locale, persist = false) {
  const messages = landingMessages[locale]
  document.documentElement.lang = locale
  document.title = messages['meta.title']
  document
    .querySelector('meta[name="description"]')
    .setAttribute('content', messages['meta.description'])

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = messages[element.dataset.i18n]
  }
  for (const element of document.querySelectorAll('[data-i18n-html]')) {
    element.innerHTML = messages[element.dataset.i18nHtml]
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', messages[element.dataset.i18nAriaLabel])
  }
  for (const term of cryptoTerms) {
    term.dataset.detail = messages[term.dataset.i18nDetail]
  }
  for (const button of document.querySelectorAll('[data-locale]')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.locale === locale),
    )
  }
  for (const label of document.querySelectorAll('.system-label')) {
    if (!('termIndex' in label.dataset)) continue
    const term = cryptoTerms[Number(label.dataset.termIndex)]
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

  const structuredDataElement = document.querySelector('#structured-data')
  const structuredData = JSON.parse(structuredDataElement.textContent)
  structuredData.description = messages['meta.description']
  structuredData.inLanguage = locale
  structuredDataElement.textContent = JSON.stringify(structuredData)

  if (persist) {
    try {
      localStorage.setItem('nook_locale', locale)
    } catch {
      // The visible locale still changes when persistence is unavailable.
    }
  }
}

function updateThemeToggleLabel(locale = document.documentElement.lang) {
  const nextTheme =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  const messageKey = `theme.switch_${nextTheme}`
  themeToggle.dataset.i18nAriaLabel = messageKey
  themeToggle.setAttribute('aria-label', landingMessages[locale][messageKey])
}

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

for (const button of document.querySelectorAll('[data-locale]')) {
  button.addEventListener('click', () => {
    applyLandingLocale(button.dataset.locale, true)
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

function shuffled(values) {
  return [...values]
    .map((value) => ({ value, order: Math.random() }))
    .sort((left, right) => left.order - right.order)
    .map(({ value }) => value)
}

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
const principleList = document.querySelector('.capsule-principles')
const principleLabels = Array.from(principleList.querySelectorAll('li'))
const principleLayoutIndex = Math.floor(Math.random() * principleLayouts.length)
const principlePositions = principleLayouts[principleLayoutIndex]
principleList.dataset.layoutIndex = String(principleLayoutIndex)
for (const [index, principle] of principleLabels.entries()) {
  const position = principlePositions[index]
  principle.style.setProperty('--principle-x', `${position.x}%`)
  principle.style.setProperty('--principle-y', `${position.y}%`)
}

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

const diagramLabels = Array.from(document.querySelectorAll('.system-label'))
const reduceMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches

function slotsConflict(leftIndex, rightIndex) {
  const left = signalSlots[leftIndex]
  const right = signalSlots[rightIndex]
  return positionsConflict(left, right)
}

function positionsConflict(left, right) {
  const horizontalDistance = Math.abs(left.x - right.x)
  const verticalDistance = Math.abs(left.y - right.y)

  return (
    (verticalDistance < 15 && horizontalDistance < 58) ||
    (horizontalDistance < 20 && verticalDistance < 20)
  )
}

function signalConflictsWithPrinciples(slotIndex) {
  return principlePositions.some((position) =>
    positionsConflict(signalSlots[slotIndex], position),
  )
}

function pickDistributedSlots(count) {
  const sectors = signalSlotSectors.slice(0, count)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selected = sectors.map(
      (sector) => sector[Math.floor(Math.random() * sector.length)],
    )
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

function assignSignal(label, term, slotIndex) {
  const slot = signalSlots[slotIndex]
  const jitterX = (Math.random() - 0.5) * 4
  const jitterY = (Math.random() - 0.5) * 3
  const x = Math.max(2, Math.min(98, slot.x + jitterX))
  const y = Math.max(8, Math.min(79, slot.y + jitterY))

  label.textContent = term.dataset.code
  label.dataset.detail = term.dataset.detail
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
  assignSignal(label, initialTerms[index], initialSlots[index])
  label.addEventListener('click', () => {
    selectCryptoTerm(cryptoTerms[Number(label.dataset.termIndex)])
  })
}

let signalRotationInProgress = false

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
  const sectorSlots =
    signalSlotSectors[Number(label.dataset.sectorIndex)] ??
    signalSlots.map((_, index) => index)
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
  label.classList.add('is-changing')
  window.setTimeout(() => {
    assignSignal(label, cryptoTerms[termIndex], slotIndex)
    label.classList.remove('is-changing')
    signalRotationInProgress = false
    scheduleSignalRotation(label, false)
  }, 420)
}

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

export {}

type PasswordFormSummary = {
  passwordFieldCount: number
  usernameFieldCount: number
  formCount: number
  observedAt: number
}

type ScanResponse = {
  ok: boolean
  summary?: PasswordFormSummary
}

const tabTitle = document.querySelector<HTMLParagraphElement>('#tab-title')
const passwordFieldCount = document.querySelector<HTMLElement>(
  '#password-field-count',
)
const usernameFieldCount = document.querySelector<HTMLElement>(
  '#username-field-count',
)
const formCount = document.querySelector<HTMLElement>('#form-count')
const statusMessage =
  document.querySelector<HTMLParagraphElement>('#status-message')

function setText(element: Element | null, value: string) {
  if (element) {
    element.textContent = value
  }
}

function renderSummary(summary: PasswordFormSummary) {
  setText(passwordFieldCount, String(summary.passwordFieldCount))
  setText(usernameFieldCount, String(summary.usernameFieldCount))
  setText(formCount, String(summary.formCount))

  if (summary.passwordFieldCount > 0) {
    setText(statusMessage, 'Nook found password fields on this page.')
    return
  }

  setText(statusMessage, 'No password fields detected on this page.')
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0])
    })
  })
}

function scanTab(tabId: number): Promise<ScanResponse> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage<ScanResponse>(
      tabId,
      { type: 'nook:scan-password-fields' },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false })
          return
        }

        resolve(response)
      },
    )
  })
}

const activeTab = await queryActiveTab()
setText(tabTitle, activeTab?.title ?? 'Current page')

if (typeof activeTab?.id !== 'number') {
  setText(statusMessage, 'Open a web page to scan for password fields.')
} else {
  const response = await scanTab(activeTab.id)

  if (response.ok && response.summary) {
    renderSummary(response.summary)
  } else {
    setText(statusMessage, 'Nook cannot inspect this page.')
  }
}

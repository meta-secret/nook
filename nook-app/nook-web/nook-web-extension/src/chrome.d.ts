type ChromeOffscreenDocumentCreationRequest = {
  url: string
  reasons: Array<'WORKERS'>
  justification: string
}

type ChromeTabsQueryRequest = { active?: boolean; currentWindow?: boolean }

type ChromeTabCreationRequest = { url: string }

type ChromeTabCreationPromiseRequest = { url: string }
type ChromeStorageItems = Record<string, unknown>

declare namespace chrome {
  namespace runtime {
    type MessageSender = {
      tab?: tabs.Tab
      frameId?: number
      id?: string
      url?: string
    }

    type InstalledDetails = {
      reason: 'install' | 'update' | 'chrome_update' | 'shared_module_update'
      previousVersion?: string
    }

    const lastError: { message?: string } | undefined
    const id: string

    function getURL(path: string): string

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function sendMessage<TResponse = unknown>(
      message: unknown,
      callback: (response: TResponse) => void,
    ): void
    function sendMessage<TResponse = unknown>(
      message: unknown,
    ): Promise<TResponse>

    const onInstalled: {
      addListener(listener: (details: InstalledDetails) => void): void
    }

    const onMessage: {
      addListener(
        // eslint-disable-next-line max-params -- Chrome owns the runtime listener signature.
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }

    const onMessageExternal: {
      addListener(
        // eslint-disable-next-line max-params -- Chrome owns the external listener signature.
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }
  }

  namespace offscreen {
    function createDocument(
      options: ChromeOffscreenDocumentCreationRequest,
    ): Promise<void>

    function closeDocument(): Promise<void>
  }

  namespace i18n {
    type ChromeI18nSubstitutions = string | string[]

    function getUILanguage(): string
    // eslint-disable-next-line max-params -- Chrome owns this localization signature.
    function getMessage(
      messageName: string,
      substitutions?: ChromeI18nSubstitutions,
    ): string
  }

  namespace action {
    const onClicked: {
      addListener(listener: (tab: tabs.Tab) => void): void
    }
  }

  namespace windows {
    type Window = { id?: number }

    type ChromeWindowCreationRequest = {
      url: string
      type?: 'normal' | 'popup' | 'panel' | 'detached_panel'
      width?: number
      height?: number
      focused?: boolean
    }

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function create(
      createData: ChromeWindowCreationRequest,
      callback: () => void,
    ): void
    function create(createData: ChromeWindowCreationRequest): Promise<Window>
    function remove(windowId: number): Promise<void>
  }

  namespace tabs {
    type Tab = {
      id?: number
      url?: string
      title?: string
    }
    type ChromeTabQueryResults = Tab[]

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function query(
      queryInfo: ChromeTabsQueryRequest,
      callback: (tabs: ChromeTabQueryResults) => void,
    ): void

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function create(
      createProperties: ChromeTabCreationRequest,
      callback: (tab: Tab) => void,
    ): void
    function create(
      createProperties: ChromeTabCreationPromiseRequest,
    ): Promise<Tab>
    function remove(tabId: number): Promise<void>

    // eslint-disable-next-line max-params -- Chrome owns this callback overload.
    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
      callback: (response: TResponse) => void,
    ): void
    // eslint-disable-next-line max-params -- Chrome owns this Promise overload.
    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
    ): Promise<TResponse>
  }

  namespace storage {
    type ChromeStorageKeys = string | string[]
    type ChromeStorageKeySelection = ChromeStorageKeys | ChromeStorageItems

    type StorageArea = {
      get(callback: (items: ChromeStorageItems) => void): void
      get(
        keys?: ChromeStorageKeySelection,
        callback?: (items: ChromeStorageItems) => void,
      ): void
      set(items: ChromeStorageItems, callback?: () => void): void
      remove(keys: ChromeStorageKeys, callback?: () => void): void
    }
    const local: StorageArea
    const session: StorageArea
  }
}

declare namespace chrome {
  namespace runtime {
    type MessageSender = {
      tab?: tabs.Tab
      id?: string
      url?: string
    }

    type InstalledDetails = {
      reason: 'install' | 'update' | 'chrome_update' | 'shared_module_update'
      previousVersion?: string
    }

    const lastError: { message?: string } | undefined
    const id: string

    function sendMessage<TResponse = unknown>(
      message: unknown,
      callback?: (response: TResponse) => void,
    ): void

    const onInstalled: {
      addListener(listener: (details: InstalledDetails) => void): void
    }

    const onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }

    const onMessageExternal: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }
  }

  namespace tabs {
    type Tab = {
      id?: number
      url?: string
      title?: string
    }

    function query(
      queryInfo: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void,
    ): void

    function create(createProperties: { url: string }): void

    function sendMessage<TResponse = unknown>(
      tabId: number,
      message: unknown,
      callback?: (response: TResponse) => void,
    ): void
  }

  namespace storage {
    const local: {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: Record<string, unknown>) => void,
      ): void
      set(items: Record<string, unknown>, callback?: () => void): void
    }
  }
}

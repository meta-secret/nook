import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect, type Browser, type Page } from '@playwright/test'
import { SIDE_PANEL_PAGE_PATH } from '../../src/lib/side-panel-page-path'

/**
 * Chromium flag for the test browser: it serves the DevTools protocol on a
 * free port and records the port in the profile's `DevToolsActivePort` file.
 */
export const REAL_SIDE_PANEL_BROWSER_ARG = '--remote-debugging-port=0'

/**
 * The extension's real side panel. A click on a page opens it beside that
 * page as its own extension document, which Playwright's persistent context
 * does not list; a second connection to the same browser over the DevTools
 * protocol reaches it as an ordinary Page, so tests drive the real panel and
 * its real service worker with no stand-in.
 */
export class RealSidePanel {
  private static readonly OPEN_TIMEOUT_MS = 15_000

  private constructor(
    private readonly connection: Browser,
    readonly page: Page,
  ) {}

  /** The panel of the browser using `userDataDir`, once it is open. */
  static async attach(userDataDir: string): Promise<RealSidePanel> {
    const portFile = await readFile(
      path.join(userDataDir, 'DevToolsActivePort'),
      'utf8',
    )
    const [port] = portFile.split('\n')
    const connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const panelPage = (): Page[] =>
      connection
        .contexts()
        .flatMap((context) => context.pages())
        .filter((page) => page.url().includes(SIDE_PANEL_PAGE_PATH))
    await expect
      .poll(() => panelPage().length, {
        timeout: RealSidePanel.OPEN_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
    const [page] = panelPage()
    if (!page) throw new Error('The side panel did not open')
    return new RealSidePanel(connection, page)
  }

  /** Ends this connection; the panel and the browser stay as they are. */
  async detach(): Promise<void> {
    await this.connection.close()
  }
}

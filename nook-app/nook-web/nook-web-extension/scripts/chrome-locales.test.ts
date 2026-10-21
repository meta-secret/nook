import { expect, test } from 'bun:test'
import { Effect, Schema } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildChromeLocales } from './chrome-locales'

type ChromeMessage = { readonly message: string }
type ChromeMessageFields = { readonly message: typeof Schema.String }
type PilotMessageFields = {
  readonly widgetLoginNoMatchTitle: Schema.Codec<ChromeMessage>
  readonly widgetOpenNook: Schema.Codec<ChromeMessage>
  readonly widgetOpenNookFailed: Schema.Codec<ChromeMessage>
}
type PilotLocaleExpectation = {
  readonly locale: string
  readonly title: string
  readonly action: string
  readonly failure: string
}
type PilotLocaleAssertion = PilotLocaleExpectation & {
  readonly distDir: string
}

/** Exercises the actual Chrome locale bundle consumed by the injected Pilot. */
class PilotChromeLocalesFixture {
  private static readonly messageFields: ChromeMessageFields = {
    message: Schema.String,
  }
  private static readonly message = Schema.Struct(
    PilotChromeLocalesFixture.messageFields,
  )
  private static readonly fields: PilotMessageFields = {
    widgetLoginNoMatchTitle: PilotChromeLocalesFixture.message,
    widgetOpenNook: PilotChromeLocalesFixture.message,
    widgetOpenNookFailed: PilotChromeLocalesFixture.message,
  }
  private static readonly schema = Schema.Struct(
    PilotChromeLocalesFixture.fields,
  )
  private static readonly locales: ReadonlyArray<PilotLocaleExpectation> = [
    {
      locale: 'en',
      title: 'No saved login for this site',
      action: 'Open Nook',
      failure: 'Nook could not open your vault. Select Open Nook to try again.',
    },
    {
      locale: 'ru',
      title: 'Для этого сайта нет сохранённого входа',
      action: 'Открыть Nook',
      failure:
        'Не удалось открыть сейф Nook. Нажмите «Открыть Nook», чтобы попробовать снова.',
    },
  ]

  run(): Promise<void> {
    return Effect.runPromise(
      Effect.acquireUseRelease(
        Effect.tryPromise(() => mkdtemp(join(tmpdir(), 'nook-pilot-locales-'))),
        this.buildAndAssert.bind(this),
        (distDir) => {
          const options: Parameters<typeof rm>[1] = {
            recursive: true,
            force: true,
          }
          return Effect.tryPromise(() => rm(distDir, options))
        },
      ),
    )
  }

  private buildAndAssert(distDir: string) {
    const request: Parameters<typeof buildChromeLocales>[0] = {
      appCommonLocalesRoot: join(
        import.meta.dir,
        '../../../nook-platform/nook-app-common/locales',
      ),
      distDir,
    }
    return Effect.tryPromise(() => buildChromeLocales(request)).pipe(
      Effect.andThen(
        Effect.forEach(PilotChromeLocalesFixture.locales, (locale) => {
          const assertion: PilotLocaleAssertion = { ...locale, distDir }
          return this.assertMessages(assertion)
        }),
      ),
      Effect.asVoid,
    )
  }

  private assertMessages(request: PilotLocaleAssertion) {
    const path = join(
      request.distDir,
      '_locales',
      request.locale,
      'messages.json',
    )
    return Effect.tryPromise(() => readFile(path, 'utf8')).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(PilotChromeLocalesFixture.schema),
        ),
      ),
      Effect.tap((messages) =>
        Effect.sync(() => {
          expect(messages.widgetLoginNoMatchTitle.message).toBe(request.title)
          expect(messages.widgetOpenNook.message).toBe(request.action)
          expect(messages.widgetOpenNookFailed.message).toBe(request.failure)
        }),
      ),
    )
  }
}

test('ships localized empty-login title, Open Nook action, and opening failure to Chrome', () =>
  new PilotChromeLocalesFixture().run())

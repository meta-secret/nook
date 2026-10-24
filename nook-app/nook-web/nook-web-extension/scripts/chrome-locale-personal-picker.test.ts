import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildChromeLocales } from './chrome-locales'
import { PersonalPickerMessage } from '../src/personal-picker/personal-picker-controller.svelte'

type ChromeMessage = { readonly message: string }

/** Reads the built Chrome messages the personal picker page uses. */
class PersonalPickerLocalesFixture {
  private static readonly messageFields = { message: Schema.String }
  private static readonly messages = Schema.Record(
    Schema.String,
    Schema.Struct(PersonalPickerLocalesFixture.messageFields),
  )
  distDir = ''

  async build(): Promise<void> {
    this.distDir = await mkdtemp(join(tmpdir(), 'nook-personal-picker-'))
    await buildChromeLocales({
      appCommonLocalesRoot: join(
        import.meta.dir,
        '../../../nook-platform/nook-app-common/locales',
      ),
      distDir: this.distDir,
    })
  }

  async messages(locale: string): Promise<Record<string, ChromeMessage>> {
    const text = await readFile(
      join(this.distDir, '_locales', locale, 'messages.json'),
      'utf8',
    )
    return Schema.decodeUnknownSync(
      Schema.fromJsonString(PersonalPickerLocalesFixture.messages),
    )(text)
  }
}

const fixture = new PersonalPickerLocalesFixture()
beforeAll(() => fixture.build())
afterAll(() => rm(fixture.distDir, { recursive: true, force: true }))

test.each(['en', 'ru'])(
  'builds every personal picker message for %s',
  async (locale) => {
    const messages = await fixture.messages(locale)
    for (const name of Object.values(PersonalPickerMessage)) {
      expect(messages[name]?.message.length).toBeGreaterThan(0)
    }
  },
)

test('the picker title follows the shared catalog', async () => {
  expect((await fixture.messages('en'))[PersonalPickerMessage.Title]).toEqual({
    message: 'Choose a record',
  })
  expect((await fixture.messages('ru'))[PersonalPickerMessage.Title]).toEqual({
    message: 'Выберите запись',
  })
})

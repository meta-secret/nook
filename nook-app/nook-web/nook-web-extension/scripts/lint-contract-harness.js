import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

// Runs the web lint tools the way their callers do, so each contract proves a
// rule through the tool that enforces it: oxlint for TypeScript and
// JavaScript, the TypeScript 7 success-contract check, and ESLint for Svelte.
// Oxlint JS plugins and the TypeScript 7 API run only on Node, so both run as
// Node child processes; ESLint runs in process.

const webRoot = fileURLToPath(new URL('../../', import.meta.url))
const oxlintCli = join(webRoot, 'nook-web-app/node_modules/oxlint/bin/oxlint')
const successContractCheck = join(webRoot, 'named-success-contract-check.ts')
const diagnosticLine =
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+): (?<message>.*) \[(?:Error|Warning)(?:\/(?<plugin>[^()\]]+)\((?<rule>[^()\]]+)\))?\]$/
const successContractLine =
  /^(?<file>.+?):(?<line>\d+):(?<column>\d+): error (?<rule>[^()]+)\((?<messageId>\w+)\): (?<message>.*)$/

/** @typedef {{ ruleId: string, message: string, messageId: string, line: number, column: number }} LintDiagnostic */
/** @typedef {{ source: string, extension: '.ts' | '.js', rules: Record<string, unknown> }} RuleLintRequest */
/** @typedef {{ config: string, file: string }} ConfigLintRequest */
/** @typedef {{ command: string[], cwd: string }} ToolRun */

/** @param {ToolRun} run @returns {string} */
function toolOutput(run) {
  const [command = '', ...args] = run.command
  const result = spawnSync(command, args, { cwd: run.cwd, encoding: 'utf8' })
  if (result.error) {
    throw new Error(
      `${command} did not start; oxlint JS plugins and the TypeScript 7 API need Node on PATH: ${result.error.message}`,
    )
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `${run.command.join(' ')} exited ${result.status}: ${result.stderr}`,
    )
  }
  return result.stdout
}

/** @param {Record<string, string>} ruleMessages @param {string} message */
function messageIdOf(ruleMessages, message) {
  const entry = Object.entries(ruleMessages).find(
    ([, text]) => text === message,
  )
  return entry ? entry[0] : ''
}

/** @param {string} output @param {Record<string, string>} ruleMessages @returns {LintDiagnostic[]} */
function oxlintDiagnostics(output, ruleMessages) {
  return output
    .split('\n')
    .flatMap((line) => {
      const groups = diagnosticLine.exec(line)?.groups
      if (!groups) return []
      const { plugin, rule, message = '' } = groups
      return [
        {
          ruleId: plugin && rule ? `${plugin}/${rule}` : 'parse-error',
          message,
          messageId: messageIdOf(ruleMessages, message),
          line: Number(groups.line),
          column: Number(groups.column),
        },
      ]
    })
    .sort((left, right) => left.line - right.line || left.column - right.column)
}

export class OxlintHarness {
  /** @type {Record<string, string>} */
  #ruleMessages
  #directory = mkdtempSync(join(tmpdir(), 'nook-oxlint-contract-'))

  /** @param {Record<string, string>} ruleMessages */
  constructor(ruleMessages) {
    this.#ruleMessages = ruleMessages
  }

  /**
   * Lints a source with only the given oxlint rules and the Nook JS plugins.
   * @param {RuleLintRequest} request
   */
  lintRules(request) {
    const config = join(this.#directory, '.oxlintrc.json')
    const file = join(this.#directory, `fixture${request.extension}`)
    writeFileSync(
      config,
      JSON.stringify({
        plugins: ['typescript'],
        categories: { correctness: 'off' },
        jsPlugins: [
          join(webRoot, 'oxlint-nook-typed-api-plugin.js'),
          join(webRoot, 'oxlint-restricted-syntax-plugin.js'),
        ],
        rules: request.rules,
      }),
    )
    writeFileSync(file, request.source)
    return oxlintDiagnostics(
      toolOutput({
        command: ['node', oxlintCli, '-c', config, '-f', 'unix', file],
        cwd: this.#directory,
      }),
      this.#ruleMessages,
    )
  }

  /**
   * Lints a file under the web root with a checked-in oxlint config.
   * @param {ConfigLintRequest} request
   */
  lintWithConfig(request) {
    return oxlintDiagnostics(
      toolOutput({
        command: [
          'node',
          oxlintCli,
          '-c',
          join(webRoot, request.config),
          '-f',
          'unix',
          request.file,
        ],
        cwd: webRoot,
      }),
      this.#ruleMessages,
    )
  }

  remove() {
    rmSync(this.#directory, { recursive: true, force: true })
  }
}

export class SuccessContractHarness {
  /**
   * Runs the TypeScript 7 success-contract check on one file.
   * @param {string} file
   * @returns {LintDiagnostic[]}
   */
  static check(file) {
    return toolOutput({
      command: ['node', successContractCheck, file],
      cwd: webRoot,
    })
      .split('\n')
      .flatMap((line) => {
        const groups = successContractLine.exec(line)?.groups
        if (!groups) return []
        const { rule = '', message = '', messageId = '' } = groups
        return [
          {
            ruleId: rule,
            message,
            messageId,
            line: Number(groups.line),
            column: Number(groups.column),
          },
        ]
      })
  }
}

export class SvelteEslintHarness {
  /** @type {ESLint} */
  #eslint

  /** @param {string} config ESLint config file, relative to the web root. */
  constructor(config) {
    // These contracts lint fixtures in one long-lived process. With CI=true
    // typescript-eslint infers a single run and builds its program once,
    // before the fixtures exist; keep the per-file programs.
    process.env.TSESTREE_SINGLE_RUN = 'false'
    this.#eslint = new ESLint({ cwd: webRoot, overrideConfigFile: config })
  }

  /**
   * Lints Svelte source text as the file at `filePath`.
   * @param {{ source: string, filePath: string }} request
   */
  async lint(request) {
    const [result] = await this.#eslint.lintText(request.source, {
      filePath: request.filePath,
    })
    return result ? result.messages : []
  }
}

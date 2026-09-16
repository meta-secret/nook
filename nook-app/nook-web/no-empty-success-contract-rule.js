import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { relative, resolve, sep } from 'node:path'
import { ESLintUtils } from '@typescript-eslint/utils'
import typescript from 'typescript'
import { namedSuccessContractBaseline } from './named-success-contract-baseline.js'

/** @typedef {import('@typescript-eslint/types').TSESTree.Node} AstNode */
/** @typedef {import('@typescript-eslint/types').TSESTree.CallExpression} AstCallExpression */
/** @typedef {import('@typescript-eslint/types').TSESTree.Program} AstProgram */
/** @typedef {import('@typescript-eslint/types').TSESTree.TSTypeReference} AstTypeReference */
/** @typedef {'emptySuccessCall' | 'emptySuccessType' | 'staleBaselineEntry'} MessageId */
/** @typedef {import('@typescript-eslint/utils').TSESLint.RuleContext<'emptySuccessCall' | 'emptySuccessType' | 'staleBaselineEntry', readonly []>} RuleContext */
/** @typedef {import('typescript').Type} TypeScriptType */
/** @typedef {import('typescript').Symbol} TypeScriptSymbol */

/** @param {string} filename */
function repositoryRelativePath(filename) {
  return relative(import.meta.dirname, resolve(filename)).split(sep).join('/')
}

/** @param {string} source */
function gitBlobSha1(source) {
  const byteLength = Buffer.byteLength(source, 'utf8')
  return createHash('sha1')
    .update(`blob ${byteLength}\0`, 'utf8')
    .update(source, 'utf8')
    .digest('hex')
}

/** @param {TypeScriptSymbol} symbol @param {string} expectedName @param {import('typescript').TypeChecker} checker */
function isNeverthrowSymbol(symbol, expectedName, checker) {
  let resolved = symbol
  const seen = new Set()
  while ((resolved.flags & typescript.SymbolFlags.Alias) !== 0) {
    if (seen.has(resolved)) return false
    seen.add(resolved)
    const aliased = checker.getAliasedSymbol(resolved)
    if (aliased === resolved) return false
    resolved = aliased
  }
  if (resolved.getName() !== expectedName) return false
  const declarations = resolved.declarations
  if (!declarations) return false
  return declarations.some((declaration) => {
    const pathSegments = resolve(declaration.getSourceFile().fileName).split(sep)
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
      if (
        pathSegments[index] === 'node_modules' &&
        pathSegments[index + 1] === 'neverthrow'
      ) {
        return true
      }
    }
    return false
  })
}

/** @param {TypeScriptType} type @returns {type is import('typescript').TypeReference} */
function isTypeReference(type) {
  return (
    (type.flags & typescript.TypeFlags.Object) !== 0 &&
    'objectFlags' in type &&
    (type.objectFlags & typescript.ObjectFlags.Reference) !== 0
  )
}

/** @param {TypeScriptType} type @param {Set<TypeScriptType>} seen @param {import('typescript').TypeChecker} checker */
function containsEmptyNeverthrowSuccess(type, seen, checker) {
  if (seen.has(type)) return false
  seen.add(type)

  if (type.isUnionOrIntersection()) {
    if (type.types.some((part) => containsEmptyNeverthrowSuccess(part, seen, checker))) {
      return true
    }
  }

  /** @type {Set<TypeScriptSymbol>} */
  const candidateSymbols = new Set()
  if (type.aliasSymbol) candidateSymbols.add(type.aliasSymbol)
  const resolvedSymbol = type.getSymbol()
  if (resolvedSymbol) candidateSymbols.add(resolvedSymbol)
  if (isTypeReference(type)) {
    const referenceSymbol = type.target.symbol
    if (referenceSymbol) candidateSymbols.add(referenceSymbol)
  }

  if (
    [...candidateSymbols].some((symbol) =>
      isNeverthrowSymbol(symbol, 'Ok', checker),
    )
  ) {
    const argumentsForSuccess = typeArguments(type, checker)
    const successType = argumentsForSuccess[0]
    if (successType && hasEmptySuccessValue(successType)) return true
  }

  if (hasTypeScriptPromiseSymbol(candidateSymbols)) {
    const fulfillmentType = typeArguments(type, checker)[0]
    if (
      fulfillmentType &&
      containsEmptyNeverthrowSuccess(fulfillmentType, seen, checker)
    ) {
      return true
    }
  }
  return false
}

/** @param {Set<TypeScriptSymbol>} symbols */
function hasTypeScriptPromiseSymbol(symbols) {
  return [...symbols].some((symbol) => {
    if (symbol.getName() !== 'Promise' && symbol.getName() !== 'PromiseLike') {
      return false
    }
    return (symbol.declarations ?? []).some((declaration) => {
      const segments = resolve(declaration.getSourceFile().fileName).split(sep)
      const libIndex = segments.lastIndexOf('lib')
      return (
        libIndex > 0 &&
        segments[libIndex - 1] === 'typescript' &&
        segments[libIndex + 1]?.startsWith('lib.') === true
      )
    })
  })
}

/** @param {TypeScriptType} type @param {import('typescript').TypeChecker} checker @returns {readonly TypeScriptType[]} */
function typeArguments(type, checker) {
  if (isTypeReference(type)) {
    return checker.getTypeArguments(type)
  }
  const aliasArguments = type.aliasTypeArguments
  return aliasArguments ? [...aliasArguments] : []
}

/** @param {TypeScriptType} type @returns {boolean} */
function hasEmptySuccessValue(type) {
  if (
    (type.flags & typescript.TypeFlags.Void) !== 0 ||
    (type.flags & typescript.TypeFlags.Undefined) !== 0
  ) {
    return true
  }
  return (
    type.isUnion() &&
    type.types.some((part) => hasEmptySuccessValue(part))
  )
}

/** @param {AstNode} node @param {import('typescript').TypeChecker} checker @param {import('@typescript-eslint/typescript-estree').ParserServices} services */
function outermostEmptyTypeReference(node, checker, services) {
  let current = node.parent
  while (current) {
    if (current.type === 'TSTypeReference') {
      const tsNode = services.esTreeNodeToTSNodeMap.get(current)
      if (
        typescript.isTypeReferenceNode(tsNode) &&
        containsEmptyNeverthrowSuccess(
          checker.getTypeFromTypeNode(tsNode),
          new Set(),
          checker,
        )
      ) {
        return true
      }
    }
    current = current.parent
  }
  return false
}

/** @param {AstCallExpression} node @param {import('typescript').TypeChecker} checker @param {import('@typescript-eslint/typescript-estree').ParserServices} services */
function isNeverthrowOkCall(node, checker, services) {
  const tsNode = services.esTreeNodeToTSNodeMap.get(node)
  if (!typescript.isCallExpression(tsNode)) return false
  const signature = checker.getResolvedSignature(tsNode)
  if (!signature) return false
  const declaration = signature.getDeclaration()
  if (!declaration || !('name' in declaration) || !declaration.name) {
    return false
  }
  const symbol = checker.getSymbolAtLocation(declaration.name)
  return symbol ? isNeverthrowSymbol(symbol, 'ok', checker) : false
}

/** @type {import('@typescript-eslint/utils').TSESLint.RuleModule<MessageId, readonly []>} */
export const noEmptySuccessContractRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      emptySuccessCall:
        'Nook web forbids an empty neverthrow success. Return a named concrete success value or capability.',
      emptySuccessType:
        'Nook web forbids an empty neverthrow success contract. Use a named concrete success value or capability.',
      staleBaselineEntry:
        'Named success source baseline for {{file}} is stale; remove or regenerate this exact-source entry.',
    },
  },
  /** @param {RuleContext} context */
  create(context) {
    const services = ESLintUtils.getParserServices(context)
    const checker = services.program.getTypeChecker()
    const sourceCode = context.sourceCode
    const file = repositoryRelativePath(context.filename)
    const fileEntries = namedSuccessContractBaseline.filter(
      (entry) => entry.file === file,
    )
    /** @type {{ node: AstNode, messageId: 'emptySuccessCall' | 'emptySuccessType' }[]} */
    const violations = []

    return {
      /** @param {AstTypeReference} node */
      TSTypeReference(node) {
        const tsNode = services.esTreeNodeToTSNodeMap.get(node)
        if (
          !typescript.isTypeReferenceNode(tsNode) ||
          !containsEmptyNeverthrowSuccess(
            checker.getTypeFromTypeNode(tsNode),
            new Set(),
            checker,
          ) ||
          outermostEmptyTypeReference(node, checker, services)
        ) {
          return
        }
        violations.push({ node, messageId: 'emptySuccessType' })
      },
      /** @param {AstCallExpression} node */
      CallExpression(node) {
        if (!isNeverthrowOkCall(node, checker, services)) return
        const tsNode = services.esTreeNodeToTSNodeMap.get(node)
        const resultType = checker.getTypeAtLocation(tsNode)
        if (
          node.arguments.length === 0 ||
          containsEmptyNeverthrowSuccess(resultType, new Set(), checker)
        ) {
          violations.push({ node, messageId: 'emptySuccessCall' })
        }
      },
      /** @param {AstProgram} node */
      'Program:exit'(node) {
        const currentBlobSha1 = gitBlobSha1(sourceCode.text)
        const exactSourceBaseline = fileEntries.find(
          (entry) => entry.gitBlobSha1 === currentBlobSha1,
        )

        // A baseline suppresses only typed findings in the exact immutable
        // source snapshot. Source edits invalidate it for every finding.
        if (exactSourceBaseline && violations.length > 0) return

        for (const entry of fileEntries) {
          context.report({
            node,
            messageId: 'staleBaselineEntry',
            data: { file: entry.file },
          })
        }
        for (const violation of violations) {
          context.report(violation)
        }
      },
    }
  },
}

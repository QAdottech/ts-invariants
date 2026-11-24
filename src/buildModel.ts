import fs from 'node:fs'
import path from 'node:path'

import ts from '@typescript/typescript6'

import { callablesOf, type Callable } from './complexity.ts'
import type { Access, Item, ItemKind, Model, Reference, SourceFile } from './model.ts'
import type { MemberLookup, NativeMembers } from './nativeMembers.ts'

const isTypeScriptSource = (file: string) =>
  /\.[mc]?tsx?$/.test(file) && !/\.d\.[mc]?tsx?$/.test(file)

const unwrapExpression = (expression: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expression) ||
  ts.isAsExpression(expression) ||
  ts.isSatisfiesExpression(expression)
    ? unwrapExpression(expression.expression)
    : expression

const isFunctionExpression = (expression: ts.Expression | undefined): boolean => {
  if (!expression) return false
  const inner = unwrapExpression(expression)
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return true
  // `memo(() => ...)`, `forwardRef(...)`, `cache(async () => ...)`
  return ts.isCallExpression(inner) && inner.arguments.some(isFunctionExpression)
}

const isPrivateMember = (member: ts.ClassElement | ts.ParameterDeclaration) =>
  (member.name !== undefined && ts.isPrivateIdentifier(member.name)) ||
  (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) !== 0

const isStaticMember = (member: ts.ClassElement) =>
  (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0

/** The single call a function body only returns or makes, if that is all it does. */
const forwardedCall = (body: ts.ConciseBody | undefined): ts.CallExpression | undefined => {
  if (!body) return undefined
  if (!ts.isBlock(body)) {
    const inner = unwrapExpression(ts.isAwaitExpression(body) ? body.expression : body)
    return ts.isCallExpression(inner) ? inner : undefined
  }
  if (body.statements.length !== 1) return undefined
  const [statement] = body.statements
  const expression =
    statement && ts.isReturnStatement(statement)
      ? statement.expression
      : statement && ts.isExpressionStatement(statement)
        ? statement.expression
        : undefined
  if (!expression) return undefined
  const inner = unwrapExpression(
    ts.isAwaitExpression(expression) ? expression.expression : expression,
  )
  return ts.isCallExpression(inner) ? inner : undefined
}

const bodyOf = (node: ts.Node): ts.ConciseBody | undefined => {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isAccessor(node))
    return node.body
  const initializer =
    ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) ? node.initializer : undefined
  const inner = initializer && unwrapExpression(initializer)
  return inner && (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner))
    ? inner.body
    : undefined
}

const accessOf = (identifier: ts.Identifier): Access => {
  const access = identifier.parent
  if (!ts.isPropertyAccessExpression(access) || access.name !== identifier) return 'read'
  const user = access.parent
  if (ts.isBinaryExpression(user) && user.left === access)
    return user.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      user.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ? 'write'
      : 'read'
  if (
    (ts.isPrefixUnaryExpression(user) || ts.isPostfixUnaryExpression(user)) &&
    (user.operator === ts.SyntaxKind.PlusPlusToken ||
      user.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return 'write'
  if (ts.isDeleteExpression(user)) return 'write'
  if (
    ((ts.isPropertyAccessExpression(user) || ts.isElementAccessExpression(user)) &&
      user.expression === access) ||
    (ts.isCallExpression(user) && user.expression === access)
  )
    return 'reach'
  return 'read'
}

const isInImportOrExport = (node: ts.Node): boolean => {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isImportEqualsDeclaration(current)) return true
    if (ts.isExportDeclaration(current)) return current.moduleSpecifier !== undefined
    if (ts.isSourceFile(current)) return false
  }
  return false
}

/**
 * Reads the tsconfigs and indexes every file under `root` they hold, each
 * file once, into declarations and the references between them.
 */
export const buildModel = ({
  root,
  tsconfigs,
  isExcluded,
  isTest,
  nativeMembers,
  log,
}: {
  root: string
  tsconfigs: string[]
  isExcluded: (file: string) => boolean
  isTest: (file: string) => boolean
  /** Without it, `x.member` names resolve with the TS 6 checker: right, but slow on large projects. */
  nativeMembers?: NativeMembers
  log: (message: string) => void
}): Model => {
  const items = new Map<string, Item>()
  const references: Reference[] = []
  const files: SourceFile[] = []
  const callables: Callable[] = []
  const walked = new Set<string>()
  const memberNames = new Set<string>()
  /** Class members by `file:end`: the end offset is the same in TS 6's and TS 7's trees. */
  const memberEnds = new Map<string, string>()
  /** `x.member` names left for TS 7 to resolve, by tsconfig and file. */
  const pending = new Map<string, Map<string, (Omit<Reference, 'to'> & MemberLookup)[]>>()
  const packageRoots = new Map<string, string>()

  const relative = (fileName: string) => path.relative(root, fs.realpathSync.native(fileName))
  const inScope = (file: string) =>
    !file.startsWith('..') && isTypeScriptSource(file) && !isExcluded(file)

  const packageOf = (file: string): string => {
    const directory = path.dirname(file)
    const known = packageRoots.get(directory)
    if (known !== undefined) return known
    const found =
      directory === '.' || fs.existsSync(path.join(root, directory, 'package.json'))
        ? directory
        : packageOf(directory)
    packageRoots.set(directory, found)
    return found
  }

  // A solution-style tsconfig (`"files": []` with `references`) holds its code
  // in the projects it references, so those are indexed after it.
  const queue = tsconfigs.map((tsconfig) => path.resolve(tsconfig))
  const seen = new Set<string>()
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const tsconfig = next
    if (seen.has(tsconfig)) continue
    seen.add(tsconfig)
    const config = ts.getParsedCommandLineOfConfigFile(
      tsconfig,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    )
    if (!config) continue
    for (const reference of config.projectReferences ?? [])
      queue.push(ts.resolveProjectReferencePath(reference))
    const fresh = config.fileNames.filter((fileName) => {
      const file = relative(fileName)
      return inScope(file) && !walked.has(file)
    })
    if (fresh.length === 0) continue

    const started = Date.now()
    const program = ts.createProgram({
      rootNames: config.fileNames,
      options: { ...config.options, noEmit: true, incremental: false },
      projectReferences: config.projectReferences,
    })
    const checker = program.getTypeChecker()
    const keyOf = (node: ts.Node) => {
      const sourceFile = node.getSourceFile()
      return `${relative(sourceFile.fileName)}:${node.getStart(sourceFile)}`
    }

    const sourceFiles = program
      .getSourceFiles()
      .map((sourceFile) => ({
        sourceFile,
        file: relative(sourceFile.fileName),
      }))
      .filter(({ file }) => inScope(file))

    for (const { sourceFile, file } of sourceFiles) registerItems({ sourceFile, file })

    let newlyWalked = 0
    for (const { sourceFile, file } of sourceFiles) {
      if (walked.has(file)) continue
      walked.add(file)
      newlyWalked++
      files.push({ file, lines: sourceFile.getLineStarts().length })
      walkFile({ sourceFile, file })
      callables.push(...callablesOf({ sourceFile, file }))
    }
    log(
      `${path.relative(root, tsconfig)}: ${newlyWalked} new files in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )

    function registerItems({ sourceFile, file }: { sourceFile: ts.SourceFile; file: string }) {
      const add = ({
        node,
        name,
        kind,
        owner,
        isFunction = false,
        isStatic = false,
        isPrivate = false,
      }: {
        node: ts.Node
        name: string
        kind: ItemKind
        owner?: string
        isFunction?: boolean
        isStatic?: boolean
        isPrivate?: boolean
      }) => {
        const id = keyOf(node)
        if (owner) {
          memberNames.add(name.slice(name.indexOf('.') + 1))
          memberEnds.set(`${file}:${node.end}`, id)
        }
        if (!items.has(id)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
          items.set(id, {
            id,
            name,
            kind,
            file,
            line,
            owner,
            isFunction,
            isStatic,
            isPrivate,
          })
        }
        return id
      }

      items.set(`${file}:module`, {
        id: `${file}:module`,
        name: '<module>',
        kind: 'module-scope',
        file,
        line: 1,
        isFunction: false,
        isStatic: false,
        isPrivate: false,
      })

      for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement))
          add({
            node: statement,
            name: statement.name?.text ?? 'default',
            kind: 'function',
            isFunction: statement.body !== undefined,
          })
        else if (ts.isVariableStatement(statement))
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue
            add({
              node: declaration,
              name: declaration.name.text,
              kind: 'variable',
              isFunction: isFunctionExpression(declaration.initializer),
            })
          }
        else if (ts.isClassDeclaration(statement)) {
          const className = statement.name?.text ?? 'default'
          const owner = add({ node: statement, name: className, kind: 'class' })
          for (const member of statement.members) {
            const memberName =
              member.name && ts.isIdentifier(member.name) ? member.name.text : undefined
            if (ts.isConstructorDeclaration(member)) {
              add({
                node: member,
                name: `${className}.constructor`,
                kind: 'method',
                owner,
                isFunction: true,
                isStatic: true,
              })
              for (const parameter of member.parameters)
                if (
                  ts.isParameterPropertyDeclaration(parameter, member) &&
                  ts.isIdentifier(parameter.name)
                )
                  add({
                    node: parameter,
                    name: `${className}.${parameter.name.text}`,
                    kind: 'field',
                    owner,
                    isPrivate: isPrivateMember(parameter),
                  })
              continue
            }
            const name = `${className}.${memberName ?? member.name?.getText(sourceFile) ?? '[index]'}`
            const flags = {
              owner,
              isStatic: isStaticMember(member),
              isPrivate: isPrivateMember(member),
            }
            if (ts.isMethodDeclaration(member))
              add({
                node: member,
                name,
                kind: 'method',
                isFunction: member.body !== undefined,
                ...flags,
              })
            else if (ts.isAccessor(member))
              add({
                node: member,
                name,
                kind: 'accessor',
                isFunction: true,
                ...flags,
              })
            else if (ts.isPropertyDeclaration(member))
              add({
                node: member,
                name,
                ...(isFunctionExpression(member.initializer)
                  ? { kind: 'method', isFunction: true }
                  : { kind: 'field' }),
                ...flags,
              })
          }
        } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
          add({ node: statement, name: statement.name.text, kind: 'type' })
        else if (ts.isEnumDeclaration(statement))
          add({ node: statement, name: statement.name.text, kind: 'enum' })
      }
    }

    /**
     * Resolving `x.name` needs the type of `x`, which is most of the checker's
     * work; only class members can be items, so skip names no class declares.
     */
    function isWorthResolving(identifier: ts.Identifier) {
      const parent = identifier.parent
      if (ts.isShorthandPropertyAssignment(parent)) return true
      if (ts.isPropertyAccessExpression(parent)) return parent.name !== identifier
      if (ts.isQualifiedName(parent)) return parent.right !== identifier
      if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false
      // Declaration names, object keys and JSX attributes name nothing else.
      return !('name' in parent && parent.name === identifier)
    }

    function targetOf(identifier: ts.Identifier): string | undefined {
      const symbolAt = ts.isShorthandPropertyAssignment(identifier.parent)
        ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
        : checker.getSymbolAtLocation(identifier)
      if (!symbolAt) return undefined
      let symbol = symbolAt
      if (symbol.flags & ts.SymbolFlags.Alias) {
        try {
          symbol = checker.getAliasedSymbol(symbol)
        } catch {
          return undefined
        }
      }
      for (const declaration of symbol.declarations ?? []) {
        const id = keyOf(declaration)
        if (items.has(id)) return id
      }
      return undefined
    }

    function walkFile({ sourceFile, file }: { sourceFile: ts.SourceFile; file: string }) {
      const record = ({ identifier, from }: { identifier: ts.Identifier; from: string }) => {
        const start = identifier.getStart(sourceFile)
        const position = sourceFile.getLineAndCharacterOfPosition(start)
        const parent = identifier.parent
        if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
          if (!memberNames.has(identifier.text)) return
          if (!nativeMembers) {
            const to = targetOf(identifier)
            if (to && to !== from)
              references.push({
                from,
                to,
                file,
                line: position.line + 1,
                column: position.character + 1,
                access: accessOf(identifier),
              })
            return
          }
          const byFile = pending.get(tsconfig) ?? new Map()
          pending.set(tsconfig, byFile)
          const waiting = byFile.get(sourceFile.fileName) ?? []
          byFile.set(sourceFile.fileName, waiting)
          waiting.push({
            from,
            file,
            line: position.line + 1,
            column: position.character + 1,
            access: accessOf(identifier),
            position: start,
          })
          return
        }
        if (!isWorthResolving(identifier) || isInImportOrExport(identifier)) return
        const to = targetOf(identifier)
        if (!to || to === from) return
        const target = items.get(to)
        references.push({
          from,
          to,
          file,
          line: position.line + 1,
          column: position.character + 1,
          access:
            target?.kind === 'field' || target?.kind === 'accessor' ? accessOf(identifier) : 'read',
        })
      }
      const walk = ({ node, from }: { node: ts.Node; from: string }) => {
        if (ts.isIdentifier(node)) record({ identifier: node, from })
        ts.forEachChild(node, (child) => walk({ node: child, from }))
      }
      const noteForwarding = ({ node, id }: { node: ts.Node; id: string }) => {
        const item = items.get(id)
        if (!item) return
        const body = bodyOf(node)
        const call = forwardedCall(body)
        if (call) {
          const callee = ts.isPropertyAccessExpression(call.expression)
            ? call.expression.name
            : call.expression
          const wraps = ts.isIdentifier(callee) ? targetOf(callee) : undefined
          if (wraps && items.get(wraps)?.isFunction) item.wraps = wraps
        }
        if (item.kind === 'accessor' && body && ts.isBlock(body) && body.statements.length === 1) {
          const [statement] = body.statements
          const returned =
            statement && ts.isReturnStatement(statement) ? statement.expression : undefined
          if (
            returned &&
            ts.isPropertyAccessExpression(returned) &&
            returned.expression.kind === ts.SyntaxKind.ThisKeyword &&
            ts.isIdentifier(returned.name)
          ) {
            const field = targetOf(returned.name)
            if (field && items.get(field)?.kind === 'field') item.forwardsField = field
          }
        }
      }

      const moduleScope = `${file}:module`
      for (const statement of sourceFile.statements) {
        if (
          ts.isFunctionDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement)
        ) {
          const id = keyOf(statement)
          walk({ node: statement, from: items.has(id) ? id : moduleScope })
          noteForwarding({ node: statement, id })
        } else if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            const id = keyOf(declaration)
            walk({ node: declaration, from: items.has(id) ? id : moduleScope })
            noteForwarding({ node: declaration, id })
          }
        } else if (ts.isClassDeclaration(statement)) {
          const classId = keyOf(statement)
          for (const clause of statement.heritageClauses ?? []) {
            walk({ node: clause, from: classId })
            const parent =
              clause.token === ts.SyntaxKind.ExtendsKeyword ? clause.types[0] : undefined
            const parentName =
              parent && ts.isIdentifier(parent.expression) ? parent.expression : undefined
            const parentId = parentName && targetOf(parentName)
            const classItem = items.get(classId)
            if (parentId && classItem) classItem.extends = parentId
          }
          for (const decorator of ts.getDecorators(statement) ?? [])
            walk({ node: decorator, from: classId })
          for (const member of statement.members) {
            const id = keyOf(member)
            const from = items.has(id) ? id : classId
            walk({ node: member, from })
            noteForwarding({ node: member, id })
          }
        } else walk({ node: statement, from: moduleScope })
      }
    }
  }

  resolveMembers()
  return { root, items, references, files, callables, packageOf, isTest }

  function resolveMembers() {
    if (!nativeMembers) return
    for (const [tsconfig, byFile] of pending) {
      const started = Date.now()
      const results = nativeMembers({ root, tsconfig, byFile, isWanted: inScope })
      let resolved = 0
      for (const [fileName, lookups] of byFile) {
        const ends = results.get(fileName) ?? []
        lookups.forEach(({ position: _position, ...reference }, at) => {
          const end = ends[at]
          const to = end === undefined ? undefined : memberEnds.get(end)
          if (!to || to === reference.from) return
          references.push({ ...reference, to })
          resolved++
        })
      }
      log(
        `${path.relative(root, tsconfig)}: ${resolved} member references in ${((Date.now() - started) / 1000).toFixed(1)}s (TS 7)`,
      )
    }
  }
}

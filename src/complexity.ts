import ts from '@typescript/typescript6'

/** A function, method, accessor or function expression, measured on its own body. */
export type Callable = {
  file: string
  name: string
  line: number
  /** McCabe's cyclomatic complexity: 1 plus one per branch. */
  complexity: number
  /** Lines holding code, not blank or comment lines. Nested functions count for themselves only. */
  sloc: number
}

const isCallable = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  (ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isAccessor(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)) &&
  node.body !== undefined

const isBranch = (node: ts.Node) => {
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind
    return (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    )
  }
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ConditionalExpression:
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.CatchClause:
      return true
    default:
      return false
  }
}

const isJSDoc = (node: ts.Node) =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode

const nameOf = (node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string => {
  if (node.name) return node.name.getText(sourceFile)
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  const parent = node.parent
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent)
  )
    return parent.name.getText(sourceFile)
  return '<anonymous>'
}

/** Every callable in the file, each measured without the callables nested in it. */
export const callablesOf = ({ sourceFile, file }: { sourceFile: ts.SourceFile; file: string }) => {
  const callables: Callable[] = []
  const lineOf = (position: number) => sourceFile.getLineAndCharacterOfPosition(position).line

  const measure = (callable: ts.FunctionLikeDeclaration) => {
    let complexity = 1
    const lines = new Set<number>()
    const visit = (node: ts.Node) => {
      if (isJSDoc(node)) return
      if (node !== callable && isCallable(node)) {
        measure(node)
        return
      }
      if (isBranch(node)) complexity++
      if (node.getChildCount(sourceFile) === 0 && node.kind !== ts.SyntaxKind.EndOfFileToken)
        lines.add(lineOf(node.getStart(sourceFile)))
      node.getChildren(sourceFile).forEach(visit)
    }
    visit(callable)
    callables.push({
      file,
      name: nameOf(callable, sourceFile),
      line: lineOf(callable.getStart(sourceFile)) + 1,
      complexity,
      sloc: lines.size,
    })
  }

  const find = (node: ts.Node) => {
    if (isCallable(node)) measure(node)
    else ts.forEachChild(node, find)
  }
  find(sourceFile)
  return callables
}

/** Above this, a function counts as complex; the bound Radon uses, as SlopCodeBench does. */
export const COMPLEX = 10

/**
 * SlopCodeBench's structural erosion: the share of complexity mass, CC × √SLOC,
 * that sits in functions above `COMPLEX`. 0 is none, 1 is all of it.
 */
export const erosionOf = (callables: Callable[]) => {
  let total = 0
  let eroded = 0
  for (const { complexity, sloc } of callables) {
    const mass = complexity * Math.sqrt(sloc)
    total += mass
    if (complexity > COMPLEX) eroded += mass
  }
  return total === 0 ? 0 : eroded / total
}

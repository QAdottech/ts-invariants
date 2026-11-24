import { COMPLEX, erosionOf } from './complexity.ts'
import { INVARIANTS, type InvariantName } from './config.ts'
import type { Diagnostic } from './diagnostic.ts'
import type { Model } from './model.ts'

/** Numbers for comparing codebases, or one codebase over time. Test files are left out. */
export type Score = {
  files: number
  lines: number
  functions: number
  /** Functions with cyclomatic complexity above 10. */
  complexFunctions: number
  /** SlopCodeBench's structural erosion, 0 to 1. */
  erosion: number
  findings: Record<InvariantName, number>
  /** Findings for every 1,000 lines. */
  findingsPerKloc: number
}

export const scoreOf = ({
  model,
  diagnostics,
}: {
  model: Model
  diagnostics: Diagnostic[]
}): Score => {
  const files = model.files.filter(({ file }) => !model.isTest(file))
  const callables = model.callables.filter(({ file }) => !model.isTest(file))
  const lines = files.reduce((sum, { lines }) => sum + lines, 0)
  const count = (name: InvariantName) =>
    diagnostics.filter(({ invariant }) => invariant === name).length
  const findings: Record<InvariantName, number> = {
    'module-cycle': count('module-cycle'),
    tangle: count('tangle'),
    'field-leak': count('field-leak'),
    'shallow-module': count('shallow-module'),
    'wide-directory': count('wide-directory'),
    'long-file': count('long-file'),
  }
  return {
    files: files.length,
    lines,
    functions: callables.length,
    complexFunctions: callables.filter(({ complexity }) => complexity > COMPLEX).length,
    erosion: erosionOf(callables),
    findings,
    findingsPerKloc: lines === 0 ? 0 : (diagnostics.length * 1000) / lines,
  }
}

export const formatScore = (score: Score) =>
  [
    `files ${score.files}, lines ${score.lines}, functions ${score.functions}`,
    `erosion ${score.erosion.toFixed(2)}  (share of complexity in the ${score.complexFunctions} functions above ${COMPLEX})`,
    `findings ${score.findingsPerKloc.toFixed(2)} per 1,000 lines`,
    ...INVARIANTS.map((name) => `  ${String(score.findings[name]).padStart(5)}  ${name}`),
  ].join('\n')

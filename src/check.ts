import { buildModel } from './buildModel.ts'
import { findProjects, type Config } from './config.ts'
import type { Diagnostic } from './diagnostic.ts'
import { matcherOf } from './glob.ts'
import { fieldLeak } from './invariants/fieldLeak.ts'
import { layout } from './invariants/layout.ts'
import { moduleCycle } from './invariants/moduleCycle.ts'
import { shallowModule } from './invariants/shallowModule.ts'
import { findTangles, tangle } from './invariants/tangle.ts'
import type { NativeMembers } from './nativeMembers.ts'
import { scoreOf, type Score } from './score.ts'

export type Report = { diagnostics: Diagnostic[]; score: Score }

/** Indexes the projects under `root`; returns every invariant it breaks, sorted, and its score. */
export const check = ({
  root,
  config,
  projects = findProjects({ root, config }),
  nativeMembers,
  log = () => undefined,
}: {
  root: string
  config: Config
  projects?: string[]
  nativeMembers?: NativeMembers
  log?: (message: string) => void
}): Report => {
  const model = buildModel({
    root,
    tsconfigs: projects,
    isExcluded: matcherOf(config.exclude),
    isTest: matcherOf(config.testFiles),
    nativeMembers,
    log,
  })
  const found = findTangles(model)
  const { limits } = config
  const diagnostics = [
    ...moduleCycle(model),
    ...tangle({ model, found, limits }),
    ...fieldLeak({ model, tangles: found.tangles }),
    ...shallowModule({ model, limits }),
    ...layout({ model, limits }),
  ]
    .filter(({ invariant }) => config.invariants[invariant] !== 'off')
    .sort((a, b) => a.invariant.localeCompare(b.invariant) || a.key.localeCompare(b.key))
  return { diagnostics, score: scoreOf({ model, diagnostics }) }
}

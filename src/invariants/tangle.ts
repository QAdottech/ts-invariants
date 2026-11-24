import type { Limits } from '../config.ts'
import { listed, MOST_LISTED, type Diagnostic } from '../diagnostic.ts'
import { moduleOf, siteOf, thingOf, type Model } from '../model.ts'
import { findCircle, stronglyConnected } from '../stronglyConnected.ts'

type Tie = { site: string; uses: string }

/**
 * Things (top-level declarations, a class with its members) that know each
 * other in a circle. Each such circle is one tangle: its members can only be
 * learned together.
 */
export const findTangles = (model: Model) => {
  const ties = new Map<string, Map<string, Tie>>()
  const modulesOfTie = new Map<string, Set<string>>()

  for (const reference of model.references) {
    const from = model.items.get(reference.from)
    const to = model.items.get(reference.to)
    if (
      !from ||
      !to ||
      from.kind === 'module-scope' ||
      model.isTest(from.file) ||
      model.isTest(to.file)
    )
      continue
    const a = thingOf(from)
    const b = thingOf(to)
    if (a === b) continue
    const out = ties.get(a) ?? new Map<string, Tie>()
    ties.set(a, out)
    if (!out.has(b)) out.set(b, { site: siteOf(reference), uses: to.name })
    const modules = modulesOfTie.get(a) ?? new Set<string>()
    modulesOfTie.set(a, modules)
    modules.add(moduleOf(reference.file))
  }

  const next = (thing: string) => ties.get(thing)?.keys() ?? []
  const tangles = stronglyConnected({ nodes: ties.keys(), next }).filter(
    (component) => component.length > 1,
  )
  return { tangles, ties, next, modulesOfTie }
}

/**
 * `tangle`: things that know each other in a circle, written in more than one
 * module, or more of them than a reader holds in mind.
 */
export const tangle = ({
  model,
  found,
  limits,
}: {
  model: Model
  found: ReturnType<typeof findTangles>
  limits: Limits
}): Diagnostic[] =>
  found.tangles.flatMap((component) => {
    const members = new Set(component)
    const modules = new Set(
      component.flatMap((thing) => {
        const item = model.items.get(thing)
        return item ? [moduleOf(item.file), ...(found.modulesOfTie.get(thing) ?? [])] : []
      }),
    )
    if (modules.size < 2 && component.length <= limits.mostInMind) return []

    const nameOf = (thing: string) => model.items.get(thing)?.name ?? thing
    const sorted = [...component].sort()
    const circle = findCircle({
      start: sorted[0] ?? '',
      members,
      next: found.next,
    })
    const steps = circle.map((thing, at) => {
      const nextThing = circle[(at + 1) % circle.length] ?? thing
      const tie = found.ties.get(thing)?.get(nextThing)
      return {
        site: tie?.site ?? thing,
        text: `\`${nameOf(thing)}\` uses \`${tie?.uses ?? nameOf(nextThing)}\``,
      }
    })
    const rest = sorted.filter((thing) => !circle.includes(thing))
    return [
      {
        invariant: 'tangle' as const,
        key: sorted
          .map((thing) => `${model.items.get(thing)?.file ?? ''}#${nameOf(thing)}`)
          .join(' '),
        message: `${component.length} things know each other in a circle, across ${modules.size} module${modules.size === 1 ? '' : 's'}`,
        site: steps[0]?.site ?? '',
        notes: steps.slice(0, MOST_LISTED).map((step) => `${step.site}: ${step.text}`),
        picture: [
          `${circle.map(nameOf).join(' ━▶ ')} ━▶ ${nameOf(circle[0] ?? '')}`,
          ...(rest.length > 0 ? [`also tangled: ${listed(rest.map(nameOf))}`] : []),
          `modules: ${listed([...modules].sort())}`,
        ],
        concerns: [...modules],
      },
    ]
  })

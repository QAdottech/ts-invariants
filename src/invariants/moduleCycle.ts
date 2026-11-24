import { listed, MOST_LISTED, type Diagnostic } from '../diagnostic.ts'
import { isInside, moduleOf, siteOf, type Model } from '../model.ts'
import { findCircle, stronglyConnected } from '../stronglyConnected.ts'

type Tie = { names: Set<string>; site: string }

/**
 * `module-cycle`: sibling modules (files or directories) that use each other
 * in a circle, so there is no order to read them in. A module and the modules
 * inside it make no circle, and neither do packages.
 */
export const moduleCycle = (model: Model): Diagnostic[] => {
  // parent directory -> child -> sibling child -> tie
  const graphs = new Map<string, Map<string, Map<string, Tie>>>()

  for (const reference of model.references) {
    const from = model.items.get(reference.from)
    const to = model.items.get(reference.to)
    if (!from || !to || model.isTest(from.file) || model.isTest(to.file)) continue
    if (model.packageOf(from.file) !== model.packageOf(to.file)) continue
    const a = moduleOf(from.file)
    const b = moduleOf(to.file)
    if (isInside({ outer: a, inner: b }) || isInside({ outer: b, inner: a })) continue

    const aParts = a.split('/')
    const bParts = b.split('/')
    let common = 0
    while (aParts[common] === bParts[common]) common++
    const parent = aParts.slice(0, common).join('/')
    const childA = aParts.slice(0, common + 1).join('/')
    const childB = bParts.slice(0, common + 1).join('/')

    const children = graphs.get(parent) ?? new Map<string, Map<string, Tie>>()
    graphs.set(parent, children)
    const ties = children.get(childA) ?? new Map<string, Tie>()
    children.set(childA, ties)
    const tie = ties.get(childB) ?? {
      names: new Set<string>(),
      site: siteOf(reference),
    }
    ties.set(childB, tie)
    tie.names.add(to.owner ? (model.items.get(to.owner)?.name ?? to.name) : to.name)
  }

  const diagnostics: Diagnostic[] = []
  for (const [parent, children] of graphs) {
    const next = (child: string) => children.get(child)?.keys() ?? []
    for (const component of stronglyConnected({
      nodes: children.keys(),
      next,
    })) {
      if (component.length < 2) continue
      const members = new Set(component)
      const sorted = [...component].sort()
      const circle = findCircle({ start: sorted[0] ?? '', members, next })
      const short = (child: string) => child.slice(parent.length + 1) || child
      const steps = circle.map((child, at) => {
        const nextChild = circle[(at + 1) % circle.length] ?? child
        const tie = children.get(child)?.get(nextChild)
        const names = [...(tie?.names ?? [])]
        return {
          site: tie?.site ?? child,
          text: `\`${short(child)}\` uses \`${short(nextChild)}\` by ${names.length} item${names.length === 1 ? '' : 's'}: ${listed(names)}`,
        }
      })
      diagnostics.push({
        invariant: 'module-cycle',
        key: `${parent} ${sorted.map(short).join(' ')}`,
        message: `${component.length} modules in \`${parent}\` use each other in a circle`,
        site: steps[0]?.site ?? parent,
        notes: steps.map((step) => `${step.site}: ${step.text}`).slice(0, MOST_LISTED),
        picture: [
          `${circle.map(short).join(' ━▶ ')} ━▶ ${short(circle[0] ?? '')}`,
          ...(component.length > circle.length
            ? [
                `also in the circle: ${listed(sorted.filter((child) => !circle.includes(child)).map(short))}`,
              ]
            : []),
        ],
        concerns: sorted,
      })
    }
  }
  return diagnostics
}

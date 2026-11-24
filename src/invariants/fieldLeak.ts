import { listed, MOST_LISTED, type Diagnostic } from '../diagnostic.ts'
import { moduleOf, siteOf, thingOf, type Item, type Model } from '../model.ts'

type Leak = { site: string; module: string; by: string }

/**
 * `field-leak`: code outside a class that works on one of its fields: writes
 * it, or reaches into what it holds (calls a method on it, indexes it, reads
 * a member of it), directly or through a getter that hands the field out.
 * Reading a field's value is no leak. A class guards its fields when one of
 * its own instance methods uses them and it keeps at least one to itself.
 * Insiders are the class, its subclasses, and the things in its tangle.
 */
export const fieldLeak = ({
  model,
  tangles,
}: {
  model: Model
  tangles: string[][]
}): Diagnostic[] => {
  const tangleOf = new Map<string, string[]>()
  for (const component of tangles) for (const thing of component) tangleOf.set(thing, component)

  const fieldsOf = new Map<string, Item[]>()
  const subclassesOf = new Map<string, string[]>()
  for (const item of model.items.values()) {
    if (item.kind === 'field' && item.owner && !item.isStatic) {
      const fields = fieldsOf.get(item.owner) ?? []
      fieldsOf.set(item.owner, fields)
      fields.push(item)
    }
    if (item.kind === 'class' && item.extends) {
      const subclasses = subclassesOf.get(item.extends) ?? []
      subclassesOf.set(item.extends, subclasses)
      subclasses.push(item.id)
    }
  }

  const insidersCache = new Map<string, Set<string>>()
  const insidersOf = (owner: string) => {
    const cached = insidersCache.get(owner)
    if (cached) return cached
    const insiders = new Set<string>([owner, ...(tangleOf.get(owner) ?? [])])
    insidersCache.set(owner, insiders)
    const pending = [owner]
    for (let at = pending.pop(); at !== undefined; at = pending.pop())
      for (const subclass of subclassesOf.get(at) ?? [])
        if (!insiders.has(subclass)) {
          insiders.add(subclass)
          pending.push(subclass)
        }
    return insiders
  }

  const leaksOf = new Map<string, Leak[]>()
  const usedByOwnMethods = new Set<string>()
  for (const reference of model.references) {
    const target = model.items.get(reference.to)
    const field =
      target?.kind === 'field'
        ? target
        : target?.forwardsField
          ? model.items.get(target.forwardsField)
          : undefined
    if (!field?.owner) continue
    const from = model.items.get(reference.from)
    if (!from) continue
    if (
      from.owner === field.owner &&
      (from.kind === 'method' || from.kind === 'accessor') &&
      !from.isStatic
    )
      usedByOwnMethods.add(field.owner)
    if (reference.access === 'read' || model.isTest(reference.file)) continue
    if (insidersOf(field.owner).has(thingOf(from))) continue
    const leaks = leaksOf.get(field.id) ?? []
    leaksOf.set(field.id, leaks)
    leaks.push({
      site: siteOf(reference),
      module: moduleOf(reference.file),
      by: from.name,
    })
  }

  const diagnostics: Diagnostic[] = []
  for (const [owner, fields] of fieldsOf) {
    const ownerItem = model.items.get(owner)
    if (!ownerItem || model.isTest(ownerItem.file) || !usedByOwnMethods.has(owner)) continue
    const known = fields.filter((field) => leaksOf.has(field.id))
    const kept = fields.filter((field) => !leaksOf.has(field.id))
    if (known.length === 0 || kept.length === 0) continue

    for (const field of known) {
      const leaks = leaksOf.get(field.id) ?? []
      const byModule = new Map<string, number>()
      for (const leak of leaks) byModule.set(leak.module, (byModule.get(leak.module) ?? 0) + 1)
      const modules = [...byModule].sort((a, b) => b[1] - a[1])
      const shortName = (item: Item) => item.name.slice(ownerItem.name.length + 1)
      diagnostics.push({
        invariant: 'field-leak',
        key: `${field.file}#${field.name}`,
        message: `\`${field.name}\` is known outside \`${ownerItem.name}\`: ${leaks.length} place${leaks.length === 1 ? '' : 's'} in ${modules.length} module${modules.length === 1 ? '' : 's'}`,
        site: leaks[0]?.site ?? siteOf(field),
        notes: leaks.slice(0, MOST_LISTED).map((leak) => `${leak.site}: \`${leak.by}\``),
        picture: [
          `${ownerItem.name}  (${siteOf(ownerItem)})`,
          ...modules
            .slice(0, MOST_LISTED)
            .map(
              ([module, count], at) =>
                `  ${at === 0 ? `${shortName(field)} ◀━┳━` : `${' '.repeat(shortName(field).length)}    ┗━`} ${count}  ${module}`,
            ),
          ...(known.length > 1
            ? [
                `  also known outside: ${listed(known.filter((other) => other !== field).map(shortName))}`,
              ]
            : []),
          `  kept: ${listed(kept.map(shortName))}`,
        ],
        concerns: [field.file, ...modules.map(([module]) => module)],
      })
    }
  }
  return diagnostics
}

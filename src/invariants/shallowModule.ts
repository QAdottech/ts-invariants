import path from 'node:path'

import type { Limits } from '../config.ts'
import { listed, MOST_LISTED, type Diagnostic } from '../diagnostic.ts'
import { isInside, type Item, type Model } from '../model.ts'

const isTypeLike = (item: Item) =>
  item.kind === 'class' || item.kind === 'type' || item.kind === 'enum'

/** The deepest directory holding every one of `files`. */
const commonDirectory = (files: Iterable<string>) => {
  let common: string[] | undefined
  for (const file of files) {
    const parts = path.dirname(file).split('/')
    if (!common) {
      common = parts
      continue
    }
    let length = 0
    while (length < common.length && common[length] === parts[length]) length++
    common = common.slice(0, length)
  }
  return common?.join('/')
}

const directoriesAbove = ({ file, packageRoot }: { file: string; packageRoot: string }) => {
  const directories: string[] = []
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    directories.push(directory)
    if (
      directory === packageRoot ||
      directory === '.' ||
      !isInside({ outer: packageRoot, inner: directory })
    )
      break
  }
  return directories
}

/**
 * `shallow-module`: a directory that shows more functions than a reader holds
 * in mind, at least as many as it hides, and a list that long: more things, or
 * more functions of one thing. A thing's functions are its methods and the
 * free functions that use it; a free function that uses none of the
 * directory's types is a thing of its own. Wrappers don't count, but the
 * function a wrapper passes calls to is shown when the wrapper is.
 */
export const shallowModule = ({
  model,
  limits,
}: {
  model: Model
  limits: Limits
}): Diagnostic[] => {
  const usersOf = new Map<string, Map<string, number>>()
  const typesKnownBy = new Map<string, Set<string>>()

  const finalTarget = (item: Item) => {
    let target = item
    for (let depth = 0; target.wraps && depth < 10; depth++)
      target = model.items.get(target.wraps) ?? target
    return target
  }

  for (const reference of model.references) {
    const from = model.items.get(reference.from)
    const to = model.items.get(reference.to)
    if (!from || !to) continue
    if (from.isFunction && isTypeLike(to)) {
      const known = typesKnownBy.get(from.id) ?? new Set<string>()
      typesKnownBy.set(from.id, known)
      known.add(to.id)
    }
    if (!to.isFunction || model.isTest(reference.file)) continue
    const target = finalTarget(to)
    const users = usersOf.get(target.id) ?? new Map<string, number>()
    usersOf.set(target.id, users)
    users.set(reference.file, (users.get(reference.file) ?? 0) + 1)
  }

  type Shown = { item: Item; users: Map<string, number> }
  const shownIn = new Map<string, Shown[]>()
  const hiddenIn = new Map<string, number>()

  for (const item of model.items.values()) {
    if (
      !item.isFunction ||
      item.wraps ||
      model.isTest(item.file) ||
      item.name.endsWith('.constructor')
    )
      continue
    const users = usersOf.get(item.id) ?? new Map<string, number>()
    const usersCommon = users.size > 0 ? commonDirectory(users.keys()) : undefined
    for (const directory of directoriesAbove({
      file: item.file,
      packageRoot: model.packageOf(item.file),
    })) {
      const allInside =
        usersCommon === undefined || isInside({ outer: directory, inner: usersCommon })
      if (allInside) hiddenIn.set(directory, (hiddenIn.get(directory) ?? 0) + 1)
      else {
        const shown = shownIn.get(directory) ?? []
        shownIn.set(directory, shown)
        shown.push({ item, users })
      }
    }
  }

  // `packages/x` holding only `src/` is the same module as `packages/x/src`.
  const childrenOf = new Map<string, Set<string>>()
  for (const item of model.items.values()) {
    if (!item.isFunction) continue
    for (let child = item.file; child !== '.'; child = path.dirname(child)) {
      const parent = path.dirname(child)
      const children = childrenOf.get(parent) ?? new Set<string>()
      childrenOf.set(parent, children)
      children.add(child)
    }
  }
  const isPassThrough = (directory: string) => {
    const children = [...(childrenOf.get(directory) ?? [])]
    return children.length === 1 && childrenOf.has(children[0] ?? '')
  }

  const diagnostics: Diagnostic[] = []
  for (const [directory, shown] of shownIn) {
    if (model.isTest(`${directory}/x.ts`) || isPassThrough(directory)) continue
    const hidden = hiddenIn.get(directory) ?? 0
    if (shown.length <= limits.mostInMind || shown.length < hidden) continue

    const nameOf = (id: string) => model.items.get(id)?.name ?? id
    const functionsOf = new Map<string, string[]>()
    for (const { item } of shown) {
      const things = item.owner
        ? [item.owner]
        : [...(typesKnownBy.get(item.id) ?? [])].filter((type) => {
            const typeItem = model.items.get(type)
            return typeItem !== undefined && isInside({ outer: directory, inner: typeItem.file })
          })
      for (const thing of things.length > 0 ? things : [item.id]) {
        const functions = functionsOf.get(thing) ?? []
        functionsOf.set(thing, functions)
        functions.push(item.owner ? item.name.slice(nameOf(item.owner).length + 1) : item.name)
      }
    }
    const things = [...functionsOf].sort((a, b) => b[1].length - a[1].length)
    const wideThings = things.filter(([, functions]) => functions.length > limits.mostInMind)
    if (things.length <= limits.mostInMind && wideThings.length === 0) continue

    const outsideUsers = new Map<string, number>()
    for (const { users } of shown)
      for (const [file, count] of users)
        if (!isInside({ outer: directory, inner: file })) {
          const user = path.dirname(file)
          outsideUsers.set(user, (outsideUsers.get(user) ?? 0) + count)
        }
    const topUsers = [...outsideUsers].sort((a, b) => b[1] - a[1])

    diagnostics.push({
      invariant: 'shallow-module',
      key: directory,
      message: `\`${directory}\` shows ${shown.length} functions and hides ${hidden}`,
      site: `${directory}/`,
      notes: [
        ...(things.length > limits.mostInMind
          ? [`shows ${things.length} things: ${listed(things.map(([thing]) => nameOf(thing)))}`]
          : []),
        ...wideThings
          .slice(0, MOST_LISTED)
          .map(
            ([thing, functions]) =>
              `\`${nameOf(thing)}\` shows ${functions.length} functions: ${listed(functions)}`,
          ),
      ],
      picture: [
        `used from ${outsideUsers.size} director${outsideUsers.size === 1 ? 'y' : 'ies'} outside, most:`,
        ...topUsers.slice(0, 5).map(([user, count]) => `  ${String(count).padStart(4)}  ${user}`),
      ],
      concerns: [directory],
    })
  }
  return diagnostics
}

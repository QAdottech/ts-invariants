/** Tarjan's strongly connected components, iterative so deep graphs don't overflow the stack. */
export const stronglyConnected = ({
  nodes,
  next,
}: {
  nodes: Iterable<string>
  next: (node: string) => Iterable<string>
}): string[][] => {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let counter = 0

  for (const root of nodes) {
    if (index.has(root)) continue
    const work: { node: string; successors: Iterator<string> }[] = []
    const open = (node: string) => {
      index.set(node, counter)
      low.set(node, counter)
      counter++
      stack.push(node)
      onStack.add(node)
      work.push({ node, successors: next(node)[Symbol.iterator]() })
    }
    open(root)

    while (work.length > 0) {
      const top = work[work.length - 1]
      if (!top) break
      const step = top.successors.next()
      if (!step.done) {
        const successor = step.value
        if (!index.has(successor)) open(successor)
        else if (onStack.has(successor))
          low.set(top.node, Math.min(low.get(top.node) ?? 0, index.get(successor) ?? 0))
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(top.node) ?? 0))
      if (low.get(top.node) !== index.get(top.node)) continue
      const component: string[] = []
      for (;;) {
        const member = stack.pop()
        if (member === undefined) break
        onStack.delete(member)
        component.push(member)
        if (member === top.node) break
      }
      components.push(component)
    }
  }
  return components
}

/** A shortest circle through `start` that stays inside `members`. */
export const findCircle = ({
  start,
  members,
  next,
}: {
  start: string
  members: Set<string>
  next: (node: string) => Iterable<string>
}): string[] => {
  const parents = new Map<string, string>()
  const queue = [start]
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]
    if (node === undefined) break
    for (const successor of next(node)) {
      if (!members.has(successor)) continue
      if (successor === start) {
        const circle = [node]
        for (let at = parents.get(node); at !== undefined; at = parents.get(at)) circle.unshift(at)
        return circle
      }
      if (parents.has(successor)) continue
      parents.set(successor, node)
      queue.push(successor)
    }
  }
  return [start]
}

import type { RunQueue, Task } from '../queue/RunQueue'

export const admit = (queue: RunQueue, task: Task) => {
  if (!queue.full()) queue.items.push(task)
}

export const next = (queue: RunQueue) => queue.items[queue.head++]

export const capacity = (queue: RunQueue) => queue.limit

// Reading values out of a field, however deep, is no leak.
export const retries = (queue: RunQueue) => queue.options.retries

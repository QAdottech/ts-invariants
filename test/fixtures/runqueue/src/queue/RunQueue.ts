export type Task = { id: string }

export class RunQueue {
  items: Task[] = []
  head = 0
  limit = 10

  full() {
    return this.items.length - this.head >= this.limit
  }
}

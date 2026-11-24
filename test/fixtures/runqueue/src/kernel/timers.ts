import type { Tasks } from '.'

export class Timers {
  armed: Tasks[] = []

  arm(tasks: Tasks) {
    this.armed.push(tasks)
  }
}

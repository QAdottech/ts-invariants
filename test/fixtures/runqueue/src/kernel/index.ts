import { Timers } from './timers'

export class Tasks {
  timers = new Timers()
  count = 0

  spawn() {
    this.count++
    this.timers.arm(this)
  }
}

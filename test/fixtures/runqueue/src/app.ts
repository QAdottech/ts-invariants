import { read1, read2, read3, read4, read5, read6, read7, read8, read9 } from './store'

export const app = () =>
  [read1, read2, read3, read4, read5, read6, read7, read8, read9].map((read) => read('k'))

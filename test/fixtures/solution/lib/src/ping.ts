import { pong } from './pong'

export const ping = (n: number): number => (n > 0 ? pong(n - 1) : 0)

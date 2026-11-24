import { ping } from './ping'

export const pong = (n: number): number => (n > 0 ? ping(n - 1) : 1)

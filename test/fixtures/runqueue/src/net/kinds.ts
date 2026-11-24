import { BACKLOG_MOST } from './socket'

export type Kind = 'tcp' | 'udp'

export const backlogFor = (kind: Kind) => (kind === 'tcp' ? BACKLOG_MOST : 0)

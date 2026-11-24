import { backlogFor, type Kind } from './kinds'

export const BACKLOG_MOST = 128

export const listen = (kind: Kind) => backlogFor(kind)

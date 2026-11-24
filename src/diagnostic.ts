import type { InvariantName } from './config.ts'

export type Diagnostic = {
  invariant: InvariantName
  /** Stable across runs, so an allow file can name it. */
  key: string
  message: string
  site: string
  notes: string[]
  picture: string[]
  /** Paths the report is about, for scoping a run to part of the repo. */
  concerns: string[]
}

/** How many names a note or picture lists before it summarises the rest. */
export const MOST_LISTED = 7

export const formatDiagnostic = (diagnostic: Diagnostic) =>
  [
    `error[${diagnostic.invariant}]: ${diagnostic.message}`,
    `  --> ${diagnostic.site}`,
    ...diagnostic.notes.map((note) => `  = note: ${note}`),
    ...diagnostic.picture.map((line) => `    ${line}`),
  ].join('\n')

export const listed = (names: string[]) =>
  names.length > MOST_LISTED
    ? `${names.slice(0, MOST_LISTED).join(', ')}, … ${names.length - MOST_LISTED} more`
    : names.join(', ')

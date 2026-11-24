import path from 'node:path'

export type ItemKind =
  | 'module-scope'
  | 'function'
  | 'variable'
  | 'class'
  | 'type'
  | 'enum'
  | 'method'
  | 'accessor'
  | 'field'

/** A declaration other code can know: a top-level one, or a member of a class. */
export type Item = {
  id: string
  name: string
  kind: ItemKind
  file: string
  line: number
  /** The class a member belongs to. */
  owner?: string
  isStatic: boolean
  isPrivate: boolean
  /** Has a body of its own: a function, method or accessor. */
  isFunction: boolean
  /** The class it extends, when that class is indexed. */
  extends?: string
  /** The function it only passes the call on to. */
  wraps?: string
  /** The field an accessor only hands out. */
  forwardsField?: string
}

/**
 * `read` takes a value; `reach` works on what a field holds (a method call,
 * an index, a member of it); `write` replaces it.
 */
export type Access = 'read' | 'reach' | 'write'

export type Reference = {
  from: string
  to: string
  file: string
  line: number
  column: number
  access: Access
}

export type SourceFile = { file: string; lines: number }

/** Everything the invariants read: what is declared, and what knows what. Paths are relative to `root`. */
export type Model = {
  root: string
  items: Map<string, Item>
  references: Reference[]
  files: SourceFile[]
  /** The directory of the nearest `package.json`, `.` for the root. */
  packageOf: (file: string) => string
  isTest: (file: string) => boolean
}

/** A file is its own module, except `dir/index.ts`, which is the module `dir`. */
export const moduleOf = (file: string) =>
  /(^|\/)index\.[mc]?tsx?$/.test(file) ? path.dirname(file) : file

export const isInside = ({ outer, inner }: { outer: string; inner: string }) =>
  outer === '.' || outer === '' || inner === outer || inner.startsWith(`${outer}/`)

export const thingOf = (item: Item) => item.owner ?? item.id

export const siteOf = ({ file, line, column }: { file: string; line: number; column?: number }) =>
  `${file}:${line}:${column ?? 1}`

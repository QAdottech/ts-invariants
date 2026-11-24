import fs from 'node:fs'
import path from 'node:path'

import { expandGlob, matcherOf } from './glob.ts'

export const INVARIANTS = [
  'module-cycle',
  'tangle',
  'field-leak',
  'shallow-module',
  'wide-directory',
  'long-file',
] as const

export type InvariantName = (typeof INVARIANTS)[number]

export type Limits = {
  /** What a reader holds in mind at once (Miller, 1956). */
  mostInMind: number
  /** Past this many names, a directory listing is searched rather than read. */
  mostInDirectory: number
  /** Past this many lines, a file holds parts that want files of their own. */
  mostLines: number
}

export type Config = {
  /** tsconfig files to index; found from the workspace when left out. */
  projects?: string[]
  /** Files that are neither indexed nor checked. */
  exclude: string[]
  /** Files that are indexed for layout but neither checked nor counted as users. */
  testFiles: string[]
  limits: Limits
  invariants: Partial<Record<InvariantName, 'error' | 'off'>>
}

export const CONFIG_FILE = 'ts-invariants.config.json'

export const defaultConfig: Config = {
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/generated/**',
    '**/*.generated.*',
    '**/*.gen.*',
    '**/*.d.ts',
    '**/*.d.mts',
    '**/*.d.cts',
  ],
  testFiles: [
    '**/*.test.*',
    '**/*.spec.*',
    '**/*.stories.*',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/e2e/**',
  ],
  limits: { mostInMind: 7, mostInDirectory: 15, mostLines: 2000 },
  invariants: {},
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

export class ConfigError extends Error {}

/** `ts-invariants.config.json`, merged over the defaults; lists in it extend the default lists. */
export const loadConfig = ({ root, file }: { root: string; file?: string }): Config => {
  const configPath = path.resolve(root, file ?? CONFIG_FILE)
  if (!fs.existsSync(configPath)) {
    if (file) throw new ConfigError(`no config file at ${configPath}`)
    return defaultConfig
  }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new ConfigError(`${configPath} is not valid JSON: ${String(error)}`)
  }
  if (typeof raw !== 'object' || raw === null)
    throw new ConfigError(`${configPath} must hold an object`)
  const given: Record<string, unknown> = { ...raw }

  for (const key of ['projects', 'exclude', 'testFiles'] as const)
    if (given[key] !== undefined && !isStringArray(given[key]))
      throw new ConfigError(`${configPath}: "${key}" must be a list of strings`)

  const limits: Record<string, unknown> =
    typeof given.limits === 'object' && given.limits !== null ? { ...given.limits } : {}
  const invariants: Record<string, unknown> =
    typeof given.invariants === 'object' && given.invariants !== null ? { ...given.invariants } : {}
  for (const [name, level] of Object.entries(invariants))
    if (!INVARIANTS.some((known) => known === name) || (level !== 'error' && level !== 'off'))
      throw new ConfigError(
        `${configPath}: "invariants.${name}" must name an invariant and be "error" or "off"`,
      )

  const limit = (key: keyof Limits) => {
    const value = limits[key]
    if (value === undefined) return defaultConfig.limits[key]
    if (typeof value !== 'number' || value < 1)
      throw new ConfigError(`${configPath}: "limits.${key}" must be a positive number`)
    return value
  }

  return {
    projects: isStringArray(given.projects) ? given.projects : undefined,
    exclude: [...defaultConfig.exclude, ...(isStringArray(given.exclude) ? given.exclude : [])],
    testFiles: [
      ...defaultConfig.testFiles,
      ...(isStringArray(given.testFiles) ? given.testFiles : []),
    ],
    limits: {
      mostInMind: limit('mostInMind'),
      mostInDirectory: limit('mostInDirectory'),
      mostLines: limit('mostLines'),
    },
    invariants: Object.fromEntries(
      INVARIANTS.flatMap((name) => {
        const level = invariants[name]
        return level === 'error' || level === 'off' ? [[name, level]] : []
      }),
    ),
  }
}

/**
 * Every `tsconfig.json` under `root`, shallowest first, outside `node_modules`,
 * hidden directories and excluded or test paths; or the config's `projects`.
 * Walking finds what workspace globs miss: solution-style configs, and code
 * kept under nested tsconfigs (`src/node/tsconfig.json`).
 */
export const findProjects = ({ root, config }: { root: string; config: Config }) => {
  if (config.projects)
    return config.projects
      .flatMap((glob) => expandGlob({ root, glob }))
      .map((project) => path.join(root, project))

  const isSkipped = (
    (excluded, test) => (directory: string) =>
      excluded(`${directory}/x.ts`) || test(`${directory}/x.ts`)
  )(matcherOf(config.exclude), matcherOf(config.testFiles))
  const found: string[] = []
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = directory === '' ? entry.name : `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || isSkipped(relative))
          continue
        walk(relative)
      } else if (entry.name === 'tsconfig.json') found.push(relative)
    }
  }
  walk('')
  return found
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .map((project) => path.join(root, project))
}

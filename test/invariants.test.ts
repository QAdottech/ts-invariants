import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { check } from '../src/check.ts'
import { defaultConfig } from '../src/config.ts'
import type { Diagnostic } from '../src/diagnostic.ts'
import { loadNativeMembers, type NativeMembers } from '../src/nativeMembers.ts'

const root = path.join(import.meta.dirname, 'fixtures/runqueue')
const projects = [path.join(root, 'tsconfig.json')]
const keysOf = (diagnostics: Diagnostic[], invariant: Diagnostic['invariant']) =>
  diagnostics.filter((diagnostic) => diagnostic.invariant === invariant).map(({ key }) => key)

let native: NativeMembers | undefined
beforeAll(async () => {
  native = await loadNativeMembers()
})

describe.each([
  ['TypeScript 7 members', true],
  ['TypeScript 6 fallback', false],
])('the runqueue fixture, with %s', (_name, useNative) => {
  let diagnostics: Diagnostic[]
  beforeAll(() => {
    if (useNative) expect(native).toBeDefined()
    diagnostics = check({
      root,
      config: defaultConfig,
      projects,
      nativeMembers: useNative ? native : undefined,
    }).diagnostics
  }, 120_000)

  it('flags fields that outsiders write or reach into, and keeps fields they only read', () => {
    expect(keysOf(diagnostics, 'field-leak')).toEqual([
      'src/queue/RunQueue.ts#RunQueue.head',
      'src/queue/RunQueue.ts#RunQueue.items',
    ])
    const items = diagnostics.find(({ key }) => key === 'src/queue/RunQueue.ts#RunQueue.items')
    expect(items?.picture.at(-1)).toBe('  kept: limit, options')
  })

  it('flags sibling modules that use each other, not a module and its child', () => {
    expect(keysOf(diagnostics, 'module-cycle')).toEqual(['src/net kinds.ts socket.ts'])
  })

  it('flags a parent and child that know each other as a tangle', () => {
    expect(keysOf(diagnostics, 'tangle')).toEqual([
      'src/kernel/index.ts#Tasks src/kernel/timers.ts#Timers',
    ])
  })

  it('flags a directory that shows more than it hides', () => {
    expect(keysOf(diagnostics, 'shallow-module')).toEqual(['src/store'])
    expect(diagnostics.find(({ invariant }) => invariant === 'shallow-module')?.message).toBe(
      '`src/store` shows 9 functions and hides 1',
    )
  })
})

describe('configuration', () => {
  it('turns an invariant off', () => {
    const diagnostics = check({
      root,
      config: { ...defaultConfig, invariants: { 'field-leak': 'off' } },
      projects,
    }).diagnostics
    expect(keysOf(diagnostics, 'field-leak')).toEqual([])
    expect(keysOf(diagnostics, 'module-cycle')).not.toEqual([])
  })

  it('reads limits', () => {
    const diagnostics = check({
      root,
      config: {
        ...defaultConfig,
        limits: { ...defaultConfig.limits, mostInMind: 9, mostLines: 10 },
      },
      projects,
    }).diagnostics
    expect(keysOf(diagnostics, 'shallow-module')).toEqual([])
    expect(keysOf(diagnostics, 'long-file')).toContain('src/store/index.ts')
  })
})

describe('a solution-style tsconfig', () => {
  it('indexes the projects it references', () => {
    const solution = path.join(import.meta.dirname, 'fixtures/solution')
    const { diagnostics } = check({
      root: solution,
      config: defaultConfig,
      projects: [path.join(solution, 'tsconfig.json')],
    })
    expect(keysOf(diagnostics, 'module-cycle')).toEqual(['lib/src ping.ts pong.ts'])
  })
})

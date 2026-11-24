import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'

import { changedFiles } from '../src/changedFiles.ts'
import { callablesOf, erosionOf, type Callable } from '../src/complexity.ts'

const measure = (text: string) =>
  callablesOf({
    sourceFile: ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true),
    file: 'a.ts',
  })

describe('callablesOf', () => {
  it('counts one plus each branch, and measures nested functions on their own', () => {
    const callables = measure(`
/** Docs are not code. */
export function route(kind: string, items: number[]) {
  if (kind === 'a' && items.length > 0) return 1 // if, &&
  for (const item of items) console.log(item) // for-of
  const label = kind ? 'k' : 'none' // ?:
  switch (kind) {
    case 'b': // case
      return 2
    case 'c': // case
      return 3
    default:
      break
  }
  try {
    items.map((item) => item ?? 0) // nested: measured separately
  } catch {
    // catch
  }
  return label
}
`)
    const outer = callables.find(({ name }) => name === 'route')
    const inner = callables.find(({ name }) => name === '<anonymous>')
    expect(outer).toMatchObject({ name: 'route', line: 3, complexity: 8 })
    expect(inner).toMatchObject({ name: '<anonymous>', complexity: 2, sloc: 1 })
    expect(outer?.sloc).toBe(18) // 19 lines, one of them only a comment
  })

  it('names arrow functions after what they are assigned to', () => {
    expect(measure('const add = (a: number, b: number) => a + b').map(({ name }) => name)).toEqual([
      'add',
    ])
  })
})

describe('erosionOf', () => {
  const callable = (complexity: number, sloc: number): Callable => ({
    file: 'a.ts',
    name: 'f',
    line: 1,
    complexity,
    sloc,
  })

  it('is the share of complexity × √lines in functions above 10', () => {
    // masses: 11 × 2 = 22 (complex) and 2 × 3 = 6
    expect(erosionOf([callable(11, 4), callable(2, 9)])).toBeCloseTo(22 / 28)
    expect(erosionOf([callable(10, 100)])).toBe(0)
    expect(erosionOf([])).toBe(0)
  })
})

describe('changedFiles', () => {
  it('lists committed, uncommitted and untracked changes since a ref', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-invariants-git-'))
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root })
    const write = (file: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), file)
    }
    try {
      git('init', '-q', '-b', 'main')
      write('src/kept.ts')
      write('src/edited.ts')
      git('add', '.')
      git('commit', '-qm', 'base')
      git('checkout', '-qb', 'feature')
      write('src/committed.ts')
      git('add', '.')
      git('commit', '-qm', 'feature')
      fs.appendFileSync(path.join(root, 'src/edited.ts'), '\n')
      write('src/untracked.ts')

      expect([...changedFiles({ root, ref: 'main' })].sort()).toEqual([
        'src/committed.ts',
        'src/edited.ts',
        'src/untracked.ts',
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

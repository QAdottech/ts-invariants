import fs from 'node:fs'
import path from 'node:path'

const escape = (text: string) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&')

/** `**` matches any number of directories, `*` and `?` stay inside one. */
export const globToRegExp = (glob: string) => {
  let pattern = ''
  for (let at = 0; at < glob.length; at++) {
    const char = glob[at] ?? ''
    if (char === '*' && glob[at + 1] === '*') {
      const slash = glob[at + 2] === '/'
      pattern += slash ? '(?:.*/)?' : '.*'
      at += slash ? 2 : 1
    } else if (char === '*') pattern += '[^/]*'
    else if (char === '?') pattern += '[^/]'
    else pattern += escape(char)
  }
  return new RegExp(`^${pattern}$`)
}

export const matcherOf = (globs: string[]) => {
  const patterns = globs.map(globToRegExp)
  return (file: string) => patterns.some((pattern) => pattern.test(file))
}

/** The paths under `root` a workspace-style glob (`packages/*`, `apps/*\/tsconfig.json`) names. */
export const expandGlob = ({ root, glob }: { root: string; glob: string }): string[] => {
  let found = ['']
  for (const segment of glob.split('/').filter((part) => part !== '' && part !== '.')) {
    if (!/[*?]/.test(segment)) {
      found = found.map((base) => path.join(base, segment))
      continue
    }
    const pattern = globToRegExp(segment)
    found = found.flatMap((base) => {
      const directory = path.join(root, base)
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return []
      return fs
        .readdirSync(directory)
        .filter((name) => pattern.test(name) && name !== 'node_modules')
        .map((name) => path.join(base, name))
    })
  }
  return found.filter((candidate) => candidate !== '' && fs.existsSync(path.join(root, candidate)))
}

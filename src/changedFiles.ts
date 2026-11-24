import { execFileSync } from 'node:child_process'
import path from 'node:path'

const git = ({ root, args }: { root: string; args: string[] }) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n')
    .filter((line) => line !== '')

/**
 * Files changed since `ref` (from where the branch left it), plus uncommitted
 * and untracked ones, relative to `root`.
 */
export const changedFiles = ({ root, ref }: { root: string; ref: string }) => {
  const top = git({ root, args: ['rev-parse', '--show-toplevel'] })[0] ?? root
  const fromTop = [
    ...git({ root, args: ['diff', '--name-only', `${ref}...HEAD`] }),
    ...git({ root, args: ['diff', '--name-only', 'HEAD'] }),
    ...git({ root, args: ['ls-files', '--others', '--exclude-standard', '--full-name'] }),
  ]
  return new Set(fromTop.map((file) => path.relative(root, path.join(top, file))))
}

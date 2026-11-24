import path from 'node:path'

import { listed, type Diagnostic } from '../diagnostic.ts'
import type { Limits } from '../config.ts'
import type { Model } from '../model.ts'

/** `wide-directory` and `long-file`: how the code is laid out in files. */
export const layout = ({ model, limits }: { model: Model; limits: Limits }): Diagnostic[] => {
  const membersOf = new Map<string, Set<string>>()
  for (const { file } of model.files)
    for (
      let child = file, directory = path.dirname(file);
      child !== '.';
      child = directory, directory = path.dirname(directory)
    ) {
      const members = membersOf.get(directory) ?? new Set<string>()
      membersOf.set(directory, members)
      members.add(path.basename(child))
      if (directory === '.') break
    }

  const wide = [...membersOf]
    .filter(([directory, members]) => directory !== '.' && members.size > limits.mostInDirectory)
    .map(([directory, members]): Diagnostic => {
      const names = [...members].sort()
      return {
        invariant: 'wide-directory',
        key: directory,
        message: `\`${directory}\` holds ${members.size} files and directories, more than ${limits.mostInDirectory}`,
        site: `${directory}/`,
        notes: [],
        picture: [listed(names)],
        concerns: [directory],
      }
    })

  const long = model.files
    .filter(({ lines }) => lines > limits.mostLines)
    .map(({ file, lines }): Diagnostic => ({
      invariant: 'long-file',
      key: file,
      message: `\`${file}\` has ${lines} lines, more than ${limits.mostLines}`,
      site: `${file}:1:1`,
      notes: [],
      picture: [],
      concerns: [file],
    }))

  return [...wide, ...long]
}

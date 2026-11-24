import path from 'node:path'

type NativeApi = typeof import('typescript/unstable/sync')

export type MemberLookup = { from: string; position: number }

/**
 * Resolves `x.member` names with the TypeScript 7 native checker, in one
 * batch per file. Each result is the `file:end` of the declaration, which
 * matches the declaration's end offset in the TS 6 tree.
 */
export type NativeMembers = (input: {
  root: string
  tsconfig: string
  byFile: Map<string, MemberLookup[]>
  isWanted: (file: string) => boolean
}) => Map<string, (string | undefined)[]>

/** `undefined` when the installed `typescript` has no native API (before 7). */
export const loadNativeMembers = async (): Promise<NativeMembers | undefined> => {
  let api: NativeApi
  try {
    api = await import('typescript/unstable/sync')
  } catch {
    return undefined
  }
  return ({ root, tsconfig, byFile, isWanted }) => {
    const results = new Map<string, (string | undefined)[]>()
    // A fresh server per project: closed projects and old snapshots keep their memory.
    const server = new api.API({ cwd: root })
    try {
      const project = server.updateSnapshot({ openProjects: [tsconfig] }).getProject(tsconfig)
      if (!project) return results
      for (const [fileName, lookups] of byFile) {
        const symbols = project.checker.getSymbolAtPosition(
          fileName,
          lookups.map(({ position }) => position),
        )
        results.set(
          fileName,
          symbols.map((symbol) => {
            for (const declaration of symbol?.declarations ?? []) {
              const file = path.relative(root, declaration.path)
              if (!isWanted(file)) continue
              const end = declaration.resolve(project)?.end
              if (end !== undefined) return `${file}:${end}`
            }
            return undefined
          }),
        )
      }
      return results
    } finally {
      server.close()
    }
  }
}

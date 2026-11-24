export { check } from './check.ts'
export {
  CONFIG_FILE,
  ConfigError,
  defaultConfig,
  findProjects,
  INVARIANTS,
  loadConfig,
} from './config.ts'
export type { Config, InvariantName, Limits } from './config.ts'
export { formatDiagnostic } from './diagnostic.ts'
export type { Diagnostic } from './diagnostic.ts'
export { loadNativeMembers } from './nativeMembers.ts'

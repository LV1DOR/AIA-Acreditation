// Node ESM bundles include CommonJS dependencies that load Node built-ins.
// Supply the native require implementation without changing module format.
export const workerRuntimeBanner = 'import { createRequire as __aiaWorkerCreateRequire } from "node:module"; const require = __aiaWorkerCreateRequire(import.meta.url);';

/**
 * Isolated in its own module - with no `process.env` access anywhere in it - so that the browser
 * half of `@isikk/core/next/config` can throw the same error type without importing
 * anything that reads the environment. Keeping the split structural means the guarantee holds
 * because of what the file contains, not because a bundler happened to tree-shake it away.
 */
export class ConfigError extends Error {}

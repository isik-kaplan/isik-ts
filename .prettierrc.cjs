module.exports = {
  printWidth: 120,
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  plugins: ['@trivago/prettier-plugin-sort-imports'],
  // Import order groups, matched top to bottom. Anything not matched by an earlier
  // pattern falls into the generic "^[a-zA-Z]" bucket (sorted alphabetically) - so
  // next, lodash, date-fns, zod, etc. are already ordered correctly without needing
  // their own line below. Uncomment/add an entry above the generic bucket only if a
  // package needs its own dedicated group (e.g. always sorted before/after the rest).
  importOrder: [
    '^react(?:/.*)?$',
    // '^next(?:/.*)?$',
    // '^lodash(?:/.*)?$',
    // '^date-fns(?:/.*)?$',
    // '^zod$',
    // '^es-toolkit(?:/.*)?$',
    '^[a-zA-Z]',
    '^[./]',
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
}

import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'

import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
})

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', 'fixtures'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  ...compat.extends('standard'),
  eslintPluginPrettierRecommended,
  {
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'newline-per-chained-call': 'off',
      'react/no-unknown-property': 'off',
      'react/no-unescaped-entities': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-member-accessibility': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'comma-dangle': 'off',
      'multiline-ternary': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-use-before-define': 'off',
      'no-global-assign': 'off',
      quotes: 'off',
      'space-before-function-paren': 'off',
      'import/no-relative-parent-imports': 'off',
      'no-nested-ternary': 'error',
    },
  }
)

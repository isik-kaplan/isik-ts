export function slugify(value: string, allowUnicode: boolean = false): string {
  if (allowUnicode) {
    value = value.normalize('NFKC').replace(/[^\p{L}\p{N}_\s-]/gu, '')
  } else {
    value = value.normalize('NFKD')
    // eslint-disable-next-line no-control-regex
    value = value.replace(/[^\x00-\x7F]/g, '')
    // Stryker disable next-line Regex: equivalent mutant. The `+` quantifier is redundant with
    // the `[-\s]+` -> '-' collapse below, which flattens a run of replaced newlines to a single
    // dash regardless of how many spaces this leaves - kept for clarity/intent, not correctness.
    value = value.replace(/[\r\n]+/g, ' ')
    // Stryker disable next-line MethodExpression: equivalent mutant. Redundant with the collapse
    // + trim below, which strips any whitespace this would have removed once it's converted to
    // leading/trailing dashes - kept for clarity/intent, not correctness.
    value = value.trim()
    value = value.replace(/[^\w\s-]/g, '')
  }

  value = value.toLowerCase()

  return value.replace(/[-\s]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

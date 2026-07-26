export function notNone<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

function combinationsOfSize<T>(items: T[], size: number): T[][] {
  if (size === 0) {
    return [[]]
  }
  if (size > items.length) {
    return []
  }
  const [first, ...rest] = items
  const withFirst = combinationsOfSize(rest, size - 1).map((combination) => [first, ...combination])
  const withoutFirst = combinationsOfSize(rest, size)
  return [...withFirst, ...withoutFirst]
}

export function allCombinations<T>(options: T[]): T[][] {
  const result: T[][] = []
  for (let size = 1; size <= options.length; size++) {
    result.push(...combinationsOfSize(options, size))
  }
  return result
}

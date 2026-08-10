export function binomial(total: number, selected: number): bigint {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(selected)) {
    throw new RangeError("Binomial arguments must be safe integers.");
  }

  if (total < 0 || selected < 0 || selected > total) {
    return 0n;
  }

  const count = Math.min(selected, total - selected);
  let result = 1n;

  for (let index = 1; index <= count; index += 1) {
    result = (result * BigInt(total - count + index)) / BigInt(index);
  }

  return result;
}

export function combinations<T>(values: readonly T[], selected: number): readonly (readonly T[])[] {
  if (!Number.isSafeInteger(selected) || selected < 0 || selected > values.length) {
    return [];
  }

  if (selected === 0) {
    return [[]];
  }

  const result: T[][] = [];
  const current: T[] = [];

  function visit(start: number): void {
    if (current.length === selected) {
      result.push([...current]);
      return;
    }

    const remaining = selected - current.length;
    const candidates = values.slice(start, values.length - remaining + 1);
    for (const [offset, value] of candidates.entries()) {
      current.push(value);
      visit(start + offset + 1);
      current.pop();
    }
  }

  visit(0);
  return result;
}

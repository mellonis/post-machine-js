/* istanbul ignore file */

export function getRandomInstructionIndex(max = Number.MAX_SAFE_INTEGER) {
  return Math.floor(Math.random() * max) + 1;
}

export function getIxRange(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('invalid value');
  }

  const result = [getRandomInstructionIndex(Number.MAX_SAFE_INTEGER - count)];

  [...Array(count).keys()].forEach(() => {
    result.push(result[0] + result.length);
  });

  return result;
}

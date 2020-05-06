export function instructionIndexValidator(instructionIndexStr) {
  const instructionIndex = Number(instructionIndexStr);

  return instructionIndex !== 0 && Number.isInteger(instructionIndex);
}

const subroutineNameRegex = /[A-Z$_][A-Z0-9$_]*/i;

export function subroutineNameValidator(subroutineName) {
  return subroutineNameRegex.test(subroutineName);
}

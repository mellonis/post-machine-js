import { Alphabet, TapeBlock } from '@turing-machine-js/machine';

export type CommandFn = (...args: unknown[]) => unknown;

export const blankSymbol = ' ';
export const commandsSet = new WeakSet<CommandFn>();
export const defaultNextInstructionIndex = Symbol('defaultNextInstructionIndex');
export const markSymbol = '*';
export const alphabet = new Alphabet([blankSymbol, markSymbol]);
export const originalTapeBlock = TapeBlock.fromAlphabets([alphabet]);

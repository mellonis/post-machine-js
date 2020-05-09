import PostMachine, {
  check, erase, left, mark, right, stop, Tape,
} from '@post-machine-js/machine';

describe('README.md', () => {
  test('An example', () => {
    const machine = new PostMachine({
      10: erase, // erase symbol and go to the 20th instruction
      20: right, // move the carriage to the right and go to the 30th instruction
      30: check(20, 40), // if marked go to the 20th instruction, or to the 40th otherwise
      40: mark, // put symbol and go to the 50th instruction
      50: right, // move the carriage to the right and go to the 60th instruction
      60: check(70, 90), // if marked go to the 70th instruction, or to the 90th otherwise
      70: left, // move the carriage to the left and go to the 80th instruction
      80: stop, // stop execution
      90: left, // move the carriage to the left and go to the 100th instruction
      100: check(90, 110), // if marked go to the 90th instruction, or to the 110th otherwise
      110: right(10), // move the carriage to the right and go to the 10th instruction
    });

    machine.replaceTapeWith(new Tape({
      alphabet: machine.tape.alphabet,
      symbolList: ['*', '*', '*', ' ', ' ', ' ', '*'],
    }));

    // console.log(machine.tape.symbolList.join('').trim()); // ***   *

    expect(machine.tape.symbolList.join('').trim())
      .toBe('***   *');

    machine.run();

    // console.log(machine.tape.symbolList.join('').trim()); // ****

    expect(machine.tape.symbolList.join('').trim())
      .toBe('****');
  });
});

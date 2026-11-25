/** Physical keys (KeyboardEvent.code) ↔ characters on a US layout. */

const SHIFTED: Record<string, [string, string]> = {
  Digit1: ['1', '!'],
  Digit2: ['2', '@'],
  Digit3: ['3', '#'],
  Digit4: ['4', '$'],
  Digit5: ['5', '%'],
  Digit6: ['6', '^'],
  Digit7: ['7', '&'],
  Digit8: ['8', '*'],
  Digit9: ['9', '('],
  Digit0: ['0', ')'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Backquote: ['`', '~'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Space: [' ', ' '],
  Tab: ['\t', '\t'],
  NumpadDivide: ['/', '/'],
  NumpadMultiply: ['*', '*'],
  NumpadSubtract: ['-', '-'],
  NumpadAdd: ['+', '+'],
  NumpadDecimal: ['.', '.'],
};

/** The character a key types, or null. */
export const charForCode = (code: string, shift: boolean): string | null => {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return shift ? letter[1]! : letter[1]!.toLowerCase();
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return numpad[1]!;
  const pair = SHIFTED[code];
  return pair ? pair[shift ? 1 : 0] : null;
};

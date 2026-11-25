import { charForCode } from '../core/keymap';
import type { InputEvent } from '../types';

/*
 * Input from the controlling device → what an Android phone can do.
 *
 * Mouse:    left button = touch (tap / long press / drag), right = Back,
 *           middle = Home, wheel = swipe.
 * Keyboard: keys arrive by physical position (KeyboardEvent.code, a US
 *           layout is assumed for characters) or as text ("tx"). Printable
 *           keys are typed into the focused field; Esc = Back; editing keys
 *           and Ctrl/⌘ + A/C/V/X act on the field. Phone-only navigation keys
 *           (BrowserBack/BrowserHome/LaunchApp1…) come from a phone viewer.
 */

export interface InputSink {
  pointer(
    action: 'down' | 'move' | 'up' | 'cancel',
    x: number,
    y: number,
    button: number,
  ): void;
  scroll(x: number, y: number, dx: number, dy: number): void;
  globalAction(name: string): void;
  typeText(text: string): void;
  editAction(name: string): void;
}

const NAVIGATION: Record<string, string> = {
  Escape: 'back',
  BrowserBack: 'back',
  BrowserHome: 'home',
  LaunchApp1: 'recents',
  ContextMenu: 'recents',
  LaunchApp2: 'notifications',
  BrowserFavorites: 'quickSettings',
  Power: 'power',
  PrintScreen: 'screenshot',
};

const EDITING: Record<string, string> = {
  Backspace: 'backspace',
  Delete: 'delete',
  Enter: 'enter',
  NumpadEnter: 'enter',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
};

const SHORTCUTS: Record<string, string> = {
  KeyA: 'selectAll',
  KeyC: 'copy',
  KeyV: 'paste',
  KeyX: 'cut',
};

export class HostInput {
  private shift = new Set<string>();
  private command = new Set<string>();
  private buttonDown = false;
  private last = { x: 0.5, y: 0.5 };

  constructor(private readonly sink: InputSink) {}

  /** Let go of everything (session paused, control revoked). */
  release(): void {
    if (this.buttonDown)
      this.sink.pointer('cancel', this.last.x, this.last.y, 0);
    this.buttonDown = false;
    this.shift.clear();
    this.command.clear();
  }

  handle(event: InputEvent): void {
    switch (event.k) {
      case 'mm':
        this.last = { x: event.x, y: event.y };
        if (this.buttonDown) this.sink.pointer('move', event.x, event.y, 0);
        return;
      case 'md':
        this.last = { x: event.x, y: event.y };
        if (event.b === 0) this.buttonDown = true;
        this.sink.pointer('down', event.x, event.y, event.b);
        return;
      case 'mu':
        this.last = { x: event.x, y: event.y };
        if (event.b !== 0) return;
        this.buttonDown = false;
        this.sink.pointer('up', event.x, event.y, 0);
        return;
      case 'wh':
        this.sink.scroll(this.last.x, this.last.y, event.dx, event.dy);
        return;
      case 'tx':
        this.sink.typeText(event.t);
        return;
      case 'rel':
        this.release();
        return;
      case 'ku':
        this.shift.delete(event.c);
        this.command.delete(event.c);
        return;
      case 'kd':
        return this.keyDown(event.c);
    }
  }

  private keyDown(code: string): void {
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      this.shift.add(code);
      return;
    }
    if (/^(Control|Meta)(Left|Right)$/.test(code)) {
      this.command.add(code);
      return;
    }
    if (/^Alt(Left|Right)$/.test(code)) return;
    const nav = NAVIGATION[code];
    if (nav) return this.sink.globalAction(nav);
    if (this.command.size > 0) {
      const shortcut = SHORTCUTS[code];
      if (shortcut) this.sink.editAction(shortcut);
      return;
    }
    const edit = EDITING[code];
    if (edit) return this.sink.editAction(edit);
    const ch = charForCode(code, this.shift.size > 0);
    if (ch) this.sink.typeText(ch);
  }
}

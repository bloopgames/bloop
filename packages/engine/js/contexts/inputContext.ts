import { assert } from "../assert";
import type { PlatformEvent } from "../events";
import { KeyCode, keyToKeyCode, type Key, type KeyState } from "../inputs";

const keysLength = Object.keys(KeyCode).length / 2; // js enum has both key and value entries

export class InputContext {
  dataView?: DataView;
  #keys?: KeyboardContext;
  #mouse?: MouseContext;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  get keys() {
    if (!this.#keys) {
      assert(this.dataView, "DataView is not initialized on InputContext");
      this.#keys = new KeyboardContext(this.dataView);
    }
    return this.#keys;
  }

  get mouse() {
    if (!this.#mouse) {
      assert(this.dataView, "DataView is not initialized on InputContext");
      const paddingBytes = (4 - (keysLength % 4)) % 4;
      this.#mouse = new MouseContext(this.dataView, keysLength + paddingBytes);
    }
    return this.#mouse;
  }

  update(events: PlatformEvent[]) {
    for (const event of events) {
      switch (event.type) {
        case "keydown":
        case "keyup":
          this.keys.update(event);
          break;
        case "mousemove":
        case "mousedown":
        case "mouseup":
        case "mousewheel":
          this.mouse.update(event);
          break;
      }
    }
  }

  flush() {
    this.keys.flush();
    this.mouse.flush();
  }
}

export class MouseContext {
  x = 0;
  y = 0;
  wheel = { x: 0, y: 0 };
  left = { down: false, held: false, up: false };
  middle = { down: false, held: false, up: false };
  right = { down: false, held: false, up: false };

  #dataView: DataView;
  #offset: number;

  constructor(dataView: DataView, offset: number) {
    this.#dataView = dataView;
    this.#offset = offset;
  }

  update(event: PlatformEvent) {
    switch (event.type) {
      case "mousemove":
        this.x = event.x;
        this.y = event.y;
        break;
      case "mousedown":
        if (event.button === "Left") {
          this.left.down = true;
          this.left.held = true;
          this.left.up = false;
        }
        if (event.button === "Middle") {
          this.middle.down = true;
          this.middle.held = true;
          this.middle.up = false;
        }
        if (event.button === "Right") {
          this.right.down = true;
          this.right.held = true;
          this.right.up = false;
        }
        break;
      case "mouseup":
        if (event.button === "Left") {
          this.left.down = false;
          this.left.held = false;
          this.left.up = true;
        }
        if (event.button === "Middle") {
          this.middle.down = false;
          this.middle.held = false;
          this.middle.up = true;
        }
        if (event.button === "Right") {
          this.right.down = false;
          this.right.held = false;
          this.right.up = true;
        }
        break;
      case "mousewheel":
        this.wheel.x = event.x;
        this.wheel.y = event.y;
        break;
    }
  }

  flush() {
    this.left.down = this.right.down = this.middle.down = false;
    this.left.up = this.right.up = this.middle.up = false;
  }
}

export class KeyboardContext {
  #dataView: DataView;
  #offset: number;
  // lazily allocated keystate objects
  #keystates: Map<KeyCode, { down: boolean; held: boolean; up: boolean }> =
    new Map();

  constructor(dataView: DataView) {
    this.#dataView = dataView;
    this.#offset = 0;
  }

  update(event: PlatformEvent) {
    switch (event.type) {
      case "keyup": {
        const keyCode = keyToKeyCode(event.key as Key);
        const keystate = this.#keystate(keyCode);
        keystate.down = false;
        keystate.held = false;
        keystate.up = true;
        break;
      }
      case "keydown": {
        const keyCode = keyToKeyCode(event.key as Key);
        const keystate = this.#keystate(keyCode);
        keystate.down = true;
        keystate.held = true;
        keystate.up = false;
        break;
      }
    }
  }

  flush() {
    for (const [, state] of this.#keystates) {
      state.down = false;
      state.up = false;
    }
  }

  // modifier key helpers
  get shift() {
    return this.shiftLeft || this.shiftRight;
  }
  get alt() {
    return this.altLeft || this.altRight;
  }
  get control() {
    return this.controlLeft || this.controlRight;
  }
  get meta() {
    return this.metaLeft || this.metaRight;
  }

  // this line on is generated from the engine keysEnum manually
  // (unlikely to change often)
  // with the exception of KeyA etc being converted to just a, b, c etc
  get backquote() {
    return this.#keystate(KeyCode.Backquote);
  }
  get backslash() {
    return this.#keystate(KeyCode.Backslash);
  }
  get bracketLeft() {
    return this.#keystate(KeyCode.BracketLeft);
  }
  get bracketRight() {
    return this.#keystate(KeyCode.BracketRight);
  }
  get comma() {
    return this.#keystate(KeyCode.Comma);
  }
  get digit0() {
    return this.#keystate(KeyCode.Digit0);
  }
  get digit1() {
    return this.#keystate(KeyCode.Digit1);
  }
  get digit2() {
    return this.#keystate(KeyCode.Digit2);
  }
  get digit3() {
    return this.#keystate(KeyCode.Digit3);
  }
  get digit4() {
    return this.#keystate(KeyCode.Digit4);
  }
  get digit5() {
    return this.#keystate(KeyCode.Digit5);
  }
  get digit6() {
    return this.#keystate(KeyCode.Digit6);
  }
  get digit7() {
    return this.#keystate(KeyCode.Digit7);
  }
  get digit8() {
    return this.#keystate(KeyCode.Digit8);
  }
  get digit9() {
    return this.#keystate(KeyCode.Digit9);
  }
  get equal() {
    return this.#keystate(KeyCode.Equal);
  }
  get intlBackslash() {
    return this.#keystate(KeyCode.IntlBackslash);
  }
  get intlRo() {
    return this.#keystate(KeyCode.IntlRo);
  }
  get intlYen() {
    return this.#keystate(KeyCode.IntlYen);
  }
  get a() {
    return this.#keystate(KeyCode.KeyA);
  }
  get b() {
    return this.#keystate(KeyCode.KeyB);
  }
  get c() {
    return this.#keystate(KeyCode.KeyC);
  }
  get d() {
    return this.#keystate(KeyCode.KeyD);
  }
  get e() {
    return this.#keystate(KeyCode.KeyE);
  }
  get f() {
    return this.#keystate(KeyCode.KeyF);
  }
  get g() {
    return this.#keystate(KeyCode.KeyG);
  }
  get h() {
    return this.#keystate(KeyCode.KeyH);
  }
  get i() {
    return this.#keystate(KeyCode.KeyI);
  }
  get j() {
    return this.#keystate(KeyCode.KeyJ);
  }
  get k() {
    return this.#keystate(KeyCode.KeyK);
  }
  get l() {
    return this.#keystate(KeyCode.KeyL);
  }
  get m() {
    return this.#keystate(KeyCode.KeyM);
  }
  get n() {
    return this.#keystate(KeyCode.KeyN);
  }
  get o() {
    return this.#keystate(KeyCode.KeyO);
  }
  get p() {
    return this.#keystate(KeyCode.KeyP);
  }
  get q() {
    return this.#keystate(KeyCode.KeyQ);
  }
  get r() {
    return this.#keystate(KeyCode.KeyR);
  }
  get s() {
    return this.#keystate(KeyCode.KeyS);
  }
  get t() {
    return this.#keystate(KeyCode.KeyT);
  }
  get u() {
    return this.#keystate(KeyCode.KeyU);
  }
  get v() {
    return this.#keystate(KeyCode.KeyV);
  }
  get w() {
    return this.#keystate(KeyCode.KeyW);
  }
  get x() {
    return this.#keystate(KeyCode.KeyX);
  }
  get y() {
    return this.#keystate(KeyCode.KeyY);
  }
  get z() {
    return this.#keystate(KeyCode.KeyZ);
  }
  get minus() {
    return this.#keystate(KeyCode.Minus);
  }
  get period() {
    return this.#keystate(KeyCode.Period);
  }
  get quote() {
    return this.#keystate(KeyCode.Quote);
  }
  get semicolon() {
    return this.#keystate(KeyCode.Semicolon);
  }
  get slash() {
    return this.#keystate(KeyCode.Slash);
  }
  get altLeft() {
    return this.#keystate(KeyCode.AltLeft);
  }
  get altRight() {
    return this.#keystate(KeyCode.AltRight);
  }
  get backspace() {
    return this.#keystate(KeyCode.Backspace);
  }
  get capsLock() {
    return this.#keystate(KeyCode.CapsLock);
  }
  get contextMenu() {
    return this.#keystate(KeyCode.ContextMenu);
  }
  get controlLeft() {
    return this.#keystate(KeyCode.ControlLeft);
  }
  get controlRight() {
    return this.#keystate(KeyCode.ControlRight);
  }
  get enter() {
    return this.#keystate(KeyCode.Enter);
  }
  get metaLeft() {
    return this.#keystate(KeyCode.MetaLeft);
  }
  get metaRight() {
    return this.#keystate(KeyCode.MetaRight);
  }
  get shiftLeft() {
    return this.#keystate(KeyCode.ShiftLeft);
  }
  get shiftRight() {
    return this.#keystate(KeyCode.ShiftRight);
  }
  get space() {
    return this.#keystate(KeyCode.Space);
  }
  get tab() {
    return this.#keystate(KeyCode.Tab);
  }
  get convert() {
    return this.#keystate(KeyCode.Convert);
  }
  get kanaMode() {
    return this.#keystate(KeyCode.KanaMode);
  }
  get lang1() {
    return this.#keystate(KeyCode.Lang1);
  }
  get lang2() {
    return this.#keystate(KeyCode.Lang2);
  }
  get lang3() {
    return this.#keystate(KeyCode.Lang3);
  }
  get lang4() {
    return this.#keystate(KeyCode.Lang4);
  }
  get lang5() {
    return this.#keystate(KeyCode.Lang5);
  }
  get nonConvert() {
    return this.#keystate(KeyCode.NonConvert);
  }
  get delete() {
    return this.#keystate(KeyCode.Delete);
  }
  get end() {
    return this.#keystate(KeyCode.End);
  }
  get help() {
    return this.#keystate(KeyCode.Help);
  }
  get home() {
    return this.#keystate(KeyCode.Home);
  }
  get insert() {
    return this.#keystate(KeyCode.Insert);
  }
  get pageDown() {
    return this.#keystate(KeyCode.PageDown);
  }
  get pageUp() {
    return this.#keystate(KeyCode.PageUp);
  }
  get arrowDown() {
    return this.#keystate(KeyCode.ArrowDown);
  }
  get arrowLeft() {
    return this.#keystate(KeyCode.ArrowLeft);
  }
  get arrowRight() {
    return this.#keystate(KeyCode.ArrowRight);
  }
  get arrowUp() {
    return this.#keystate(KeyCode.ArrowUp);
  }
  get numLock() {
    return this.#keystate(KeyCode.NumLock);
  }
  get numpad0() {
    return this.#keystate(KeyCode.Numpad0);
  }
  get numpad1() {
    return this.#keystate(KeyCode.Numpad1);
  }
  get numpad2() {
    return this.#keystate(KeyCode.Numpad2);
  }
  get numpad3() {
    return this.#keystate(KeyCode.Numpad3);
  }
  get numpad4() {
    return this.#keystate(KeyCode.Numpad4);
  }
  get numpad5() {
    return this.#keystate(KeyCode.Numpad5);
  }
  get numpad6() {
    return this.#keystate(KeyCode.Numpad6);
  }
  get numpad7() {
    return this.#keystate(KeyCode.Numpad7);
  }
  get numpad8() {
    return this.#keystate(KeyCode.Numpad8);
  }
  get numpad9() {
    return this.#keystate(KeyCode.Numpad9);
  }
  get numpadAdd() {
    return this.#keystate(KeyCode.NumpadAdd);
  }
  get numpadBackspace() {
    return this.#keystate(KeyCode.NumpadBackspace);
  }
  get numpadClear() {
    return this.#keystate(KeyCode.NumpadClear);
  }
  get numpadClearEntry() {
    return this.#keystate(KeyCode.NumpadClearEntry);
  }
  get numpadComma() {
    return this.#keystate(KeyCode.NumpadComma);
  }
  get numpadDecimal() {
    return this.#keystate(KeyCode.NumpadDecimal);
  }
  get numpadDivide() {
    return this.#keystate(KeyCode.NumpadDivide);
  }
  get numpadEnter() {
    return this.#keystate(KeyCode.NumpadEnter);
  }
  get numpadEqual() {
    return this.#keystate(KeyCode.NumpadEqual);
  }
  get numpadHash() {
    return this.#keystate(KeyCode.NumpadHash);
  }
  get numpadMemoryAdd() {
    return this.#keystate(KeyCode.NumpadMemoryAdd);
  }
  get numpadMemoryClear() {
    return this.#keystate(KeyCode.NumpadMemoryClear);
  }
  get numpadMemoryRecall() {
    return this.#keystate(KeyCode.NumpadMemoryRecall);
  }
  get numpadMemoryStore() {
    return this.#keystate(KeyCode.NumpadMemoryStore);
  }
  get numpadMemorySubtract() {
    return this.#keystate(KeyCode.NumpadMemorySubtract);
  }
  get numpadMultiply() {
    return this.#keystate(KeyCode.NumpadMultiply);
  }
  get numpadParenLeft() {
    return this.#keystate(KeyCode.NumpadParenLeft);
  }
  get numpadParenRight() {
    return this.#keystate(KeyCode.NumpadParenRight);
  }
  get numpadStar() {
    return this.#keystate(KeyCode.NumpadStar);
  }
  get numpadSubtract() {
    return this.#keystate(KeyCode.NumpadSubtract);
  }
  get escape() {
    return this.#keystate(KeyCode.Escape);
  }
  get fn() {
    return this.#keystate(KeyCode.Fn);
  }
  get fnLock() {
    return this.#keystate(KeyCode.FnLock);
  }
  get printScreen() {
    return this.#keystate(KeyCode.PrintScreen);
  }
  get scrollLock() {
    return this.#keystate(KeyCode.ScrollLock);
  }
  get pause() {
    return this.#keystate(KeyCode.Pause);
  }
  get browserBack() {
    return this.#keystate(KeyCode.BrowserBack);
  }
  get browserFavorites() {
    return this.#keystate(KeyCode.BrowserFavorites);
  }
  get browserForward() {
    return this.#keystate(KeyCode.BrowserForward);
  }
  get browserHome() {
    return this.#keystate(KeyCode.BrowserHome);
  }
  get browserRefresh() {
    return this.#keystate(KeyCode.BrowserRefresh);
  }
  get browserSearch() {
    return this.#keystate(KeyCode.BrowserSearch);
  }
  get browserStop() {
    return this.#keystate(KeyCode.BrowserStop);
  }
  get eject() {
    return this.#keystate(KeyCode.Eject);
  }
  get launchApp1() {
    return this.#keystate(KeyCode.LaunchApp1);
  }
  get launchApp2() {
    return this.#keystate(KeyCode.LaunchApp2);
  }
  get launchMail() {
    return this.#keystate(KeyCode.LaunchMail);
  }
  get mediaPlayPause() {
    return this.#keystate(KeyCode.MediaPlayPause);
  }
  get mediaSelect() {
    return this.#keystate(KeyCode.MediaSelect);
  }
  get mediaStop() {
    return this.#keystate(KeyCode.MediaStop);
  }
  get mediaTrackNext() {
    return this.#keystate(KeyCode.MediaTrackNext);
  }
  get mediaTrackPrevious() {
    return this.#keystate(KeyCode.MediaTrackPrevious);
  }
  get power() {
    return this.#keystate(KeyCode.Power);
  }
  get sleep() {
    return this.#keystate(KeyCode.Sleep);
  }
  get audioVolumeDown() {
    return this.#keystate(KeyCode.AudioVolumeDown);
  }
  get audioVolumeMute() {
    return this.#keystate(KeyCode.AudioVolumeMute);
  }
  get audioVolumeUp() {
    return this.#keystate(KeyCode.AudioVolumeUp);
  }
  get wakeUp() {
    return this.#keystate(KeyCode.WakeUp);
  }
  get hyper() {
    return this.#keystate(KeyCode.Hyper);
  }
  get super() {
    return this.#keystate(KeyCode.Super);
  }
  get turbo() {
    return this.#keystate(KeyCode.Turbo);
  }
  get abort() {
    return this.#keystate(KeyCode.Abort);
  }
  get resume() {
    return this.#keystate(KeyCode.Resume);
  }
  get suspend() {
    return this.#keystate(KeyCode.Suspend);
  }
  get again() {
    return this.#keystate(KeyCode.Again);
  }
  get copy() {
    return this.#keystate(KeyCode.Copy);
  }
  get cut() {
    return this.#keystate(KeyCode.Cut);
  }
  get find() {
    return this.#keystate(KeyCode.Find);
  }
  get open() {
    return this.#keystate(KeyCode.Open);
  }
  get paste() {
    return this.#keystate(KeyCode.Paste);
  }
  get props() {
    return this.#keystate(KeyCode.Props);
  }
  get select() {
    return this.#keystate(KeyCode.Select);
  }
  get undo() {
    return this.#keystate(KeyCode.Undo);
  }
  get hiragana() {
    return this.#keystate(KeyCode.Hiragana);
  }
  get katakana() {
    return this.#keystate(KeyCode.Katakana);
  }
  get f1() {
    return this.#keystate(KeyCode.F1);
  }
  get f2() {
    return this.#keystate(KeyCode.F2);
  }
  get f3() {
    return this.#keystate(KeyCode.F3);
  }
  get f4() {
    return this.#keystate(KeyCode.F4);
  }
  get f5() {
    return this.#keystate(KeyCode.F5);
  }
  get f6() {
    return this.#keystate(KeyCode.F6);
  }
  get f7() {
    return this.#keystate(KeyCode.F7);
  }
  get f8() {
    return this.#keystate(KeyCode.F8);
  }
  get f9() {
    return this.#keystate(KeyCode.F9);
  }
  get f10() {
    return this.#keystate(KeyCode.F10);
  }
  get f11() {
    return this.#keystate(KeyCode.F11);
  }
  get f12() {
    return this.#keystate(KeyCode.F12);
  }
  get f13() {
    return this.#keystate(KeyCode.F13);
  }
  get f14() {
    return this.#keystate(KeyCode.F14);
  }
  get f15() {
    return this.#keystate(KeyCode.F15);
  }
  get f16() {
    return this.#keystate(KeyCode.F16);
  }
  get f17() {
    return this.#keystate(KeyCode.F17);
  }
  get f18() {
    return this.#keystate(KeyCode.F18);
  }
  get f19() {
    return this.#keystate(KeyCode.F19);
  }
  get f20() {
    return this.#keystate(KeyCode.F20);
  }
  get f21() {
    return this.#keystate(KeyCode.F21);
  }
  get f22() {
    return this.#keystate(KeyCode.F22);
  }
  get f23() {
    return this.#keystate(KeyCode.F23);
  }
  get f24() {
    return this.#keystate(KeyCode.F24);
  }
  get f25() {
    return this.#keystate(KeyCode.F25);
  }
  get f26() {
    return this.#keystate(KeyCode.F26);
  }
  get f27() {
    return this.#keystate(KeyCode.F27);
  }
  get f28() {
    return this.#keystate(KeyCode.F28);
  }
  get f29() {
    return this.#keystate(KeyCode.F29);
  }
  get f30() {
    return this.#keystate(KeyCode.F30);
  }
  get f31() {
    return this.#keystate(KeyCode.F31);
  }
  get f32() {
    return this.#keystate(KeyCode.F32);
  }
  get f33() {
    return this.#keystate(KeyCode.F33);
  }
  get f34() {
    return this.#keystate(KeyCode.F34);
  }
  get f35() {
    return this.#keystate(KeyCode.F35);
  }

  #keystate(code: KeyCode) {
    let state: KeyState;
    if (this.#keystates.has(code)) {
      state = this.#keystates.get(code)!;
    } else {
      state = {
        down: false,
        held: false,
        up: false,
      };
      this.#keystates.set(code, state);
    }

    return state;
  }
}

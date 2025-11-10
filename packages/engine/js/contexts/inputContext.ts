import { assert } from "../assert";
import type { PlatformEvent } from "../events";
import { keyToKeyCode, type Key, type KeyState } from "../inputs";
import * as Enums from "../codegen/enums";

const keysLength = Object.keys(Enums.Key).length / 2; // js enum has both key and value entries

export class InputContext {
  #dataView?: DataView;
  #keys?: KeyboardContext;
  #mouse?: MouseContext;

  constructor(dataView?: DataView) {
    if (dataView) {
      this.#dataView = dataView;
    }
  }

  get dataView(): NonNullable<DataView> {
    assert(this.#dataView, "DataView is not initialized on InputContext");
    return this.#dataView!;
  }

  set dataView(dataView: DataView) {
    this.#dataView = dataView;
    this.#keys = undefined;
    this.#mouse = undefined;
  }

  get keys() {
    if (!this.#keys) {
      assert(this.#dataView, "DataView is not initialized on InputContext");
      this.#keys = new KeyboardContext(this.dataView);
    }
    return this.#keys;
  }

  get mouse() {
    if (!this.#mouse) {
      assert(this.#dataView, "DataView is not initialized on InputContext");
      const paddingBytes = (4 - (keysLength % 4)) % 4;
      this.#mouse = new MouseContext(this.#dataView, keysLength + paddingBytes);
    }
    return this.#mouse;
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

  #keystates: Map<Enums.Key, KeyState> = new Map();

  constructor(dataView: DataView) {
    this.#dataView = dataView;
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
    return this.#keystate(Enums.Key.Backquote);
  }
  get backslash() {
    return this.#keystate(Enums.Key.Backslash);
  }
  get bracketLeft() {
    return this.#keystate(Enums.Key.BracketLeft);
  }
  get bracketRight() {
    return this.#keystate(Enums.Key.BracketRight);
  }
  get comma() {
    return this.#keystate(Enums.Key.Comma);
  }
  get digit0() {
    return this.#keystate(Enums.Key.Digit0);
  }
  get digit1() {
    return this.#keystate(Enums.Key.Digit1);
  }
  get digit2() {
    return this.#keystate(Enums.Key.Digit2);
  }
  get digit3() {
    return this.#keystate(Enums.Key.Digit3);
  }
  get digit4() {
    return this.#keystate(Enums.Key.Digit4);
  }
  get digit5() {
    return this.#keystate(Enums.Key.Digit5);
  }
  get digit6() {
    return this.#keystate(Enums.Key.Digit6);
  }
  get digit7() {
    return this.#keystate(Enums.Key.Digit7);
  }
  get digit8() {
    return this.#keystate(Enums.Key.Digit8);
  }
  get digit9() {
    return this.#keystate(Enums.Key.Digit9);
  }
  get equal() {
    return this.#keystate(Enums.Key.Equal);
  }
  get intlBackslash() {
    return this.#keystate(Enums.Key.IntlBackslash);
  }
  get intlRo() {
    return this.#keystate(Enums.Key.IntlRo);
  }
  get intlYen() {
    return this.#keystate(Enums.Key.IntlYen);
  }
  get a() {
    return this.#keystate(Enums.Key.KeyA);
  }
  get b() {
    return this.#keystate(Enums.Key.KeyB);
  }
  get c() {
    return this.#keystate(Enums.Key.KeyC);
  }
  get d() {
    return this.#keystate(Enums.Key.KeyD);
  }
  get e() {
    return this.#keystate(Enums.Key.KeyE);
  }
  get f() {
    return this.#keystate(Enums.Key.KeyF);
  }
  get g() {
    return this.#keystate(Enums.Key.KeyG);
  }
  get h() {
    return this.#keystate(Enums.Key.KeyH);
  }
  get i() {
    return this.#keystate(Enums.Key.KeyI);
  }
  get j() {
    return this.#keystate(Enums.Key.KeyJ);
  }
  get k() {
    return this.#keystate(Enums.Key.KeyK);
  }
  get l() {
    return this.#keystate(Enums.Key.KeyL);
  }
  get m() {
    return this.#keystate(Enums.Key.KeyM);
  }
  get n() {
    return this.#keystate(Enums.Key.KeyN);
  }
  get o() {
    return this.#keystate(Enums.Key.KeyO);
  }
  get p() {
    return this.#keystate(Enums.Key.KeyP);
  }
  get q() {
    return this.#keystate(Enums.Key.KeyQ);
  }
  get r() {
    return this.#keystate(Enums.Key.KeyR);
  }
  get s() {
    return this.#keystate(Enums.Key.KeyS);
  }
  get t() {
    return this.#keystate(Enums.Key.KeyT);
  }
  get u() {
    return this.#keystate(Enums.Key.KeyU);
  }
  get v() {
    return this.#keystate(Enums.Key.KeyV);
  }
  get w() {
    return this.#keystate(Enums.Key.KeyW);
  }
  get x() {
    return this.#keystate(Enums.Key.KeyX);
  }
  get y() {
    return this.#keystate(Enums.Key.KeyY);
  }
  get z() {
    return this.#keystate(Enums.Key.KeyZ);
  }
  get minus() {
    return this.#keystate(Enums.Key.Minus);
  }
  get period() {
    return this.#keystate(Enums.Key.Period);
  }
  get quote() {
    return this.#keystate(Enums.Key.Quote);
  }
  get semicolon() {
    return this.#keystate(Enums.Key.Semicolon);
  }
  get slash() {
    return this.#keystate(Enums.Key.Slash);
  }
  get altLeft() {
    return this.#keystate(Enums.Key.AltLeft);
  }
  get altRight() {
    return this.#keystate(Enums.Key.AltRight);
  }
  get backspace() {
    return this.#keystate(Enums.Key.Backspace);
  }
  get capsLock() {
    return this.#keystate(Enums.Key.CapsLock);
  }
  get contextMenu() {
    return this.#keystate(Enums.Key.ContextMenu);
  }
  get controlLeft() {
    return this.#keystate(Enums.Key.ControlLeft);
  }
  get controlRight() {
    return this.#keystate(Enums.Key.ControlRight);
  }
  get enter() {
    return this.#keystate(Enums.Key.Enter);
  }
  get metaLeft() {
    return this.#keystate(Enums.Key.MetaLeft);
  }
  get metaRight() {
    return this.#keystate(Enums.Key.MetaRight);
  }
  get shiftLeft() {
    return this.#keystate(Enums.Key.ShiftLeft);
  }
  get shiftRight() {
    return this.#keystate(Enums.Key.ShiftRight);
  }
  get space() {
    return this.#keystate(Enums.Key.Space);
  }
  get tab() {
    return this.#keystate(Enums.Key.Tab);
  }
  get convert() {
    return this.#keystate(Enums.Key.Convert);
  }
  get kanaMode() {
    return this.#keystate(Enums.Key.KanaMode);
  }
  get lang1() {
    return this.#keystate(Enums.Key.Lang1);
  }
  get lang2() {
    return this.#keystate(Enums.Key.Lang2);
  }
  get lang3() {
    return this.#keystate(Enums.Key.Lang3);
  }
  get lang4() {
    return this.#keystate(Enums.Key.Lang4);
  }
  get lang5() {
    return this.#keystate(Enums.Key.Lang5);
  }
  get nonConvert() {
    return this.#keystate(Enums.Key.NonConvert);
  }
  get delete() {
    return this.#keystate(Enums.Key.Delete);
  }
  get end() {
    return this.#keystate(Enums.Key.End);
  }
  get help() {
    return this.#keystate(Enums.Key.Help);
  }
  get home() {
    return this.#keystate(Enums.Key.Home);
  }
  get insert() {
    return this.#keystate(Enums.Key.Insert);
  }
  get pageDown() {
    return this.#keystate(Enums.Key.PageDown);
  }
  get pageUp() {
    return this.#keystate(Enums.Key.PageUp);
  }
  get arrowDown() {
    return this.#keystate(Enums.Key.ArrowDown);
  }
  get arrowLeft() {
    return this.#keystate(Enums.Key.ArrowLeft);
  }
  get arrowRight() {
    return this.#keystate(Enums.Key.ArrowRight);
  }
  get arrowUp() {
    return this.#keystate(Enums.Key.ArrowUp);
  }
  get numLock() {
    return this.#keystate(Enums.Key.NumLock);
  }
  get numpad0() {
    return this.#keystate(Enums.Key.Numpad0);
  }
  get numpad1() {
    return this.#keystate(Enums.Key.Numpad1);
  }
  get numpad2() {
    return this.#keystate(Enums.Key.Numpad2);
  }
  get numpad3() {
    return this.#keystate(Enums.Key.Numpad3);
  }
  get numpad4() {
    return this.#keystate(Enums.Key.Numpad4);
  }
  get numpad5() {
    return this.#keystate(Enums.Key.Numpad5);
  }
  get numpad6() {
    return this.#keystate(Enums.Key.Numpad6);
  }
  get numpad7() {
    return this.#keystate(Enums.Key.Numpad7);
  }
  get numpad8() {
    return this.#keystate(Enums.Key.Numpad8);
  }
  get numpad9() {
    return this.#keystate(Enums.Key.Numpad9);
  }
  get numpadAdd() {
    return this.#keystate(Enums.Key.NumpadAdd);
  }
  get numpadBackspace() {
    return this.#keystate(Enums.Key.NumpadBackspace);
  }
  get numpadClear() {
    return this.#keystate(Enums.Key.NumpadClear);
  }
  get numpadClearEntry() {
    return this.#keystate(Enums.Key.NumpadClearEntry);
  }
  get numpadComma() {
    return this.#keystate(Enums.Key.NumpadComma);
  }
  get numpadDecimal() {
    return this.#keystate(Enums.Key.NumpadDecimal);
  }
  get numpadDivide() {
    return this.#keystate(Enums.Key.NumpadDivide);
  }
  get numpadEnter() {
    return this.#keystate(Enums.Key.NumpadEnter);
  }
  get numpadEqual() {
    return this.#keystate(Enums.Key.NumpadEqual);
  }
  get numpadHash() {
    return this.#keystate(Enums.Key.NumpadHash);
  }
  get numpadMemoryAdd() {
    return this.#keystate(Enums.Key.NumpadMemoryAdd);
  }
  get numpadMemoryClear() {
    return this.#keystate(Enums.Key.NumpadMemoryClear);
  }
  get numpadMemoryRecall() {
    return this.#keystate(Enums.Key.NumpadMemoryRecall);
  }
  get numpadMemoryStore() {
    return this.#keystate(Enums.Key.NumpadMemoryStore);
  }
  get numpadMemorySubtract() {
    return this.#keystate(Enums.Key.NumpadMemorySubtract);
  }
  get numpadMultiply() {
    return this.#keystate(Enums.Key.NumpadMultiply);
  }
  get numpadParenLeft() {
    return this.#keystate(Enums.Key.NumpadParenLeft);
  }
  get numpadParenRight() {
    return this.#keystate(Enums.Key.NumpadParenRight);
  }
  get numpadStar() {
    return this.#keystate(Enums.Key.NumpadStar);
  }
  get numpadSubtract() {
    return this.#keystate(Enums.Key.NumpadSubtract);
  }
  get escape() {
    return this.#keystate(Enums.Key.Escape);
  }
  get fn() {
    return this.#keystate(Enums.Key.Fn);
  }
  get fnLock() {
    return this.#keystate(Enums.Key.FnLock);
  }
  get printScreen() {
    return this.#keystate(Enums.Key.PrintScreen);
  }
  get scrollLock() {
    return this.#keystate(Enums.Key.ScrollLock);
  }
  get pause() {
    return this.#keystate(Enums.Key.Pause);
  }
  get browserBack() {
    return this.#keystate(Enums.Key.BrowserBack);
  }
  get browserFavorites() {
    return this.#keystate(Enums.Key.BrowserFavorites);
  }
  get browserForward() {
    return this.#keystate(Enums.Key.BrowserForward);
  }
  get browserHome() {
    return this.#keystate(Enums.Key.BrowserHome);
  }
  get browserRefresh() {
    return this.#keystate(Enums.Key.BrowserRefresh);
  }
  get browserSearch() {
    return this.#keystate(Enums.Key.BrowserSearch);
  }
  get browserStop() {
    return this.#keystate(Enums.Key.BrowserStop);
  }
  get eject() {
    return this.#keystate(Enums.Key.Eject);
  }
  get launchApp1() {
    return this.#keystate(Enums.Key.LaunchApp1);
  }
  get launchApp2() {
    return this.#keystate(Enums.Key.LaunchApp2);
  }
  get launchMail() {
    return this.#keystate(Enums.Key.LaunchMail);
  }
  get mediaPlayPause() {
    return this.#keystate(Enums.Key.MediaPlayPause);
  }
  get mediaSelect() {
    return this.#keystate(Enums.Key.MediaSelect);
  }
  get mediaStop() {
    return this.#keystate(Enums.Key.MediaStop);
  }
  get mediaTrackNext() {
    return this.#keystate(Enums.Key.MediaTrackNext);
  }
  get mediaTrackPrevious() {
    return this.#keystate(Enums.Key.MediaTrackPrevious);
  }
  get power() {
    return this.#keystate(Enums.Key.Power);
  }
  get sleep() {
    return this.#keystate(Enums.Key.Sleep);
  }
  get audioVolumeDown() {
    return this.#keystate(Enums.Key.AudioVolumeDown);
  }
  get audioVolumeMute() {
    return this.#keystate(Enums.Key.AudioVolumeMute);
  }
  get audioVolumeUp() {
    return this.#keystate(Enums.Key.AudioVolumeUp);
  }
  get wakeUp() {
    return this.#keystate(Enums.Key.WakeUp);
  }
  get hyper() {
    return this.#keystate(Enums.Key.Hyper);
  }
  get super() {
    return this.#keystate(Enums.Key.Super);
  }
  get turbo() {
    return this.#keystate(Enums.Key.Turbo);
  }
  get abort() {
    return this.#keystate(Enums.Key.Abort);
  }
  get resume() {
    return this.#keystate(Enums.Key.Resume);
  }
  get suspend() {
    return this.#keystate(Enums.Key.Suspend);
  }
  get again() {
    return this.#keystate(Enums.Key.Again);
  }
  get copy() {
    return this.#keystate(Enums.Key.Copy);
  }
  get cut() {
    return this.#keystate(Enums.Key.Cut);
  }
  get find() {
    return this.#keystate(Enums.Key.Find);
  }
  get open() {
    return this.#keystate(Enums.Key.Open);
  }
  get paste() {
    return this.#keystate(Enums.Key.Paste);
  }
  get props() {
    return this.#keystate(Enums.Key.Props);
  }
  get select() {
    return this.#keystate(Enums.Key.Select);
  }
  get undo() {
    return this.#keystate(Enums.Key.Undo);
  }
  get hiragana() {
    return this.#keystate(Enums.Key.Hiragana);
  }
  get katakana() {
    return this.#keystate(Enums.Key.Katakana);
  }
  get f1() {
    return this.#keystate(Enums.Key.F1);
  }
  get f2() {
    return this.#keystate(Enums.Key.F2);
  }
  get f3() {
    return this.#keystate(Enums.Key.F3);
  }
  get f4() {
    return this.#keystate(Enums.Key.F4);
  }
  get f5() {
    return this.#keystate(Enums.Key.F5);
  }
  get f6() {
    return this.#keystate(Enums.Key.F6);
  }
  get f7() {
    return this.#keystate(Enums.Key.F7);
  }
  get f8() {
    return this.#keystate(Enums.Key.F8);
  }
  get f9() {
    return this.#keystate(Enums.Key.F9);
  }
  get f10() {
    return this.#keystate(Enums.Key.F10);
  }
  get f11() {
    return this.#keystate(Enums.Key.F11);
  }
  get f12() {
    return this.#keystate(Enums.Key.F12);
  }
  get f13() {
    return this.#keystate(Enums.Key.F13);
  }
  get f14() {
    return this.#keystate(Enums.Key.F14);
  }
  get f15() {
    return this.#keystate(Enums.Key.F15);
  }
  get f16() {
    return this.#keystate(Enums.Key.F16);
  }
  get f17() {
    return this.#keystate(Enums.Key.F17);
  }
  get f18() {
    return this.#keystate(Enums.Key.F18);
  }
  get f19() {
    return this.#keystate(Enums.Key.F19);
  }
  get f20() {
    return this.#keystate(Enums.Key.F20);
  }
  get f21() {
    return this.#keystate(Enums.Key.F21);
  }
  get f22() {
    return this.#keystate(Enums.Key.F22);
  }
  get f23() {
    return this.#keystate(Enums.Key.F23);
  }
  get f24() {
    return this.#keystate(Enums.Key.F24);
  }
  get f25() {
    return this.#keystate(Enums.Key.F25);
  }
  get f26() {
    return this.#keystate(Enums.Key.F26);
  }
  get f27() {
    return this.#keystate(Enums.Key.F27);
  }
  get f28() {
    return this.#keystate(Enums.Key.F28);
  }
  get f29() {
    return this.#keystate(Enums.Key.F29);
  }
  get f30() {
    return this.#keystate(Enums.Key.F30);
  }
  get f31() {
    return this.#keystate(Enums.Key.F31);
  }
  get f32() {
    return this.#keystate(Enums.Key.F32);
  }
  get f33() {
    return this.#keystate(Enums.Key.F33);
  }
  get f34() {
    return this.#keystate(Enums.Key.F34);
  }
  get f35() {
    return this.#keystate(Enums.Key.F35);
  }

  #keystate(code: Enums.Key) {
    let state: KeyState;
    if (this.#keystates.has(code)) {
      state = this.#keystates.get(code)!;
    } else {
      state = { down: false, held: false, up: false };
      this.#keystates.set(code, state);
    }

    // xxxx xxx1 = held
    // xxxx xx01 = down
    // xxxx xx10 = up
    state.held = !!(this.#dataView.getUint8(code) & 1);
    state.down = state.held && !(this.#dataView.getUint8(code) & 2);
    state.up = !state.held && !!(this.#dataView.getUint8(code) & 2);

    return state;
  }
}

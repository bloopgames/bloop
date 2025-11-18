import * as Enums from "../codegen/enums";
import {
  KEYBOARD_OFFSET,
  type KeyState,
  MOUSE_BUTTONS_OFFSET,
  MOUSE_OFFSET,
} from "../inputs";

// todo - generate these offsets and sizes from codegen
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
    if (!this.#dataView) {
      throw new Error("DataView is not initialized on InputContext");
    }
    return this.#dataView!;
  }

  set dataView(dataView: DataView) {
    this.#dataView = dataView;
    this.#keys = undefined;
    this.#mouse = undefined;
  }

  get keys(): KeyboardContext {
    if (!this.#keys) {
      this.#keys = new KeyboardContext(
        new DataView(
          this.dataView.buffer,
          this.dataView.byteOffset + KEYBOARD_OFFSET,
        ),
      );
    }
    return this.#keys;
  }

  get mouse(): MouseContext {
    if (!this.#mouse) {
      this.#mouse = new MouseContext(
        new DataView(
          this.dataView.buffer,
          this.dataView.byteOffset + MOUSE_OFFSET,
        ),
      );
    }
    return this.#mouse;
  }
}

export class MouseContext {
  #dataView: DataView;
  #buttonStates: Map<Enums.MouseButton, KeyState> = new Map();

  constructor(dataView: DataView) {
    this.#dataView = dataView;
  }

  get x(): number {
    return this.#dataView.getFloat32(0, true);
  }

  get y(): number {
    return this.#dataView.getFloat32(4, true);
  }

  get wheel(): { x: number; y: number } {
    return { x: this.wheelX, y: this.wheelY };
  }

  get wheelX(): number {
    return this.#dataView.getFloat32(8, true);
  }

  get wheelY(): number {
    return this.#dataView.getFloat32(12, true);
  }

  get left(): KeyState {
    return this.#buttonState(Enums.MouseButton.Left);
  }

  get right(): KeyState {
    return this.#buttonState(Enums.MouseButton.Right);
  }
  get middle(): KeyState {
    return this.#buttonState(Enums.MouseButton.Middle);
  }

  #buttonState(code: Enums.MouseButton): KeyState {
    let state: KeyState;
    if (this.#buttonStates.has(code)) {
      state = this.#buttonStates.get(code)!;
    } else {
      state = { down: false, held: false, up: false };
      this.#buttonStates.set(code, state);
    }

    // xxxx xxx1 = held
    // xxxx xx01 = down
    // xxxx xx10 = up
    const offset = MOUSE_BUTTONS_OFFSET;
    state.held = !!(this.#dataView.getUint8(offset + code) & 1);
    state.down = state.held && !(this.#dataView.getUint8(offset + code) & 2);
    state.up = !state.held && !!(this.#dataView.getUint8(offset + code) & 2);

    return state;
  }
}

export class KeyboardContext {
  #dataView: DataView;

  #keystates: Map<Enums.Key, KeyState> = new Map();

  constructor(dataView: DataView) {
    this.#dataView = dataView;
  }

  // modifier key helpers
  get shift(): KeyState {
    return this.shiftLeft || this.shiftRight;
  }
  get alt(): KeyState {
    return this.altLeft || this.altRight;
  }
  get control(): KeyState {
    return this.controlLeft || this.controlRight;
  }
  get meta(): KeyState {
    return this.metaLeft || this.metaRight;
  }

  // this line on is generated from the engine keysEnum manually
  // (unlikely to change often)
  get backquote(): KeyState {
    return this.#keystate(Enums.Key.Backquote);
  }
  get backslash(): KeyState {
    return this.#keystate(Enums.Key.Backslash);
  }
  get bracketLeft(): KeyState {
    return this.#keystate(Enums.Key.BracketLeft);
  }
  get bracketRight(): KeyState {
    return this.#keystate(Enums.Key.BracketRight);
  }
  get comma(): KeyState {
    return this.#keystate(Enums.Key.Comma);
  }
  get digit0(): KeyState {
    return this.#keystate(Enums.Key.Digit0);
  }
  get digit1(): KeyState {
    return this.#keystate(Enums.Key.Digit1);
  }
  get digit2(): KeyState {
    return this.#keystate(Enums.Key.Digit2);
  }
  get digit3(): KeyState {
    return this.#keystate(Enums.Key.Digit3);
  }
  get digit4(): KeyState {
    return this.#keystate(Enums.Key.Digit4);
  }
  get digit5(): KeyState {
    return this.#keystate(Enums.Key.Digit5);
  }
  get digit6(): KeyState {
    return this.#keystate(Enums.Key.Digit6);
  }
  get digit7(): KeyState {
    return this.#keystate(Enums.Key.Digit7);
  }
  get digit8(): KeyState {
    return this.#keystate(Enums.Key.Digit8);
  }
  get digit9(): KeyState {
    return this.#keystate(Enums.Key.Digit9);
  }
  get equal(): KeyState {
    return this.#keystate(Enums.Key.Equal);
  }
  get intlBackslash(): KeyState {
    return this.#keystate(Enums.Key.IntlBackslash);
  }
  get intlRo(): KeyState {
    return this.#keystate(Enums.Key.IntlRo);
  }
  get intlYen(): KeyState {
    return this.#keystate(Enums.Key.IntlYen);
  }
  get a(): KeyState {
    return this.#keystate(Enums.Key.KeyA);
  }
  get b(): KeyState {
    return this.#keystate(Enums.Key.KeyB);
  }
  get c(): KeyState {
    return this.#keystate(Enums.Key.KeyC);
  }
  get d(): KeyState {
    return this.#keystate(Enums.Key.KeyD);
  }
  get e(): KeyState {
    return this.#keystate(Enums.Key.KeyE);
  }
  get f(): KeyState {
    return this.#keystate(Enums.Key.KeyF);
  }
  get g(): KeyState {
    return this.#keystate(Enums.Key.KeyG);
  }
  get h(): KeyState {
    return this.#keystate(Enums.Key.KeyH);
  }
  get i(): KeyState {
    return this.#keystate(Enums.Key.KeyI);
  }
  get j(): KeyState {
    return this.#keystate(Enums.Key.KeyJ);
  }
  get k(): KeyState {
    return this.#keystate(Enums.Key.KeyK);
  }
  get l(): KeyState {
    return this.#keystate(Enums.Key.KeyL);
  }
  get m(): KeyState {
    return this.#keystate(Enums.Key.KeyM);
  }
  get n(): KeyState {
    return this.#keystate(Enums.Key.KeyN);
  }
  get o(): KeyState {
    return this.#keystate(Enums.Key.KeyO);
  }
  get p(): KeyState {
    return this.#keystate(Enums.Key.KeyP);
  }
  get q(): KeyState {
    return this.#keystate(Enums.Key.KeyQ);
  }
  get r(): KeyState {
    return this.#keystate(Enums.Key.KeyR);
  }
  get s(): KeyState {
    return this.#keystate(Enums.Key.KeyS);
  }
  get t(): KeyState {
    return this.#keystate(Enums.Key.KeyT);
  }
  get u(): KeyState {
    return this.#keystate(Enums.Key.KeyU);
  }
  get v(): KeyState {
    return this.#keystate(Enums.Key.KeyV);
  }
  get w(): KeyState {
    return this.#keystate(Enums.Key.KeyW);
  }
  get x(): KeyState {
    return this.#keystate(Enums.Key.KeyX);
  }
  get y(): KeyState {
    return this.#keystate(Enums.Key.KeyY);
  }
  get z(): KeyState {
    return this.#keystate(Enums.Key.KeyZ);
  }
  get minus(): KeyState {
    return this.#keystate(Enums.Key.Minus);
  }
  get period(): KeyState {
    return this.#keystate(Enums.Key.Period);
  }
  get quote(): KeyState {
    return this.#keystate(Enums.Key.Quote);
  }
  get semicolon(): KeyState {
    return this.#keystate(Enums.Key.Semicolon);
  }
  get slash(): KeyState {
    return this.#keystate(Enums.Key.Slash);
  }
  get altLeft(): KeyState {
    return this.#keystate(Enums.Key.AltLeft);
  }
  get altRight(): KeyState {
    return this.#keystate(Enums.Key.AltRight);
  }
  get backspace(): KeyState {
    return this.#keystate(Enums.Key.Backspace);
  }
  get capsLock(): KeyState {
    return this.#keystate(Enums.Key.CapsLock);
  }
  get contextMenu(): KeyState {
    return this.#keystate(Enums.Key.ContextMenu);
  }
  get controlLeft(): KeyState {
    return this.#keystate(Enums.Key.ControlLeft);
  }
  get controlRight(): KeyState {
    return this.#keystate(Enums.Key.ControlRight);
  }
  get enter(): KeyState {
    return this.#keystate(Enums.Key.Enter);
  }
  get metaLeft(): KeyState {
    return this.#keystate(Enums.Key.MetaLeft);
  }
  get metaRight(): KeyState {
    return this.#keystate(Enums.Key.MetaRight);
  }
  get shiftLeft(): KeyState {
    return this.#keystate(Enums.Key.ShiftLeft);
  }
  get shiftRight(): KeyState {
    return this.#keystate(Enums.Key.ShiftRight);
  }
  get space(): KeyState {
    return this.#keystate(Enums.Key.Space);
  }
  get tab(): KeyState {
    return this.#keystate(Enums.Key.Tab);
  }
  get convert(): KeyState {
    return this.#keystate(Enums.Key.Convert);
  }
  get kanaMode(): KeyState {
    return this.#keystate(Enums.Key.KanaMode);
  }
  get lang1(): KeyState {
    return this.#keystate(Enums.Key.Lang1);
  }
  get lang2(): KeyState {
    return this.#keystate(Enums.Key.Lang2);
  }
  get lang3(): KeyState {
    return this.#keystate(Enums.Key.Lang3);
  }
  get lang4(): KeyState {
    return this.#keystate(Enums.Key.Lang4);
  }
  get lang5(): KeyState {
    return this.#keystate(Enums.Key.Lang5);
  }
  get nonConvert(): KeyState {
    return this.#keystate(Enums.Key.NonConvert);
  }
  get delete(): KeyState {
    return this.#keystate(Enums.Key.Delete);
  }
  get end(): KeyState {
    return this.#keystate(Enums.Key.End);
  }
  get help(): KeyState {
    return this.#keystate(Enums.Key.Help);
  }
  get home(): KeyState {
    return this.#keystate(Enums.Key.Home);
  }
  get insert(): KeyState {
    return this.#keystate(Enums.Key.Insert);
  }
  get pageDown(): KeyState {
    return this.#keystate(Enums.Key.PageDown);
  }
  get pageUp(): KeyState {
    return this.#keystate(Enums.Key.PageUp);
  }
  get arrowDown(): KeyState {
    return this.#keystate(Enums.Key.ArrowDown);
  }
  get arrowLeft(): KeyState {
    return this.#keystate(Enums.Key.ArrowLeft);
  }
  get arrowRight(): KeyState {
    return this.#keystate(Enums.Key.ArrowRight);
  }
  get arrowUp(): KeyState {
    return this.#keystate(Enums.Key.ArrowUp);
  }
  get numLock(): KeyState {
    return this.#keystate(Enums.Key.NumLock);
  }
  get numpad0(): KeyState {
    return this.#keystate(Enums.Key.Numpad0);
  }
  get numpad1(): KeyState {
    return this.#keystate(Enums.Key.Numpad1);
  }
  get numpad2(): KeyState {
    return this.#keystate(Enums.Key.Numpad2);
  }
  get numpad3(): KeyState {
    return this.#keystate(Enums.Key.Numpad3);
  }
  get numpad4(): KeyState {
    return this.#keystate(Enums.Key.Numpad4);
  }
  get numpad5(): KeyState {
    return this.#keystate(Enums.Key.Numpad5);
  }
  get numpad6(): KeyState {
    return this.#keystate(Enums.Key.Numpad6);
  }
  get numpad7(): KeyState {
    return this.#keystate(Enums.Key.Numpad7);
  }
  get numpad8(): KeyState {
    return this.#keystate(Enums.Key.Numpad8);
  }
  get numpad9(): KeyState {
    return this.#keystate(Enums.Key.Numpad9);
  }
  get numpadAdd(): KeyState {
    return this.#keystate(Enums.Key.NumpadAdd);
  }
  get numpadBackspace(): KeyState {
    return this.#keystate(Enums.Key.NumpadBackspace);
  }
  get numpadClear(): KeyState {
    return this.#keystate(Enums.Key.NumpadClear);
  }
  get numpadClearEntry(): KeyState {
    return this.#keystate(Enums.Key.NumpadClearEntry);
  }
  get numpadComma(): KeyState {
    return this.#keystate(Enums.Key.NumpadComma);
  }
  get numpadDecimal(): KeyState {
    return this.#keystate(Enums.Key.NumpadDecimal);
  }
  get numpadDivide(): KeyState {
    return this.#keystate(Enums.Key.NumpadDivide);
  }
  get numpadEnter(): KeyState {
    return this.#keystate(Enums.Key.NumpadEnter);
  }
  get numpadEqual(): KeyState {
    return this.#keystate(Enums.Key.NumpadEqual);
  }
  get numpadHash(): KeyState {
    return this.#keystate(Enums.Key.NumpadHash);
  }
  get numpadMemoryAdd(): KeyState {
    return this.#keystate(Enums.Key.NumpadMemoryAdd);
  }
  get numpadMemoryClear(): KeyState {
    return this.#keystate(Enums.Key.NumpadMemoryClear);
  }
  get numpadMemoryRecall(): KeyState {
    return this.#keystate(Enums.Key.NumpadMemoryRecall);
  }
  get numpadMemoryStore(): KeyState {
    return this.#keystate(Enums.Key.NumpadMemoryStore);
  }
  get numpadMemorySubtract(): KeyState {
    return this.#keystate(Enums.Key.NumpadMemorySubtract);
  }
  get numpadMultiply(): KeyState {
    return this.#keystate(Enums.Key.NumpadMultiply);
  }
  get numpadParenLeft(): KeyState {
    return this.#keystate(Enums.Key.NumpadParenLeft);
  }
  get numpadParenRight(): KeyState {
    return this.#keystate(Enums.Key.NumpadParenRight);
  }
  get numpadStar(): KeyState {
    return this.#keystate(Enums.Key.NumpadStar);
  }
  get numpadSubtract(): KeyState {
    return this.#keystate(Enums.Key.NumpadSubtract);
  }
  get escape(): KeyState {
    return this.#keystate(Enums.Key.Escape);
  }
  get fn(): KeyState {
    return this.#keystate(Enums.Key.Fn);
  }
  get fnLock(): KeyState {
    return this.#keystate(Enums.Key.FnLock);
  }
  get printScreen(): KeyState {
    return this.#keystate(Enums.Key.PrintScreen);
  }
  get scrollLock(): KeyState {
    return this.#keystate(Enums.Key.ScrollLock);
  }
  get pause(): KeyState {
    return this.#keystate(Enums.Key.Pause);
  }
  get browserBack(): KeyState {
    return this.#keystate(Enums.Key.BrowserBack);
  }
  get browserFavorites(): KeyState {
    return this.#keystate(Enums.Key.BrowserFavorites);
  }
  get browserForward(): KeyState {
    return this.#keystate(Enums.Key.BrowserForward);
  }
  get browserHome(): KeyState {
    return this.#keystate(Enums.Key.BrowserHome);
  }
  get browserRefresh(): KeyState {
    return this.#keystate(Enums.Key.BrowserRefresh);
  }
  get browserSearch(): KeyState {
    return this.#keystate(Enums.Key.BrowserSearch);
  }
  get browserStop(): KeyState {
    return this.#keystate(Enums.Key.BrowserStop);
  }
  get eject(): KeyState {
    return this.#keystate(Enums.Key.Eject);
  }
  get launchApp1(): KeyState {
    return this.#keystate(Enums.Key.LaunchApp1);
  }
  get launchApp2(): KeyState {
    return this.#keystate(Enums.Key.LaunchApp2);
  }
  get launchMail(): KeyState {
    return this.#keystate(Enums.Key.LaunchMail);
  }
  get mediaPlayPause(): KeyState {
    return this.#keystate(Enums.Key.MediaPlayPause);
  }
  get mediaSelect(): KeyState {
    return this.#keystate(Enums.Key.MediaSelect);
  }
  get mediaStop(): KeyState {
    return this.#keystate(Enums.Key.MediaStop);
  }
  get mediaTrackNext(): KeyState {
    return this.#keystate(Enums.Key.MediaTrackNext);
  }
  get mediaTrackPrevious(): KeyState {
    return this.#keystate(Enums.Key.MediaTrackPrevious);
  }
  get power(): KeyState {
    return this.#keystate(Enums.Key.Power);
  }
  get sleep(): KeyState {
    return this.#keystate(Enums.Key.Sleep);
  }
  get audioVolumeDown(): KeyState {
    return this.#keystate(Enums.Key.AudioVolumeDown);
  }
  get audioVolumeMute(): KeyState {
    return this.#keystate(Enums.Key.AudioVolumeMute);
  }
  get audioVolumeUp(): KeyState {
    return this.#keystate(Enums.Key.AudioVolumeUp);
  }
  get wakeUp(): KeyState {
    return this.#keystate(Enums.Key.WakeUp);
  }
  get hyper(): KeyState {
    return this.#keystate(Enums.Key.Hyper);
  }
  get super(): KeyState {
    return this.#keystate(Enums.Key.Super);
  }
  get turbo(): KeyState {
    return this.#keystate(Enums.Key.Turbo);
  }
  get abort(): KeyState {
    return this.#keystate(Enums.Key.Abort);
  }
  get resume(): KeyState {
    return this.#keystate(Enums.Key.Resume);
  }
  get suspend(): KeyState {
    return this.#keystate(Enums.Key.Suspend);
  }
  get again(): KeyState {
    return this.#keystate(Enums.Key.Again);
  }
  get copy(): KeyState {
    return this.#keystate(Enums.Key.Copy);
  }
  get cut(): KeyState {
    return this.#keystate(Enums.Key.Cut);
  }
  get find(): KeyState {
    return this.#keystate(Enums.Key.Find);
  }
  get open(): KeyState {
    return this.#keystate(Enums.Key.Open);
  }
  get paste(): KeyState {
    return this.#keystate(Enums.Key.Paste);
  }
  get props(): KeyState {
    return this.#keystate(Enums.Key.Props);
  }
  get select(): KeyState {
    return this.#keystate(Enums.Key.Select);
  }
  get undo(): KeyState {
    return this.#keystate(Enums.Key.Undo);
  }
  get hiragana(): KeyState {
    return this.#keystate(Enums.Key.Hiragana);
  }
  get katakana(): KeyState {
    return this.#keystate(Enums.Key.Katakana);
  }
  get f1(): KeyState {
    return this.#keystate(Enums.Key.F1);
  }
  get f2(): KeyState {
    return this.#keystate(Enums.Key.F2);
  }
  get f3(): KeyState {
    return this.#keystate(Enums.Key.F3);
  }
  get f4(): KeyState {
    return this.#keystate(Enums.Key.F4);
  }
  get f5(): KeyState {
    return this.#keystate(Enums.Key.F5);
  }
  get f6(): KeyState {
    return this.#keystate(Enums.Key.F6);
  }
  get f7(): KeyState {
    return this.#keystate(Enums.Key.F7);
  }
  get f8(): KeyState {
    return this.#keystate(Enums.Key.F8);
  }
  get f9(): KeyState {
    return this.#keystate(Enums.Key.F9);
  }
  get f10(): KeyState {
    return this.#keystate(Enums.Key.F10);
  }
  get f11(): KeyState {
    return this.#keystate(Enums.Key.F11);
  }
  get f12(): KeyState {
    return this.#keystate(Enums.Key.F12);
  }
  get f13(): KeyState {
    return this.#keystate(Enums.Key.F13);
  }
  get f14(): KeyState {
    return this.#keystate(Enums.Key.F14);
  }
  get f15(): KeyState {
    return this.#keystate(Enums.Key.F15);
  }
  get f16(): KeyState {
    return this.#keystate(Enums.Key.F16);
  }
  get f17(): KeyState {
    return this.#keystate(Enums.Key.F17);
  }
  get f18(): KeyState {
    return this.#keystate(Enums.Key.F18);
  }
  get f19(): KeyState {
    return this.#keystate(Enums.Key.F19);
  }
  get f20(): KeyState {
    return this.#keystate(Enums.Key.F20);
  }
  get f21(): KeyState {
    return this.#keystate(Enums.Key.F21);
  }
  get f22(): KeyState {
    return this.#keystate(Enums.Key.F22);
  }
  get f23(): KeyState {
    return this.#keystate(Enums.Key.F23);
  }
  get f24(): KeyState {
    return this.#keystate(Enums.Key.F24);
  }
  get f25(): KeyState {
    return this.#keystate(Enums.Key.F25);
  }
  get f26(): KeyState {
    return this.#keystate(Enums.Key.F26);
  }
  get f27(): KeyState {
    return this.#keystate(Enums.Key.F27);
  }
  get f28(): KeyState {
    return this.#keystate(Enums.Key.F28);
  }
  get f29(): KeyState {
    return this.#keystate(Enums.Key.F29);
  }
  get f30(): KeyState {
    return this.#keystate(Enums.Key.F30);
  }
  get f31(): KeyState {
    return this.#keystate(Enums.Key.F31);
  }
  get f32(): KeyState {
    return this.#keystate(Enums.Key.F32);
  }
  get f33(): KeyState {
    return this.#keystate(Enums.Key.F33);
  }
  get f34(): KeyState {
    return this.#keystate(Enums.Key.F34);
  }
  get f35(): KeyState {
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

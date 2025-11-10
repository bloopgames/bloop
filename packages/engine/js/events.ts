import {
  KeyCode,
  keyToKeyCode,
  MouseButtonCode,
  mouseButtonToMouseButtonCode,
  type Key,
  type MouseButton,
} from "./inputs";

// todo - autogenerate
export enum EngineEventType {
  KeyDown = 1,
  KeyUp = 2,
  MouseMove = 3,
  MouseDown = 4,
  MouseUp = 5,
  MouseWheel = 6,
}

export function encodeEvent<T extends PlatformEvent>(
  event: T,
  target?: Uint8Array,
): Uint8Array {
  const size = eventSize(event);
  const buffer = target ?? new Uint8Array(size);
  if (buffer.byteLength !== size) {
    throw new Error(
      `Buffer size mismatch: expected ${size}, got ${buffer.byteLength}`,
    );
  }

  const dataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  switch (event.type) {
    case "keydown":
    case "keyup": {
      dataView.setUint8(0, keyToKeyCode(event.key));
      break;
    }
    case "mousemove":
    case "mousewheel": {
      dataView.setFloat32(0, event.x, true);
      dataView.setFloat32(Float32Array.BYTES_PER_ELEMENT, event.y, true);
      break;
    }
    case "mousedown":
    case "mouseup": {
      dataView.setUint8(0, mouseButtonToMouseButtonCode(event.button));
    }
  }
  return buffer;
}

export function decodeEvent<T extends PlatformEvent>(buffer: Uint8Array): T {
  const dataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const typeByte = dataView.getUint8(0);

  switch (typeByte) {
    case 0: {
      const keyCode = dataView.getUint8(1);
      return {
        type: "keydown",
        key: KeyCode[keyCode],
      } as T;
    }
    case 1: {
      const x = dataView.getFloat32(1, true);
      const y = dataView.getFloat32(Float32Array.BYTES_PER_ELEMENT + 1, true);
      return {
        type: "mousemove",
        x,
        y,
      } as T;
    }
    case 2: {
      const buttonCode = dataView.getUint8(1);
      return {
        type: "mousedown",
        button: MouseButtonCode[buttonCode],
      } as T;
    }
    default:
      throw new Error(`Unknown event type byte: ${typeByte}`);
  }
}

function eventSize(event: PlatformEvent): number {
  return 1 + payloadSize(event);
}

function payloadSize(event: PlatformEvent) {
  switch (event.type) {
    // one byte for the button code
    case "keydown":
    case "keyheld":
    case "keyup":
    case "mousedown":
    case "mouseup":
      return Uint8Array.BYTES_PER_ELEMENT * 1;
    // two floats for x and y
    case "mousemove":
    case "mousewheel":
    case "mouseheld":
      return Float32Array.BYTES_PER_ELEMENT * 2;
  }
}

export type PlatformEvent =
  | {
      type: "keydown";
      key: Key;
    }
  | {
      type: "keyup";
      key: Key;
    }
  | {
      type: "keyheld";
      key: Key;
    }
  | {
      type: "mousemove";
      x: number;
      y: number;
    }
  | {
      type: "mousedown";
      button: MouseButton;
      pressure: number;
    }
  | {
      type: "mouseheld";
      button: MouseButton;
      pressure: number;
    }
  | {
      type: "mouseup";
      button: MouseButton;
      pressure: number;
    }
  | {
      type: "mousewheel";
      x: number;
      y: number;
    };

export type InputEvent =
  | AxisEvent
  | KeyEvent
  | MouseButtonEvent
  | MousePositionEvent
  | MouseWheelEvent;

export type ButtonState = {
  /** is the button currently down */
  down: boolean;
  /** is the button currently up */
  up: boolean;
  /** is the button currently held down */
  held: boolean;
  /** the pressure of the button, if the button is pressure sensitive (on a gamepad for eg), this will be a float between 0 and 1, if the button is not pressure sensitive this will be 0 or 1 */
  pressure: number;
};

export type ButtonEvent = {
  /** the pressure of the button, if the button is pressure sensitive (on a gamepad for eg), this will be a float between 0 and 1, if the button is not pressure sensitive this will be 0 or 1 */
  pressure: number;
};

export type AxisEvent = {
  /** x axis value normalized -1 to 1 */
  x: number;
  /** y axis value normalized -1 to 1 */
  y: number;
};

export type KeyEvent = ButtonEvent & {
  /** The string literal for the key */
  key: Key;
};

export type MouseButtonEvent = ButtonEvent & {
  /** The mouse button that this button event refers to */
  button: MouseButton;
};

export type MousePositionEvent = {
  /** The x coordinate of the mouse in screen space physical pixels */
  x: number;
  /** The y coordinate of the mouse in screen space physical pixels */
  y: number;
};

export type MouseWheelEvent = {
  /** The horizontal scroll amount. Positive is right, negative is left */
  x: number;
  /** The vertical scroll amount. Positive is down, negative is up */
  y: number;
};

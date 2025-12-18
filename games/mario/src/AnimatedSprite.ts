export class AnimatedSprite {
  time = 0;
  frames: AnimatedSpriteFrame[];
  texturePath: string;
  // accumulated time, used to apply dt to the current frame
  acc = 0;

  #frameIndex = 0;

  constructor(texturePath: string, frames: AnimatedSpriteFrame[]) {
    this.frames = frames;
    this.texturePath = texturePath;
  }

  get frameIndex() {
    return this.#frameIndex;
  }

  set frameIndex(frameIndex: number) {
    this.#frameIndex = cycle(frameIndex, this.frames.length);
  }

  get duration() {
    return this.frames.reduce((acc, f) => acc + f.duration, 0);
  }

  get frame() {
    return this.frames[this.frameIndex];
  }

  step(dt: number) {
    this.acc += dt;
    while (this.acc > this.frames[this.frameIndex].duration) {
      this.acc -= this.frames[this.frameIndex].duration;
      this.frameIndex++;
      if (this.frameIndex >= this.frames.length) {
        this.frameIndex = 0;
      }
    }
    this.time += dt;
  }

  setFrame(frame: number) {
    if (frame < 0 || frame >= this.frames.length) {
      throw new Error(
        `InvalidFrame: ${frame} not in range 0..${this.frames.length}`,
      );
    }

    this.time = 0;
    for (let i = 0; i < frame; i++) {
      this.time += this.frames[i].duration;
    }
    this.frameIndex = frame;
  }

  setTime(time: number) {
    this.time = time;
    this.frameIndex = 0;
    while (this.time > this.frames[this.frameIndex].duration) {
      this.time -= this.frames[this.frameIndex].duration;
      this.frameIndex++;
      if (this.frameIndex >= this.frames.length) {
        this.frameIndex = 0;
      }
    }
  }

  reset() {
    this.frameIndex = 0;
    this.time = 0;
  }
}

export type AnimatedSpriteFrame = {
  pos: { x: number; y: number };
  width: number;
  height: number;
  duration: number;
};

function cycle(value: number, arrayLength: number) {
  if (arrayLength === 0) {
    throw new Error("Tried to cycle with empty array");
  }
  if (value < 0) {
    return cycle(arrayLength + value, arrayLength);
  }
  return value % arrayLength;
}

/**
 * constructs an AnimatedSprite from a json object exported from aseprite
 *
 *
 * @param aseprite
 * @returns
 *
 * @example
 *
 * import asepriteJson from "./path/to/exported-sprite.json"
 * const sprite = AninmatedAseprite(asepriteJson)
 */
export function AnimatedAseprite(aseprite: AsepriteImport): AnimatedSprite {
  const asepriteFramesArray = Array.isArray(aseprite.frames)
    ? aseprite.frames
    : Object.values(aseprite.frames);
  const frames: AnimatedSpriteFrame[] = asepriteFramesArray.map(
    (asepriteFrame) => ({
      pos: { x: asepriteFrame.frame.x, y: asepriteFrame.frame.y },
      width: asepriteFrame.frame.w,
      height: asepriteFrame.frame.h,
      duration: asepriteFrame.duration,
    }),
  );

  return new AnimatedSprite(aseprite.meta.image, frames);
}

export type AsepriteImport = {
  // Aseprite has a "Hash" and "Array" export format
  frames:
    | {
        [key: string]: AsepriteFrame;
      }
    | AsepriteFrameWithFilename[];
  meta: AsepriteMetadata;
};

type AsepriteFrameWithFilename = AsepriteFrame & { filename: string };

type AsepriteFrame = {
  frame: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  sourceSize: {
    w: number;
    h: number;
  };
  duration: number;
};

type AsepriteMetadata = {
  app: string;
  version: string;
  image: string;
  format: string;
  size: { w: number; h: number };
  scale: string;
  layers: {
    name: string;
    opacity: number;
    blendMode: string;
  }[];
  frameTags: unknown[];
  slices: unknown[];
};

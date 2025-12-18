export type Flipbook = {
  /** The total time */
  time: number;
  /** The accumulated time */
  acc: number;
  /** The index of the current frame */
  frameIndex: number;
  /** The available frames for this flipbook */
  frames: AnimatedSpriteFrame[];
  /** The current frame */
  frame: AnimatedSpriteFrame;
  /** The total duration */
  duration: number;
};

export function createFlipbook(frames: AnimatedSpriteFrame[]): Flipbook {
  return {
    time: 0,
    acc: 0,
    frameIndex: 0,
    frames,
    frame: frames[0],
    duration: frames.reduce((acc, f) => acc + f.duration, 0),
  };
}

export function step(flipbook: Flipbook, dt: number) {
  flipbook.acc += dt;
  while (flipbook.acc > flipbook.frames[flipbook.frameIndex].duration) {
    flipbook.acc -= flipbook.frames[flipbook.frameIndex].duration;
    flipbook.frameIndex++;
    flipbook.frameIndex %= flipbook.frames.length;
  }
  flipbook.time += dt;
  update(flipbook);
}

export function update(flipbook: Flipbook) {
  flipbook.frame =
    flipbook.frames[flipbook.frameIndex % flipbook.frames.length];
}

export function setFrame(flipbook: Flipbook, index: number) {
  if (index < 0 || index >= flipbook.frames.length) {
    throw new Error(
      `InvalidFrame: ${index} not in range 0..${flipbook.frames.length}`,
    );
  }

  flipbook.time = 0;
  for (let i = 0; i < index; i++) {
    flipbook.time += flipbook.frames[i].duration;
  }
  flipbook.frameIndex = index;
  update(flipbook);
}

export function setTime(flipbook: Flipbook, time: number) {
  flipbook.time = time;
  flipbook.frameIndex = 0;
  while (flipbook.time > flipbook.frames[flipbook.frameIndex].duration) {
    flipbook.time -= flipbook.frames[flipbook.frameIndex].duration;
    flipbook.frameIndex++;
  }
  flipbook.frameIndex %= flipbook.frames.length;
  update(flipbook);
}

export function reset(flipbook: Flipbook) {
  flipbook.frameIndex = 0;
  flipbook.time = 0;
  update(flipbook);
}

export type AnimatedSpriteFrame = {
  pos: { x: number; y: number };
  width: number;
  height: number;
  duration: number;
};

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
 * const sprite = AsepriteFlipbook(asepriteJson)
 */
export function AsepriteFlipbook(aseprite: AsepriteImport): Flipbook {
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

  return createFlipbook(frames);
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

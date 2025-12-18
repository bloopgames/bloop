// TODO: allow loading animated sprite JSON from async boot
import marioIdleJson from "../public/sprites/MarioIdle.json";
import marioJumpJson from "../public/sprites/MarioJump.json";
import marioSkidJson from "../public/sprites/MarioSkid.json";
import marioWalkJson from "../public/sprites/MarioWalk.json";
import { AsepriteFlipbook } from "./flipbook";

/** Static flipbook data - frame definitions from Aseprite */
export const FLIPBOOKS = {
  idle: AsepriteFlipbook(marioIdleJson),
  run: AsepriteFlipbook(marioWalkJson),
  jump: AsepriteFlipbook(marioJumpJson),
  skid: AsepriteFlipbook(marioSkidJson),
};

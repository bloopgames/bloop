import type { Quad, Scene, SceneNode, Text, Toodle } from "@bloopjs/toodle";
import { Colors } from "@bloopjs/toodle";
import {
  BLOCK_SIZE,
  BLOCK_Y,
  COIN_SIZE,
  GROUND_Y,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "./config";
import type { game } from "./game";

// Placeholder colors until sprites are added
const MARIO_COLOR = Colors.web.red;
const LUIGI_COLOR = Colors.web.green;
const BLOCK_COLOR = Colors.web.sienna;
const COIN_COLOR = Colors.web.gold;
const GROUND_COLOR = Colors.web.saddleBrown;

export interface DrawState {
  root: SceneNode;
  ground: SceneNode;
  block: SceneNode;
  coin: SceneNode;
  p1: Quad.QuadNode;
  p2: SceneNode;
  p1Score: Text.TextNode;
  p2Score: Text.TextNode;
}

export function createDrawState(toodle: Toodle): DrawState {
  const root = toodle.Node({ scale: 3 });

  const ground = root.add(
    toodle.shapes.Rect({
      idealSize: { width: 400, height: 40 },
      position: { x: 0, y: GROUND_Y - 20 },
      color: GROUND_COLOR,
    }),
  );

  const block = root.add(
    toodle.shapes.Rect({
      idealSize: { width: BLOCK_SIZE, height: BLOCK_SIZE },
      color: BLOCK_COLOR,
    }),
  );

  const coin = root.add(
    toodle.shapes.Circle({
      idealSize: { width: COIN_SIZE, height: COIN_SIZE },
      color: COIN_COLOR,
    }),
  );

  const p1 = root.add(
    toodle.Quad("marioWalk", {
      idealSize: { width: 16, height: 16 },
      region: { x: 0, y: 0, width: 16, height: 16 },
    }),
  );

  const p2 = root.add(
    toodle.shapes.Rect({
      idealSize: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      color: LUIGI_COLOR,
    }),
  );

  const p1Score = root.add(
    toodle.Text("ComicNeue", "P1: 0", {
      fontSize: 16,
      color: MARIO_COLOR,
    }),
  );

  const p2Score = root.add(
    toodle.Text("ComicNeue", "P2: 0", {
      fontSize: 16,
      color: LUIGI_COLOR,
    }),
  );

  return { root, ground, block, coin, p1, p2, p1Score, p2Score };
}

export function draw(g: typeof game, toodle: Toodle, state: DrawState) {
  const { bag } = g.context;

  // Update positions
  state.block.position = { x: bag.block.x, y: BLOCK_Y + BLOCK_SIZE / 2 };

  state.coin.position = { x: bag.coin.x, y: BLOCK_Y + BLOCK_SIZE + COIN_SIZE };
  state.coin.isActive = !bag.coin.visible;

  state.p1.position = { x: bag.p1.x, y: bag.p1.y + 8 }; // sprite is 16x16, center at +8
  state.p2.position = { x: bag.p2.x, y: bag.p2.y + PLAYER_HEIGHT / 2 };

  state.p1Score.text = `P1: ${bag.p1.score}`;
  state.p1Score.position = { x: -40, y: 40 };

  state.p2Score.text = `P2: ${bag.p2.score}`;
  state.p2Score.position = { x: 25, y: 40 };

  toodle.startFrame();
  toodle.draw(state.root);
  toodle.endFrame();
}

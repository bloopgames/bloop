import type { QuadNode, SceneNode, Text, Toodle } from "@bloopjs/toodle";
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
  // Screen containers
  titleScreen: SceneNode;
  gameScreen: SceneNode;
  // Game elements (under gameScreen)
  ground: QuadNode;
  block: SceneNode;
  coin: QuadNode;
  p1: QuadNode;
  p2: QuadNode;
  viewport: SceneNode;
  p1Score: Text.TextNode;
  p2Score: Text.TextNode;
  // Title elements (under titleScreen)
  titleText: Text.TextNode;
  subtitleText: Text.TextNode;
}

export function createDrawState(toodle: Toodle): DrawState {
  const root = toodle.Node({ scale: 3 });

  // Title screen container
  const titleScreen = root.add(toodle.Node({}));
  const titleText = titleScreen.add(
    toodle.Text("ComicNeue", "COIN CHASE", {
      fontSize: 24,
      color: { r: 1, g: 1, b: 1, a: 1 },
      position: { x: 0, y: 20 },
    }),
  );
  const subtitleText = titleScreen.add(
    toodle.Text("ComicNeue", "[Space] Local  [Enter] Online", {
      fontSize: 10,
      color: { r: 1, g: 1, b: 1, a: 1 },
      position: { x: 0, y: 0 },
    }),
  );

  // Game screen container
  const gameScreen = root.add(toodle.Node({}));
  gameScreen.isActive = false;

  const ground = gameScreen.add(
    toodle.shapes.Rect({
      size: { width: 400, height: 40 },
      position: { x: 0, y: GROUND_Y - 20 },
      color: GROUND_COLOR,
    }),
  );

  const block = gameScreen.add(
    toodle.shapes.Rect({
      size: { width: BLOCK_SIZE, height: BLOCK_SIZE },
      color: BLOCK_COLOR,
    }),
  );

  const coin = gameScreen.add(
    toodle.shapes.Circle({
      radius: COIN_SIZE / 2,
      color: COIN_COLOR,
    }),
  );

  const p1 = gameScreen.add(
    toodle.Quad("marioWalk", {
      size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      region: { x: 0, y: 0, width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
    }),
  );

  const p2 = gameScreen.add(
    toodle.Quad("marioWalk", {
      size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      region: { x: 0, y: 0, width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      color: LUIGI_COLOR,
    }),
  );

  const p1Score = gameScreen.add(
    toodle.Text("ComicNeue", "P9: 0", {
      fontSize: 16,
      color: MARIO_COLOR,
    }),
  );

  const p2Score = gameScreen.add(
    toodle.Text("ComicNeue", "P2: 0", {
      fontSize: 16,
      color: LUIGI_COLOR,
    }),
  );

  const viewport = toodle.Node({
    size: { width: toodle.resolution.width, height: toodle.resolution.height },
  });

  return {
    root,
    titleScreen,
    gameScreen,
    ground,
    block,
    coin,
    p1,
    p2,
    p1Score,
    p2Score,
    titleText,
    subtitleText,
    viewport,
  };
}

export function draw(g: typeof game, toodle: Toodle, state: DrawState) {
  const { bag } = g.context;

  // Toggle screens
  state.titleScreen.isActive = bag.phase !== "playing";
  state.gameScreen.isActive = bag.phase === "playing";

  // Update title text based on phase
  if (bag.phase === "title") {
    state.subtitleText.text = "[Space] Local  [Enter] Online";
  } else if (bag.phase === "waiting") {
    state.subtitleText.text = "Waiting for opponent...";
  }

  // Update game positions only when playing
  if (bag.phase === "playing") {
    state.block.position = { x: bag.block.x, y: BLOCK_Y + BLOCK_SIZE / 2 };

    state.coin.position = {
      x: bag.coin.x,
      y: bag.coin.y,
    };
    state.coin.isActive = bag.coin.visible;
    state.coin.color =
      bag.coin.winner === 1
        ? MARIO_COLOR
        : bag.coin.winner === 2
          ? LUIGI_COLOR
          : COIN_COLOR;
    state.p1.position = {
      x: bag.p1.x,
      y: bag.p1.y + PLAYER_HEIGHT / 2,
    }; // sprite is 16x16, center at +8
    state.p2.position = { x: bag.p2.x, y: bag.p2.y + PLAYER_HEIGHT / 2 };

    state.p2.flipX = true;

    const padding = 20;

    state.p1Score.text = `P1: ${bag.p1.score}`;
    state.p2Score.text = `P2: ${bag.p2.score}`;

    state.viewport.size = {
      width: toodle.resolution.width,
      height: toodle.resolution.height,
    };

    state.ground.size.width = state.viewport.size.width;

    state.p1Score.setBounds({
      left: state.viewport.bounds.left + padding,
      top: state.viewport.bounds.top - padding,
    });

    state.p2Score.setBounds({
      right: state.viewport.bounds.right - padding,
      top: state.viewport.bounds.top - padding,
    });
  }

  toodle.startFrame();
  toodle.draw(state.root);
  toodle.endFrame();
}

import { assert, unwrap } from "@bloopjs/bloop";
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
import type { game, Player, Pose } from "./game";

// Placeholder colors until sprites are added
const MARIO_COLOR = Colors.web.red;
const LUIGI_COLOR = Colors.web.green;
const BLOCK_COLOR = Colors.web.sienna;
const COIN_COLOR = Colors.web.gold;
const GROUND_COLOR = Colors.web.saddleBrown;

/** Quads for each pose animation */
type PoseQuads = Record<Pose, QuadNode>;

export interface DrawState {
  root: SceneNode;
  // Screen containers
  titleScreen: SceneNode;
  gameScreen: SceneNode;
  // Game elements (under gameScreen)
  ground: QuadNode;
  block: SceneNode;
  coin: QuadNode;
  p1: PoseQuads;
  p2: PoseQuads;
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

  // Map pose to texture name
  const poseTextures: Record<Pose, string> = {
    idle: "marioIdle",
    run: "marioWalk",
    jump: "marioJump",
    skid: "marioSkid",
  };

  // Create pose quads for a player
  const createPoseQuads = (color?: typeof LUIGI_COLOR): PoseQuads => {
    const poses = {} as PoseQuads;
    for (const pose of ["idle", "run", "jump", "skid"] satisfies Pose[]) {
      const quad = gameScreen.add(
        toodle.Quad(poseTextures[pose], {
          size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
          region: { x: 0, y: 0, width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
          color,
        }),
      );
      quad.isActive = false; // Start inactive, draw will activate the right one
      poses[pose] = quad;
    }
    return poses;
  };

  const p1 = createPoseQuads();
  const p2 = createPoseQuads(LUIGI_COLOR);

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
    // Update player sprites
    updatePlayerQuads(state.p1, bag.p1);
    updatePlayerQuads(state.p2, bag.p2);

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

/** Updates a player's pose quads based on their current state */
function updatePlayerQuads(quads: PoseQuads, player: Player) {
  const poses: Pose[] = ["idle", "run", "jump", "skid"];

  for (const pose of poses) {
    const quad = quads[pose];
    const isActive = pose === player.pose;
    quad.isActive = isActive;
    if (!isActive) {
      continue;
    }

    // Update position
    quad.position = {
      x: player.x,
      y: player.y + PLAYER_HEIGHT / 2,
    };

    // Update flip based on facing direction
    quad.flipX = player.facingDir === -1;

    // Update region from flipbook frame using static flipbooks + bag AnimState
    const flipbook = unwrap(
      player.anims[pose],
      `No runtime flipbook for pose ${pose}`,
    );
    const frameIndex = flipbook.frameIndex % flipbook.frames.length;
    const frame = flipbook.frames[frameIndex];
    quad.region.x = frame.pos.x;
    quad.region.y = frame.pos.y;
    quad.region.width = frame.width;
    quad.region.height = frame.height;
  }
}

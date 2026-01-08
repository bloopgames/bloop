import { unwrap } from "@bloopjs/bloop";
import type { Color, Toodle } from "@bloopjs/toodle";
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
const COIN_COLOR = Colors.web.gold;
const GROUND_COLOR = Colors.web.saddleBrown;

// Map pose to texture name
const POSE_TEXTURES: Record<Pose, string> = {
  idle: "marioIdle",
  run: "marioWalk",
  jump: "marioJump",
  skid: "marioSkid",
};

export function draw(g: typeof game, toodle: Toodle) {
  const { bag } = g.context;
  const isMobile = toodle.resolution.width < toodle.resolution.height;

  toodle.startFrame();

  const root = toodle.Node();

  toodle.camera.zoom = 3;

  if (bag.phase !== "playing") {
    // Title screen
    const titleScreen = root.add(toodle.Node({}));

    titleScreen.add(
      toodle.Text("Roboto", "Mario Rollback", {
        fontSize: 20,
        align: "center",
        color: { r: 1, g: 1, b: 1, a: 1 },
        position: { x: 0, y: 20 },
        size: {
          width: toodle.resolution.width - 100,
          height: toodle.resolution.height,
        },
        shrinkToFit: {
          minFontSize: 4,
        },
      }),
    );

    const subtitleText =
      bag.phase === "waiting"
        ? "Waiting for opponent..."
        : isMobile
          ? "Tap to find opponent"
          : "[Enter/Click] Online  [Space] Local";

    titleScreen.add(
      toodle.Text("Roboto", subtitleText, {
        fontSize: 10,
        color: { r: 1, g: 1, b: 1, a: 1 },
      }),
    );
  } else {
    // Game screen
    const gameScreen = root.add(toodle.Node({}));

    const viewport = toodle.Node({
      size: {
        width: toodle.resolution.width,
        height: toodle.resolution.height,
      },
    });

    // Ground
    const ground = gameScreen.add(
      toodle.shapes.Rect({
        size: { width: viewport.size!.width, height: 1000 },
        color: GROUND_COLOR,
      }),
    );
    ground.setBounds({ top: GROUND_Y });

    // Block
    gameScreen.add(
      toodle.Quad("brick", {
        size: { width: BLOCK_SIZE, height: BLOCK_SIZE },
        position: { x: bag.block.x, y: BLOCK_Y + BLOCK_SIZE / 2 },
      }),
    );

    // Coin
    if (bag.coin.visible) {
      const coinColor =
        bag.coin.winner === 1
          ? MARIO_COLOR
          : bag.coin.winner === 2
            ? LUIGI_COLOR
            : COIN_COLOR;

      gameScreen.add(
        toodle.shapes.Circle({
          radius: COIN_SIZE / 2,
          color: coinColor,
          position: { x: bag.coin.x, y: bag.coin.y },
        }),
      );
    }

    // Players
    const p1Quad = drawPlayer(toodle, gameScreen, bag.p1);
    const p2Quad = drawPlayer(toodle, gameScreen, bag.p2, LUIGI_COLOR);

    // Scores
    const padding = 20;

    const p1Score = gameScreen.add(
      toodle.Text("Roboto", `P1: ${bag.p1.score}`, {
        fontSize: 16,
        color: MARIO_COLOR,
      }),
    );
    p1Score.setBounds({
      left: viewport.bounds.left + padding,
      top: viewport.bounds.top - padding,
    });

    const p2Score = gameScreen.add(
      toodle.Text("Roboto", `P2: ${bag.p2.score}`, {
        fontSize: 16,
        color: LUIGI_COLOR,
      }),
    );
    p2Score.setBounds({
      right: viewport.bounds.right - padding,
      top: viewport.bounds.top - padding,
    });

    // Debug hitboxes
    if (bag.debugHitboxes) {
      toodle.draw(root);
      drawHitbox(toodle, p1Quad.bounds);
      drawHitbox(toodle, p2Quad.bounds);
      // Need to get block bounds - draw a hitbox at block position
      drawHitbox(toodle, {
        left: bag.block.x - BLOCK_SIZE / 2,
        right: bag.block.x + BLOCK_SIZE / 2,
        bottom: BLOCK_Y,
        top: BLOCK_Y + BLOCK_SIZE,
      });
      if (bag.coin.visible) {
        drawHitbox(toodle, {
          left: bag.coin.x - COIN_SIZE / 2,
          right: bag.coin.x + COIN_SIZE / 2,
          bottom: bag.coin.y - COIN_SIZE / 2,
          top: bag.coin.y + COIN_SIZE / 2,
        });
      }
      toodle.endFrame();
      return;
    }
  }

  toodle.draw(root);
  toodle.endFrame();
}

/** Draws a player sprite and returns the quad for hitbox drawing */
function drawPlayer(
  toodle: Toodle,
  parent: ReturnType<Toodle["Node"]>,
  player: Player,
  color?: Color,
) {
  const pose = player.pose;
  const textureName = POSE_TEXTURES[pose];

  const quad = parent.add(
    toodle.Quad(textureName, {
      size: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      region: { x: 0, y: 0, width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
      color,
      position: {
        x: player.x,
        y: player.y + PLAYER_HEIGHT / 2,
      },
    }),
  );

  // Update flip based on facing direction
  quad.flipX = player.facingDir === -1;

  // Update region from flipbook frame
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

  return quad;
}

const hitboxDefaultColor = { r: 1, g: 0, b: 1, a: 0.4 };

let hitboxShader: ReturnType<Toodle["QuadShader"]> | null = null;

function getHitboxShader(toodle: Toodle) {
  if (!hitboxShader) {
    hitboxShader = toodle.QuadShader(
      "hitbox-border",
      16,
      /*wgsl*/ `
@fragment
fn frag(vertex: VertexOutput) -> @location(0) vec4f {
  let color = default_fragment_shader(vertex, linearSampler);
  let uv = vertex.engine_uv.zw;
  let border = 0.1;

  let nearLeft = uv.x < border;
  let nearRight = uv.x > (1.0 - border);
  let nearBottom = uv.y < border;
  let nearTop = uv.y > (1.0 - border);

  if (nearLeft || nearRight || nearBottom || nearTop) {
    return vec4f(color.rgb, 1.0);
  }

  return color;
}
      `,
    );
  }
  return hitboxShader;
}

function drawHitbox(
  toodle: Toodle,
  bounds: { left: number; right: number; top: number; bottom: number },
  color: Color = hitboxDefaultColor,
) {
  toodle.draw(
    toodle.shapes
      .Rect({
        color,
        size: {
          width: bounds.right - bounds.left,
          height: bounds.top - bounds.bottom,
        },
        shader: getHitboxShader(toodle),
      })
      .setBounds(bounds),
  );
}

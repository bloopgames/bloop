import { Colors, type Toodle } from "@bloopjs/toodle";
import type { game } from "../src/game";

export async function loadAssets(g: typeof game, toodle: Toodle) {
  await toodle.assets.loadFont(
    "default",
    new URL("https://toodle.gg/fonts/Roboto-Regular-msdf.json"),
  );
}

export function draw(g: typeof game, toodle: Toodle) {
  const { bag } = g.context;
  toodle.startFrame();
  toodle.draw(
    toodle.shapes.Circle({
      radius: 50,
      scale: bag.scale,
      position: { x: bag.x, y: bag.y },
      color: Colors.web.hotPink,
    }),
  );
  toodle.draw(
    toodle.shapes.Rect({
      size: { width: 10, height: 10 },
      position: toodle.convertSpace(
        { x: bag.mouse.x, y: bag.mouse.y },
        { from: "screen", to: "world" },
      ),
      color: Colors.web.lightGreen,
    }),
  );
  toodle.draw(
    toodle.Text("default", "Move with WASD").setBounds({
      right: toodle.resolution.width - 10,
      bottom: toodle.resolution.height + 10,
    }),
  );
  toodle.endFrame();
}

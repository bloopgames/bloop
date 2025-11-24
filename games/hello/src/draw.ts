import { Colors, type Toodle } from "@bloopjs/toodle";
import type { game } from "../src/game";

export function draw(g: typeof game, toodle: Toodle) {
  const { bag } = g.context;
  toodle.startFrame();
  toodle.draw(
    toodle.shapes.Circle({
      idealSize: { width: 100, height: 100 },
      scale: bag.scale,
      position: { x: bag.x, y: bag.y },
      color: Colors.web.hotPink,
    }),
  );
  toodle.endFrame();
}

import { Bloop } from "@bloopjs/bloop";
import { moveSpeed } from "./config";

export const game = Bloop.create({
  bag: {
    x: 0,
    y: 0,
    scale: 1,
    simId: "",
    mouse: {
      x: 0,
      y: 0,
    },
  },
});

game.system("move", {
  update({ bag, inputs }) {
    if (inputs.keys.a.held) bag.x -= moveSpeed;
    if (inputs.keys.d.held) bag.x += moveSpeed;
    if (inputs.keys.w.held) bag.y += moveSpeed;
    if (inputs.keys.s.held) bag.y -= moveSpeed;

    bag.mouse.x = inputs.mouse.x;
    bag.mouse.y = inputs.mouse.y;

    bag.scale = 2;
  },
});

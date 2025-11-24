import { Bloop } from "@bloopjs/bloop";
import { moveSpeed } from "./config";

export const game = Bloop.create({
  bag: {
    x: 0,
    y: 0,
    scale: 1,
    simId: "",
  },
});

game.system("move", {
  update({ bag, inputs }) {
    if (inputs.keys.a.held) bag.x -= moveSpeed;
    if (inputs.keys.d.held) bag.x += moveSpeed;
    if (inputs.keys.w.held) bag.y += moveSpeed;
    if (inputs.keys.s.held) bag.y -= moveSpeed;

    console.table(bag);

    bag.scale = 1;
  },
});

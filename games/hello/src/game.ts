import { Bloop } from "@bloopjs/bloop";

export const game = Bloop.create({
  bag: {
    x: 0,
    y: 0,
  },
});

game.system("move", {
  update({ bag, inputs }) {
    if (inputs.keys.a.held) bag.x -= 1;
    if (inputs.keys.d.held) bag.x += 1;
    if (inputs.keys.w.held) bag.y += 1;
    if (inputs.keys.s.held) bag.y -= 1;
  },
});

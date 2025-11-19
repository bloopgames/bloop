import { Bloop } from "@bloopjs/bloop";

export const game = Bloop.create({
  bag: {
    x: 0,
    y: 0,
  },
});

game.system("move", {
  update({ bag }) {
    bag.x += 1;
    bag.y += 1;


    console.table(bag);
    console.log('great');
  },
});

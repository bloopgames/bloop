import { PhaseSystem } from "./phase";

export const MatchmakingSystem = PhaseSystem("title", {
  update({ bag, inputs, net }) {
    if (net.isInSession) return;
    if (inputs.keys.enter.down || inputs.mouse.left.down) {
      bag.mode = "online";
      bag.phase = "waiting";
      net.wantsRoomCode = "mario-demo";
    }
  },

  netcode({ event, bag }) {
    switch (event.type) {
      case "session:start":
        bag.phase = "playing";
        break;
      case "session:end":
        bag.phase = "title";
        break;
    }
  },
});

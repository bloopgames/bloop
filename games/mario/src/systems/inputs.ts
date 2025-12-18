import * as cfg from "../config";
import { PhaseSystem } from "./phase";

// Player 1 input: WASD
export const InputsSystem = PhaseSystem("playing", {
  update({ bag, players, net }) {
    const p1 = bag.p1;
    const p2 = bag.p2;

    // P1 Horizontal movement
    p1.vx = 0;
    if (players[0].keys.a.held) {
      p1.x -= cfg.MOVE_SPEED;
      p1.vx = -cfg.MOVE_SPEED;
      p1.facingDir = -1;
    }
    if (players[0].keys.d.held) {
      p1.x += cfg.MOVE_SPEED;
      p1.vx = cfg.MOVE_SPEED;
      p1.facingDir = 1;
    }
    // P1 Jump
    const wantsJump = players[0].keys.w.down || players[0].mouse.left.down;
    if (wantsJump && p1.grounded) {
      p1.vy = cfg.JUMP_VELOCITY;
      p1.grounded = false;
    }

    // P2 Horizontal movement
    p2.vx = 0;
    if (players[1].keys.a.held) {
      p2.x -= cfg.MOVE_SPEED;
      p2.vx = -cfg.MOVE_SPEED;
      p2.facingDir = -1;
    }
    if (players[1].keys.d.held) {
      p2.x += cfg.MOVE_SPEED;
      p2.vx = cfg.MOVE_SPEED;
      p2.facingDir = 1;
    }
    // P2 Jump
    if ((players[1].keys.w.down || players[1].mouse.left.down) && p2.grounded) {
      p2.vy = cfg.JUMP_VELOCITY;
      p2.grounded = false;
    }

    if (!net.isInSession) {
      // locally, control second player with ijkl
      if (players[0].keys.j.held) {
        p2.x -= cfg.MOVE_SPEED;
        p2.vx = -cfg.MOVE_SPEED;
        p2.facingDir = -1;
      }
      if (players[0].keys.l.held) {
        p2.x += cfg.MOVE_SPEED;
        p2.vx = cfg.MOVE_SPEED;
        p2.facingDir = 1;
      }
      // Jump
      if (players[0].keys.i.down && p2.grounded) {
        p2.vy = cfg.JUMP_VELOCITY;
        p2.grounded = false;
      }
    }
  },
});

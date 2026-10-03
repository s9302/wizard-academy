// The local player's movement, using Rapier's kinematic character controller.
//
// Game-dev notes:
// - A "kinematic" body is moved by our code, not pushed around by physics.
//   Each step we say where we *want* to go, and the character controller
//   slides that movement along walls, up small steps and slopes, and tells us
//   whether we're standing on the ground.
// - Gravity and jumping are just a vertical speed we manage ourselves.
// - "Coyote time": you can still jump for a moment after walking off a ledge.
//   "Jump buffering": pressing jump just before landing still counts. Both
//   make platforming feel fair instead of frame-perfect.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
  FALL_RESPAWN_Y,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  RUN_SPEED,
  TERMINAL_FALL_SPEED,
  WALK_SPEED,
} from "../../shared/src/constants.ts";
import type { Input } from "./Input.ts";

const COYOTE_TIME = 0.1; // seconds
const JUMP_BUFFER_TIME = 0.12; // seconds

export class PlayerController {
  // Interpolated position for rendering (see Game.ts for why).
  readonly renderPosition = new THREE.Vector3();

  private world: RAPIER.World;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private velocityY = 0;
  private grounded = false;
  private timeSinceGrounded = 0;
  private timeSinceJumpPressed = Infinity;
  private previous = new THREE.Vector3();
  private current = new THREE.Vector3();

  constructor(world: RAPIER.World) {
    this.world = world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS),
      this.body,
    );

    this.controller = world.createCharacterController(0.02); // small skin gap
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller.enableAutostep(0.35, 0.2, false); // walk up stairs up to 35 cm
    this.controller.enableSnapToGround(0.3); // stick to the ground going down ramps
  }

  get position(): THREE.Vector3 {
    return this.current;
  }

  // Fell off the level; Game asks the server where to respawn.
  get fellOut(): boolean {
    return this.current.y < FALL_RESPAWN_Y;
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.current.set(x, y, z);
    this.previous.copy(this.current);
    this.velocityY = 0;
  }

  // Advance one fixed physics step of length dt seconds.
  step(dt: number, input: Input): void {
    this.previous.copy(this.current);

    // Horizontal movement relative to where the camera faces.
    const speed = input.running ? RUN_SPEED : WALK_SPEED;
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    let dx = -sin * input.forward + cos * input.strafe;
    let dz = -cos * input.forward - sin * input.strafe;
    const length = Math.hypot(dx, dz);
    if (length > 1) {
      // Don't let diagonal movement be faster than straight movement.
      dx /= length;
      dz /= length;
    }

    // Jumping, with coyote time and jump buffering.
    this.timeSinceJumpPressed = input.consumeJump() ? 0 : this.timeSinceJumpPressed + dt;
    this.timeSinceGrounded = this.grounded ? 0 : this.timeSinceGrounded + dt;
    if (this.timeSinceJumpPressed <= JUMP_BUFFER_TIME && this.timeSinceGrounded <= COYOTE_TIME) {
      this.velocityY = JUMP_SPEED;
      this.timeSinceJumpPressed = Infinity;
      this.timeSinceGrounded = Infinity;
    }

    // Gravity.
    this.velocityY = Math.max(this.velocityY - GRAVITY * dt, -TERMINAL_FALL_SPEED);

    const desired = { x: dx * speed * dt, y: this.velocityY * dt, z: dz * speed * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    if (this.grounded && this.velocityY < 0) this.velocityY = 0;
    // Bumped our head on a ceiling: stop rising.
    if (this.velocityY > 0 && moved.y < desired.y * 0.5) this.velocityY = 0;

    const t = this.body.translation();
    this.current.set(t.x + moved.x, t.y + moved.y, t.z + moved.z);
    this.body.setNextKinematicTranslation(this.current);
    this.world.step();
  }

  // Blend between the last two physics steps. alpha is 0..1.
  interpolate(alpha: number): THREE.Vector3 {
    return this.renderPosition.lerpVectors(this.previous, this.current, alpha);
  }
}

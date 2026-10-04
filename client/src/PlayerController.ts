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
// - Perks (unlocked by leveling): a second jump in mid-air, and a short dash.
//   The server's movement check already allows short bursts (it's built for
//   lag spikes), so a dash fits inside it.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import {
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
const DOUBLE_JUMP_SPEED = JUMP_SPEED * 0.85;
const DASH_SPEED = 22; // m/s, for DASH_TIME: about 3.5 m
const DASH_TIME = 0.16;
export const DASH_COOLDOWN = 2; // seconds

export type Perks = { doubleJump: boolean; dash: boolean };
const FLY_SPEED = 10; // m/s (Shift doubles it)

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
  private killY: number;
  perks: Perks = { doubleJump: false, dash: false };
  flying = false; // admins only: no gravity, no walls
  speedMul = 1; // battle royale class (and the Knight's raised shield)
  private airJumpUsed = false;
  private dashLeft = 0; // seconds of dash (or charge) remaining
  private burstSpeed = DASH_SPEED;
  private dashDir = { x: 0, z: 0 };
  dashCooldown = 0; // seconds until the dash is ready
  // What happened since the game last looked (for sounds): read, then reset.
  events = { jumped: false, dashed: false, landed: 0, walked: 0 };
  private slowLeft = 0; // seconds of Frost Shard slow remaining
  private slowFactor = 1;
  private previous = new THREE.Vector3();
  private current = new THREE.Vector3();

  constructor(world: RAPIER.World, killY: number) {
    this.world = world;
    this.killY = killY;
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

  // Meters per second, up positive (sounds use it for jumps and landings).
  get verticalSpeed(): number {
    return this.velocityY;
  }

  // The player's own collider (the third-person camera's ray skips it).
  get colliderHandle(): number {
    return this.collider.handle;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  // Fell off the level; Game asks the server where to respawn.
  get fellOut(): boolean {
    return !this.flying && this.current.y < this.killY;
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
    this.current.set(x, y, z);
    this.previous.copy(this.current);
    this.velocityY = 0;
  }

  // A Knight's charge: rush flat along (x, z) at `speed` for `seconds`.
  burst(x: number, z: number, speed: number, seconds: number): void {
    const len = Math.hypot(x, z) || 1;
    this.dashDir = { x: x / len, z: z / len };
    this.burstSpeed = speed;
    this.dashLeft = seconds;
  }

  // Landed on someone's head: bounce off them.
  bounce(): void {
    this.velocityY = JUMP_SPEED * 1.1;
  }

  // Hit by Frost Shard: move at `factor` speed for `seconds`.
  slow(seconds: number, factor: number): void {
    this.slowLeft = seconds;
    this.slowFactor = factor;
  }

  // Admin flight: move freely in the look direction's plane, Space up, C down.
  private fly(dt: number, input: Input): void {
    const speed = FLY_SPEED * (input.running ? 2 : 1);
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    const dx = -sin * input.forward + cos * input.strafe;
    const dz = -cos * input.forward - sin * input.strafe;
    const len = Math.max(1, Math.hypot(dx, dz));
    const dy = (input.ascend ? 1 : 0) - (input.descend ? 1 : 0);
    input.consumeJump();
    this.velocityY = 0;
    this.current.set(this.current.x + (dx / len) * speed * dt, this.current.y + dy * speed * dt, this.current.z + (dz / len) * speed * dt);
    this.body.setNextKinematicTranslation(this.current);
    this.body.setTranslation(this.current, true);
    this.world.step();
  }

  // Advance one fixed physics step of length dt seconds.
  step(dt: number, input: Input): void {
    this.previous.copy(this.current);
    if (this.flying) return this.fly(dt, input);
    this.slowLeft = Math.max(0, this.slowLeft - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    // Horizontal movement relative to where the camera faces.
    const speed = (input.running ? RUN_SPEED : WALK_SPEED) * this.speedMul * (this.slowLeft > 0 ? this.slowFactor : 1);
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
    if (this.grounded) this.airJumpUsed = false;
    if (this.timeSinceJumpPressed <= JUMP_BUFFER_TIME && this.timeSinceGrounded <= COYOTE_TIME) {
      this.velocityY = JUMP_SPEED;
      this.events.jumped = true;
      this.timeSinceJumpPressed = Infinity;
      this.timeSinceGrounded = Infinity;
    } else if (this.perks.doubleJump && this.timeSinceJumpPressed === 0 && !this.grounded && !this.airJumpUsed) {
      // Double jump: once per time in the air.
      this.velocityY = DOUBLE_JUMP_SPEED;
      this.events.jumped = true;
      this.airJumpUsed = true;
      this.timeSinceJumpPressed = Infinity;
    }

    // Dash: a short burst the way you're moving (or looking, if standing still).
    if (this.perks.dash && input.consumeDash() && this.dashCooldown === 0) {
      const moving = dx !== 0 || dz !== 0;
      const len = moving ? Math.hypot(dx, dz) : 1;
      this.dashDir = moving ? { x: dx / len, z: dz / len } : { x: -sin, z: -cos };
      this.dashLeft = DASH_TIME;
      this.burstSpeed = DASH_SPEED;
      this.dashCooldown = DASH_COOLDOWN;
      this.events.dashed = true;
    }
    let hx = dx * speed;
    let hz = dz * speed;
    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
      hx = this.dashDir.x * this.burstSpeed;
      hz = this.dashDir.z * this.burstSpeed;
      this.velocityY = Math.max(this.velocityY, 0); // no falling mid-dash
    }

    // Gravity.
    this.velocityY = Math.max(this.velocityY - GRAVITY * dt, -TERMINAL_FALL_SPEED);

    const desired = { x: hx * dt, y: this.velocityY * dt, z: hz * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && !wasGrounded && this.velocityY < 0) this.events.landed = Math.max(this.events.landed, -this.velocityY);
    if (this.grounded) this.events.walked += Math.hypot(moved.x, moved.z);

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

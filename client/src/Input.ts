// Keyboard state and mouse look. Mouse look uses the browser's Pointer Lock
// API: after a click, the cursor is hidden and we get raw mouse movement.

const MOUSE_SENSITIVITY = 0.0022; // radians per pixel
const MAX_PITCH = Math.PI / 2 - 0.01; // just short of straight up/down

export class Input {
  yaw = 0; // left/right look, radians
  pitch = 0; // up/down look, radians
  private keys = new Set<string>();
  private jumpQueued = false;
  private restartQueued = false;
  private clickQueued = false;
  private rightClickQueued = false;
  private dashQueued = false;
  private interactQueued = false;
  private flyQueued = false;
  private handQueued: "main" | "backup" | "toggle" | null = null;
  private lastWheel = 0;
  private element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.repeat) this.jumpQueued = true;
      if (e.code === "KeyR" && !e.repeat && this.locked) this.restartQueued = true;
      if (e.code === "KeyQ" && !e.repeat && this.locked) this.dashQueued = true;
      if (e.code === "KeyE" && !e.repeat && this.locked) this.interactQueued = true;
      if (e.code === "KeyF" && !e.repeat && this.locked) this.flyQueued = true;
      if (e.code === "KeyV" && !e.repeat && this.locked) this.viewQueued = true;
      if (e.code === "Digit1" && this.locked) this.handQueued = "main";
      if (e.code === "Digit2" && this.locked) this.handQueued = "backup";
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    // Forget held keys when the window loses focus, or the player keeps walking.
    window.addEventListener("blur", () => this.keys.clear());

    document.addEventListener("mousedown", (e) => {
      if (e.button === 0 && this.locked) this.clickQueued = true;
      if (e.button === 2 && this.locked) this.rightClickQueued = true;
    });
    // Right-click is a spell while playing, not the browser menu.
    document.addEventListener("contextmenu", (e) => {
      if (this.locked) e.preventDefault();
    });

    // The mouse wheel swaps hands. Trackpads send a stream of wheel events
    // per gesture, so at most one swap every 350 ms.
    document.addEventListener("wheel", (e) => {
      if (!this.locked || Math.abs(e.deltaY) < 1 || e.timeStamp - this.lastWheel < 350) return;
      this.lastWheel = e.timeStamp;
      this.handQueued = "toggle";
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch -= e.movementY * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  lock(): void {
    // Some browsers return a promise that rejects if called too soon after Esc.
    Promise.resolve(this.element.requestPointerLock()).catch(() => {});
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  // -1..1 on each axis, relative to where the player is looking.
  get forward(): number {
    return (this.down("KeyW", "ArrowUp") ? 1 : 0) - (this.down("KeyS", "ArrowDown") ? 1 : 0);
  }

  get strafe(): number {
    return (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0);
  }

  get running(): boolean {
    return this.down("ShiftLeft", "ShiftRight");
  }

  // Returns true once per left click while playing (tag someone).
  consumeClick(): boolean {
    const queued = this.clickQueued;
    this.clickQueued = false;
    return queued;
  }

  // Returns true once per right click while playing (battle royale: fireball).
  consumeRightClick(): boolean {
    const queued = this.rightClickQueued;
    this.rightClickQueued = false;
    return queued;
  }

  // Returns true once per Q press (Blink Dash perk).
  consumeDash(): boolean {
    const queued = this.dashQueued;
    this.dashQueued = false;
    return queued;
  }

  // Admin flying: up and down while held.
  get ascend(): boolean {
    return this.down("Space");
  }

  get descend(): boolean {
    return this.down("KeyC");
  }

  // Battle royale: which hand to switch to, once per press.
  consumeHand(): "main" | "backup" | "toggle" | null {
    const queued = this.handQueued;
    this.handQueued = null;
    return queued;
  }

  private viewQueued = false;
  // Returns true once per V press (first / third person).
  consumeView(): boolean {
    const queued = this.viewQueued;
    this.viewQueued = false;
    return queued;
  }

  // Returns true once per F press (admins: toggle flying).
  consumeFly(): boolean {
    const queued = this.flyQueued;
    this.flyQueued = false;
    return queued;
  }

  // Returns true once per E press (use a station in the hub).
  consumeInteract(): boolean {
    const queued = this.interactQueued;
    this.interactQueued = false;
    return queued;
  }

  // Returns true once per R press (parkour: restart the run).
  consumeRestart(): boolean {
    const queued = this.restartQueued;
    this.restartQueued = false;
    return queued;
  }

  // Returns true once per Space press.
  consumeJump(): boolean {
    const queued = this.jumpQueued;
    this.jumpQueued = false;
    return queued;
  }
}

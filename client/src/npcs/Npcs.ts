// People in the world who aren't players: teachers and trial guides you can
// talk to (props of kind "npc"), and students who wander the academy
// grounds ("student"). All of it runs in your own browser only; the server
// never hears about them, so they cost it nothing.
//
// To keep them cheap for your computer too, anyone far away stops animating
// and, further still, isn't drawn at all.

import * as THREE from "three";
import { randomAppearance } from "../../../shared/src/appearance.ts";
import type { Level } from "../../../shared/src/levels/types.ts";
import { NPCS, STUDENT_LINES } from "../../../shared/src/npcs.ts";
import { DEFAULT_LOOK, type Look, ROBES } from "../../../shared/src/unlocks.ts";
import { animateAvatar, createAvatar, disposeAvatar } from "../Avatar.ts";
import { sound } from "../audio/Sound.ts";

const TALK_REACH = 2.8;
const ANIMATE_RANGE = 45;
const DRAW_RANGE = 80;
const WANDER_RADIUS = 7;
const STUDENT_SPEED = 1.3;

type Person = {
  name: string;
  avatar: THREE.Group;
  home: THREE.Vector3; // feet height is home.y
  lines: string[];
  student: boolean;
  radius: number; // how far from home a student wanders
  target: THREE.Vector3 | null;
  waitUntil: number;
  speed: number;
  yaw: number;
};

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export class Npcs {
  private scene: THREE.Object3D;
  private people: Person[] = [];
  private box: HTMLElement;
  private nameEl: HTMLElement;
  private lineEl: HTMLElement;
  private talking: { person: Person; line: number } | null = null;

  constructor(scene: THREE.Object3D, level: Level) {
    this.scene = scene;
    seed = 777;
    let studentNo = 0;
    for (const prop of level.props ?? []) {
      if (prop.kind !== "npc" && prop.kind !== "student") continue;
      const def = prop.talk ? NPCS[prop.talk] : undefined;
      const student = prop.kind === "student";
      const look: Look = def?.look ?? {
        ...DEFAULT_LOOK,
        ...randomAppearance(studentNo * 131 + 17),
        robe: ROBES[1 + (studentNo % (ROBES.length - 1))],
      };
      const name = def?.name ?? prop.name ?? "Student";
      const avatar = createAvatar(5000 + studentNo++, name, look, false, { nameTag: !student, tagColor: "#ffe58a" });
      const home = new THREE.Vector3(...prop.pos);
      avatar.position.set(home.x, home.y + 0.9, home.z);
      avatar.rotation.y = prop.yaw ?? 0;
      scene.add(avatar);
      this.people.push({
        name,
        avatar,
        home,
        lines: def?.lines ?? [STUDENT_LINES[Math.floor(rand() * STUDENT_LINES.length)]],
        radius: prop.scale ?? WANDER_RADIUS,
        student,
        target: null,
        waitUntil: rand() * 4000,
        speed: 0,
        yaw: prop.yaw ?? 0,
      });
    }
    this.box = document.getElementById("dialogue")!;
    this.nameEl = document.getElementById("dialogue-name")!;
    this.lineEl = document.getElementById("dialogue-line")!;
  }

  get count(): number {
    return this.people.length;
  }

  // Who's close enough to talk to (for the "E · Talk to ..." hint), or null.
  nearest(p: THREE.Vector3): string | null {
    const person = this.closest(p);
    return person ? person.name : null;
  }

  private closest(p: THREE.Vector3): Person | null {
    let best: Person | null = null;
    let bestD = TALK_REACH;
    for (const person of this.people) {
      const d = Math.hypot(person.avatar.position.x - p.x, person.avatar.position.z - p.z);
      if (d < bestD && Math.abs(person.avatar.position.y - p.y) < 2) {
        best = person;
        bestD = d;
      }
    }
    return best;
  }

  get isTalking(): boolean {
    return this.talking !== null;
  }

  // E: start talking to whoever is nearest, or show the next line.
  // Returns true if E was used up here.
  interact(p: THREE.Vector3): boolean {
    if (this.talking) {
      this.talking.line++;
      if (this.talking.line >= this.talking.person.lines.length) this.stop();
      else this.show();
      sound.play("select", { volume: 0.4 });
      return true;
    }
    const person = this.closest(p);
    if (!person) return false;
    this.talking = { person, line: 0 };
    person.target = null; // stop wandering to talk
    sound.play("bookOpen", { volume: 0.5 });
    this.show();
    return true;
  }

  private show(): void {
    const t = this.talking!;
    this.nameEl.textContent = t.person.name; // textContent: plain text only
    this.lineEl.textContent = t.person.lines[t.line];
    const last = t.line === t.person.lines.length - 1;
    this.box.dataset.more = last ? "E to close" : "E for more";
    this.box.hidden = false;
  }

  stop(): void {
    this.talking = null;
    this.box.hidden = true;
  }

  update(time: number, dt: number, player: THREE.Vector3): void {
    const now = time * 1000;
    // Walked off mid-conversation.
    if (this.talking && this.talking.person.avatar.position.distanceTo(player) > TALK_REACH + 2.5) this.stop();
    for (const person of this.people) {
      const a = person.avatar;
      const d = a.position.distanceTo(player);
      a.visible = d < DRAW_RANGE;
      if (d > ANIMATE_RANGE) continue;
      const talkingToMe = this.talking?.person === person;
      let moving = false;
      if (person.student && !talkingToMe) {
        if (!person.target && now >= person.waitUntil) {
          const ang = rand() * Math.PI * 2;
          const r = rand() * person.radius;
          person.target = new THREE.Vector3(person.home.x + Math.cos(ang) * r, person.home.y, person.home.z + Math.sin(ang) * r);
        }
        if (person.target) {
          const dx = person.target.x - a.position.x;
          const dz = person.target.z - a.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.2) {
            person.target = null;
            person.waitUntil = now + 2000 + rand() * 6000;
          } else {
            const step = Math.min(dist, STUDENT_SPEED * dt);
            a.position.x += (dx / dist) * step;
            a.position.z += (dz / dist) * step;
            person.yaw = Math.atan2(-dx, -dz);
            moving = true;
          }
        }
      }
      // Turn to face you when you're close (or talking).
      if (!moving && (d < 5 || talkingToMe)) person.yaw = Math.atan2(-(player.x - a.position.x), -(player.z - a.position.z));
      let diff = person.yaw - a.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      a.rotation.y += diff * Math.min(1, dt * 6);
      person.speed += ((moving ? STUDENT_SPEED : 0) - person.speed) * Math.min(1, dt * 8);
      animateAvatar(a, now, person.speed);
    }
  }

  dispose(): void {
    this.stop();
    for (const person of this.people) {
      this.scene.remove(person.avatar);
      disposeAvatar(person.avatar);
    }
    this.people = [];
  }
}

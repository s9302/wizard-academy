// Page setup: the name form, pointer lock, and starting the game.

import RAPIER from "@dimforge/rapier3d-compat";
import { Game } from "./Game.ts";
import { Input } from "./Input.ts";
import "./style.css";

const container = document.getElementById("game")!;
const overlay = document.getElementById("overlay")!;
const form = document.getElementById("join-form") as HTMLFormElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const message = document.getElementById("overlay-message")!;
const resumeHint = document.getElementById("resume-hint")!;
const hud = document.getElementById("hud")!;

const NAME_KEY = "wizard-name";
try {
  nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
} catch {
  // storage can be blocked; the name just won't be remembered
}

const input = new Input(container);
let game: Game | null = null;
let disconnected = false;

// Show the overlay whenever the mouse is released (Esc), hide it when captured.
document.addEventListener("pointerlockchange", () => {
  if (!game || disconnected) return;
  overlay.hidden = input.locked;
});

overlay.addEventListener("click", () => {
  if (game && !disconnected) input.lock();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }

  // Must be requested right away, while the click still counts as a user action.
  input.lock();
  form.hidden = true;
  message.textContent = "";
  resumeHint.hidden = false;

  await RAPIER.init(); // loads the physics engine (WebAssembly)
  hud.hidden = false;
  game = new Game(container, input, name, (reason) => {
    disconnected = true;
    document.exitPointerLock();
    overlay.hidden = false;
    resumeHint.hidden = true;
    message.textContent = `${reason} Reload the page to rejoin.`;
  });
});

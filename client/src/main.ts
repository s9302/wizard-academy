// Page setup: the name form, pointer lock, and starting the game.

import RAPIER from "@dimforge/rapier3d-compat";
import { LEVELS } from "../../shared/src/levels/index.ts";
import { Game } from "./Game.ts";
import { Input } from "./Input.ts";
import "./style.css";

const container = document.getElementById("game")!;
const overlay = document.getElementById("overlay")!;
const form = document.getElementById("join-form") as HTMLFormElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const roomSelect = document.getElementById("room") as HTMLSelectElement;
const message = document.getElementById("overlay-message")!;
const resumeHint = document.getElementById("resume-hint")!;
const hud = document.getElementById("hud")!;

const NAME_KEY = "wizard-name";

// Until the hub exists (Phase 6), you pick a level here.
for (const level of Object.values(LEVELS)) {
  const option = document.createElement("option");
  option.value = level.id;
  option.textContent = level.name;
  roomSelect.appendChild(option);
}
try {
  // Don't overwrite a name typed while the game was still loading.
  const saved = localStorage.getItem(NAME_KEY);
  if (saved && !nameInput.value) nameInput.value = saved;
} catch {
  // storage can be blocked; the name just won't be remembered
}

// The button stays disabled until this script has loaded; otherwise a quick
// click would submit the form as a plain page reload.
const enterButton = form.querySelector("button")!;
enterButton.disabled = false;
enterButton.textContent = "Enter";

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
  const level = LEVELS[roomSelect.value];
  if (!name || !level) return;
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
  game = new Game(container, input, name, level, (reason) => {
    disconnected = true;
    document.exitPointerLock();
    overlay.hidden = false;
    resumeHint.hidden = true;
    message.textContent = `${reason} Reload the page to rejoin.`;
  });
});

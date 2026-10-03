// Page setup: logging in, the room picker, pointer lock, and starting the game.

import RAPIER from "@dimforge/rapier3d-compat";
import { LEVELS } from "../../shared/src/levels/index.ts";
import { levelInfo } from "../../shared/src/progression.ts";
import { findRoom, ROOMS } from "../../shared/src/rooms.ts";
import { Game } from "./Game.ts";
import { Input } from "./Input.ts";
import { formatTime } from "./ParkourHud.ts";
import "./style.css";

type Profile = { username: string; xp: number; bestTimes: Record<string, number> };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const container = $("game");
const overlay = $("overlay");
const authForm = $<HTMLFormElement>("auth-form");
const usernameInput = $<HTMLInputElement>("username");
const passwordInput = $<HTMLInputElement>("password");
const loginButton = $<HTMLButtonElement>("login-button");
const registerButton = $<HTMLButtonElement>("register-button");
const profileBox = $("profile");
const joinForm = $<HTMLFormElement>("join-form");
const roomSelect = $<HTMLSelectElement>("room");
const enterButton = joinForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
const logoutButton = $<HTMLButtonElement>("logout-button");
const message = $("overlay-message");
const resumeHint = $("resume-hint");
const exitButton = $<HTMLButtonElement>("exit-button");
const hud = $("hud");

let profile: Profile | null = null;

// Until the hub exists (Phase 6), you pick a room here.
for (const room of ROOMS) {
  const option = document.createElement("option");
  option.value = room.id;
  option.textContent = room.name;
  roomSelect.appendChild(option);
}

// ---- Accounts ----

async function api(path: string, body?: object): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON reply
  }
  return { status: res.status, data };
}

function showLoggedOut(error = ""): void {
  profile = null;
  authForm.hidden = false;
  profileBox.hidden = true;
  joinForm.hidden = true;
  message.textContent = error;
  usernameInput.focus();
}

function showProfile(p: Profile): void {
  profile = p;
  authForm.hidden = true;
  passwordInput.value = "";
  message.textContent = "";
  profileBox.hidden = false;
  joinForm.hidden = false;

  const info = levelInfo(p.xp);
  $("profile-name").textContent = `${p.username} · Level ${info.level}`;
  $("profile-xp-fill").style.width = `${(100 * info.intoLevel) / info.forNext}%`;
  $("profile-xp-text").textContent = `${info.intoLevel} / ${info.forNext} XP to level ${info.level + 1}`;

  const times = $("profile-times");
  times.replaceChildren();
  for (const room of ROOMS.filter((r) => r.mode === "parkour")) {
    const row = document.createElement("div");
    const best = p.bestTimes[room.id];
    row.textContent = `${room.name.split(":")[0]}: ${best ? formatTime(best) : "not cleared yet"}`;
    times.appendChild(row);
  }
}

async function submitCredentials(path: "/api/login" | "/api/register"): Promise<void> {
  if (!authForm.reportValidity()) return;
  loginButton.disabled = registerButton.disabled = true;
  try {
    const { status, data } = await api(path, { username: usernameInput.value.trim(), password: passwordInput.value });
    if (status === 200 || status === 201) showProfile(data as unknown as Profile);
    else message.textContent = String(data.error ?? "Something went wrong.");
  } catch {
    message.textContent = "Couldn't reach the server.";
  } finally {
    loginButton.disabled = registerButton.disabled = false;
  }
}

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  submitCredentials("/api/login");
});
registerButton.addEventListener("click", () => {
  passwordInput.autocomplete = "new-password";
  submitCredentials("/api/register");
});
logoutButton.addEventListener("click", async () => {
  await api("/api/logout", {}).catch(() => {});
  showLoggedOut();
});

// Logged in already (cookie from a previous visit)?
api("/api/me")
  .then(({ status, data }) => (status === 200 ? showProfile(data as unknown as Profile) : showLoggedOut()))
  .catch(() => showLoggedOut("Couldn't reach the server."));

// The Enter button stays disabled until this script has loaded; otherwise a
// quick click would submit the form as a plain page reload.
enterButton.disabled = false;
enterButton.textContent = "Enter";

// ---- Playing ----

const input = new Input(container);
let game: Game | null = null;
let rapierReady: Promise<void> | null = null;

// Show the pause panel whenever the mouse is released (Esc), hide it when captured.
document.addEventListener("pointerlockchange", () => {
  if (!game) return;
  overlay.hidden = input.locked;
});

overlay.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button, select, input")) return;
  if (game) input.lock();
});

// Leave the room and go back to the profile and room picker. Used by the Exit
// button and when the connection drops (then with the reason why).
async function backToMenu(reason = ""): Promise<void> {
  game?.dispose();
  game = null;
  document.exitPointerLock();
  hud.hidden = true;
  exitButton.hidden = true;
  resumeHint.hidden = true;
  overlay.hidden = false;
  try {
    // Fresh profile: XP and best times may have changed while playing.
    const { status, data } = await api("/api/me");
    if (status === 200) showProfile(data as unknown as Profile);
    else showLoggedOut();
  } catch {
    // Server unreachable; keep the old profile so they can try again.
    if (profile) showProfile(profile);
  }
  message.textContent = reason;
}

exitButton.addEventListener("click", () => backToMenu());

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const room = findRoom(roomSelect.value);
  const level = room && LEVELS[room.levelId];
  if (!profile || !room || !level || game) return;

  // Must be requested right away, while the click still counts as a user action.
  input.lock();
  joinForm.hidden = true;
  profileBox.hidden = true;
  message.textContent = "";
  resumeHint.hidden = false;
  exitButton.hidden = false;

  rapierReady ??= RAPIER.init(); // loads the physics engine (WebAssembly) once
  await rapierReady;
  hud.hidden = false;
  game = new Game(container, input, profile.username, profile.xp, room, level, (reason) => backToMenu(reason));
  overlay.hidden = input.locked;
});

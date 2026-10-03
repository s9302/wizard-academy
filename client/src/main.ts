// Page setup: logging in, the room picker, pointer lock, and starting the game.

import RAPIER from "@dimforge/rapier3d-compat";
import { LEVELS } from "../../shared/src/levels/index.ts";
import { levelInfo } from "../../shared/src/progression.ts";
import { findRoom, HUB_ROOM, ROOMS, type RoomInfo } from "../../shared/src/rooms.ts";
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
const enterButton = joinForm.querySelector<HTMLButtonElement>("button[type=submit]")!;
const logoutButton = $<HTMLButtonElement>("logout-button");
const message = $("overlay-message");
const resumeHint = $("resume-hint");
const exitButton = $<HTMLButtonElement>("exit-button");
const fade = $("fade");
const hud = $("hud");

let profile: Profile | null = null;

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
enterButton.textContent = "Enter the Academy";

// ---- Playing ----

const input = new Input(container);
let game: Game | null = null;
let current: RoomInfo | null = null;
let switching = false;
let rapierReady: Promise<void> | null = null;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Dev server only (stripped from production builds): lets browser tests
// reach the running game, e.g. to put the player next to a portal.
if (import.meta.env.DEV) Object.assign(window, { wa: { get game() { return game; } } });

// Show the pause panel whenever the mouse is released (Esc), hide it when captured.
document.addEventListener("pointerlockchange", () => {
  if (!game) return;
  overlay.hidden = input.locked;
});

overlay.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button, select, input")) return;
  if (game) input.lock();
});

// Latest XP and best times, without touching the menu.
async function fetchProfile(): Promise<void> {
  try {
    const { status, data } = await api("/api/me");
    if (status === 200) profile = data as unknown as Profile;
  } catch {
    // keep what we had
  }
}

function startGame(room: RoomInfo, from?: string): Game | null {
  const level = LEVELS[room.levelId];
  if (!profile || !level) return null;
  current = room;
  hud.hidden = false;
  exitButton.hidden = false;
  exitButton.textContent = room.id === HUB_ROOM ? "Exit to menu" : "Back to the Academy";
  game = new Game(container, input, {
    name: profile.username,
    xp: profile.xp,
    room,
    level,
    from,
    bestTimes: profile.bestTimes,
    onDisconnect: (reason) => backToMenu(reason),
    onPortal: (roomId) => switchRoom(roomId),
  });
  return game;
}

// Walk through a portal (or come back to the hub): fade out, leave this room,
// join the next, fade back in once the server has welcomed us.
async function switchRoom(roomId: string): Promise<void> {
  const room = findRoom(roomId);
  if (!room || !game || !current || switching) return;
  switching = true;
  const from = current.id;
  const portal = LEVELS[current.levelId]?.portals?.find((x) => x.room === roomId);
  fade.style.background = portal?.color ?? "#b48cff";
  fade.classList.add("show");
  await Promise.all([sleep(250), game.dispose()]);
  game = null;
  if (room.id === HUB_ROOM) await fetchProfile(); // fresh XP and best times for the signs
  const next = startGame(room, from);
  if (next) await Promise.race([next.ready, sleep(5000)]);
  fade.classList.remove("show");
  // The mouse may have been captured (or released) while no game was running.
  if (game) overlay.hidden = input.locked;
  switching = false;
}

// Leave the game and go back to the profile screen. Used by Exit (in the hub)
// and when the connection drops (then with the reason why).
async function backToMenu(reason = ""): Promise<void> {
  const leaving = game;
  game = null;
  current = null;
  await leaving?.dispose();
  document.exitPointerLock();
  fade.classList.remove("show");
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

exitButton.addEventListener("click", () => {
  if (!current || switching) return;
  if (current.id === HUB_ROOM) {
    backToMenu();
  } else {
    input.lock(); // still inside the click, so the browser allows it
    switchRoom(HUB_ROOM);
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const hub = findRoom(HUB_ROOM);
  if (!profile || !hub || game || switching) return;
  switching = true;

  // Must be requested right away, while the click still counts as a user action.
  input.lock();
  joinForm.hidden = true;
  profileBox.hidden = true;
  message.textContent = "";
  resumeHint.hidden = false;

  rapierReady ??= RAPIER.init(); // loads the physics engine (WebAssembly) once
  await rapierReady;
  startGame(hub);
  overlay.hidden = input.locked;
  switching = false;
});

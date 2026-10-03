// Settings from environment variables (set in .env, passed in by Docker
// Compose). The server refuses to start with a missing or weak secret rather
// than running with an open gate.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}. See .env.example.`);
    process.exit(1);
  }
  return value;
}

const pin = required("GAME_PIN");
if (pin.length < 6) {
  console.error("GAME_PIN must be at least 6 characters.");
  process.exit(1);
}

const sessionSecret = required("SESSION_SECRET");
if (sessionSecret.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters (try: openssl rand -hex 32).");
  process.exit(1);
}

const cookieSecure = (process.env.COOKIE_SECURE ?? "true").toLowerCase();
if (cookieSecure !== "true" && cookieSecure !== "false") {
  console.error('COOKIE_SECURE must be "true" or "false".');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  pin,
  sessionSecret,
  // Secure cookies are only sent over HTTPS. Turn off for plain-HTTP testing.
  cookieSecure: cookieSecure === "true",
};

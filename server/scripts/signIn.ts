// Shared by the test scripts: get past the PIN gate, then log in to a test
// account (creating it the first time). Returns the Cookie header to send.
//
// Several connections can share one account, so each script uses a single
// account for all its fake players (account creation is rate-limited).

export async function signIn(base: string, pin: string, username: string, password = "test-password-123"): Promise<string> {
  const gate = await fetch(`${base}/auth/pin`, { method: "POST", body: new URLSearchParams({ pin }), redirect: "manual" });
  const pinCookie = gate.headers.get("set-cookie")?.split(";")[0];
  if (gate.status !== 303 || !pinCookie) throw new Error(`PIN rejected: HTTP ${gate.status}`);

  const headers = { "content-type": "application/json", cookie: pinCookie };
  const body = JSON.stringify({ username, password });
  let res = await fetch(`${base}/api/login`, { method: "POST", headers, body });
  if (res.status === 401) res = await fetch(`${base}/api/register`, { method: "POST", headers, body });
  const accountCookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!res.ok || !accountCookie) throw new Error(`account sign-in failed: HTTP ${res.status} ${await res.text()}`);
  return `${pinCookie}; ${accountCookie}`;
}

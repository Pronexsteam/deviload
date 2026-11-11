import test from "node:test";
import assert from "node:assert/strict";
// A tiny DOM: enough elements to hold text, children, data and click handlers.
const element = tag => {
  const node = { tag, children: [], handlers: {}, dataset: {}, textContent: "", className: "", disabled: false };
  node.append = (...items) => node.children.push(...items);
  node.addEventListener = (name, fn) => (node.handlers[name] = fn);
  node.insertBefore = item => node.children.push(item);
  node.setAttribute = (key, value) => (node[key] = value);
  return node;
};
globalThis.document ??= { documentElement: { lang: "en" }, createElement: element };
const { wireMusicAccount, ACCOUNTS } = await import("../src/music-account.js");
const { t } = await import("../src/i18n.js");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(signed = { youtube: false, spotify: false }) {
  const calls = [],
    events = {};
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "youtube_login_status") return signed.youtube ? "path" : null;
    if (command === "spotify_account_status") return signed.spotify;
    if (command === "youtube_sign_out") signed.youtube = false;
    if (command === "spotify_sign_out") signed.spotify = false;
    return null;
  };
  const host = element("div");
  wireMusicAccount({ invoke, host, listen: (name, fn) => (events[name] = fn) });
  const box = host.children[0];
  const rows = Object.fromEntries(box.children.filter(c => c.dataset?.account).map(r => [r.dataset.account, r]));
  const parts = row => ({ logo: row.children[0], state: row.children[1].children[1], button: row.children[2] });
  return { calls, events, signed, rows, parts };
}

test("both services sit side by side with their logos and their own sign-in buttons", async () => {
  const { rows, parts } = setup();
  await settle();
  assert.deepEqual(Object.keys(rows), ["youtube", "spotify"]);
  const youtube = parts(rows.youtube),
    spotify = parts(rows.spotify);
  assert.match(youtube.logo.className, /music-account-logo-youtube/, "YouTube's one-colour mark is tinted red in CSS");
  assert.equal(spotify.logo.src, "assets/brands/spotify.svg");
  assert.equal(youtube.button.textContent, t("Sign in with YouTube"));
  assert.equal(spotify.button.textContent, t("Sign in with Spotify"));
  assert.match(youtube.button.className, /music-account-in-youtube/);
  assert.match(spotify.button.className, /music-account-in-spotify/);
  assert.equal(spotify.state.textContent, ACCOUNTS[1].off());
});

test("each button opens its own sign-in, and a saved session turns it into Sign out", async () => {
  const { calls, events, signed, rows, parts } = setup();
  await settle();
  await parts(rows.youtube).button.handlers.click();
  assert.deepEqual(calls.at(-1), ["open_youtube", { signIn: true }]);
  await parts(rows.spotify).button.handlers.click();
  assert.deepEqual(calls.at(-1), ["spotify_sign_in", {}]);
  // The Spotify window saved its session.
  signed.spotify = true;
  await events["spotify-session"]();
  const spotify = parts(rows.spotify);
  assert.equal(spotify.button.textContent, t("Sign out"));
  assert.equal(rows.spotify.dataset.signedIn, "true");
  assert.equal(spotify.state.textContent, ACCOUNTS[1].on());
  // YouTube is untouched by Spotify's sign-in.
  assert.equal(parts(rows.youtube).button.textContent, t("Sign in with YouTube"));
  await spotify.button.handlers.click();
  assert.deepEqual(calls.at(-1), ["spotify_sign_out", undefined]);
  assert.equal(spotify.button.textContent, t("Sign in with Spotify"));
});

test("the sign-ins never go anywhere but their own local commands", async () => {
  const { calls, rows, parts } = setup({ youtube: true, spotify: false });
  await settle();
  await parts(rows.youtube).button.handlers.click();
  await parts(rows.spotify).button.handlers.click();
  assert.deepEqual([...new Set(calls.map(([command]) => command))].sort(), [
    "spotify_account_status",
    "spotify_sign_in",
    "youtube_login_status",
    "youtube_sign_out",
  ]);
});

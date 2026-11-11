import test from "node:test";
import assert from "node:assert/strict";
// A tiny DOM: enough elements to hold text, children and click handlers.
const element = () => {
  const node = { children: [], handlers: {}, textContent: "", disabled: false };
  node.append = (...items) => node.children.push(...items);
  node.addEventListener = (name, fn) => (node.handlers[name] = fn);
  node.insertBefore = item => node.children.push(item);
  return node;
};
globalThis.document ??= { documentElement: { lang: "en" }, createElement: element };
const { wireMusicAccount } = await import("../src/music-account.js");
const { t } = await import("../src/i18n.js");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("the YouTube account row signs in through the existing window and signs out on request", async () => {
  let signedIn = false;
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "youtube_login_status") return signedIn ? "path" : null;
    if (command === "youtube_sign_out") signedIn = false;
    return null;
  };
  let onSession;
  const host = element();
  wireMusicAccount({ invoke, host, listen: (name, fn) => name === "youtube-session" && (onSession = fn) });
  await settle();
  const [row] = host.children, [copy, button] = row.children;
  assert.equal(copy.children[0].textContent, t("YouTube account: not signed in"));
  assert.equal(button.textContent, t("Sign in"));
  await button.handlers.click();
  assert.deepEqual(calls.at(-1), ["open_youtube", { signIn: true }]);
  // The sign-in window reports a saved session; the row follows it.
  signedIn = true;
  await onSession();
  assert.equal(copy.children[0].textContent, t("YouTube account: signed in"));
  assert.equal(button.textContent, t("Sign out"));
  await button.handlers.click();
  assert.deepEqual(calls.at(-1), ["youtube_sign_out", undefined]);
  assert.equal(button.textContent, t("Sign in"));
});

test("the account row never sends the sign-in anywhere but the local sign-in commands", async () => {
  const commands = new Set();
  const host = element();
  wireMusicAccount({ invoke: async command => (commands.add(command), null), host, listen: () => {} });
  await settle();
  await host.children[0].children[1].handlers.click();
  assert.deepEqual([...commands].sort(), ["open_youtube", "youtube_login_status"]);
});

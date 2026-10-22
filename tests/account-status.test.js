import test from "node:test";
import assert from "node:assert/strict";
import {downloadAuthView} from "../src/account-status.js";

test("a saved cookie file is shown as the source without claiming embedded or server-side sign-in", () => {
  const status = downloadAuthView({mode:"file", cookiePath:" /home/test/cookies.txt ", savedMode:"file", savedPath:"/home/test/cookies.txt"});
  assert.equal(status.label,"Cookies file");
  assert.equal(status.action,"accounts");
  assert.equal(status.sourceSaved,true);
  assert.equal(status.embeddedSession,false);
  assert.match(status.title,/access is checked when downloading/);
  assert.doesNotMatch(JSON.stringify(status),/\/home\/|Signed in|test\/cookies/);
});

test("each supported browser has its own truthful label and never implies cookies were already extracted", () => {
  for (const [mode,label] of Object.entries({firefox:"Firefox", chrome:"Chrome", edge:"Edge", brave:"Brave", safari:"Safari"})) {
    const status = downloadAuthView({mode,savedMode:mode});
    assert.equal(status.label,label);
    assert.equal(status.params.browser,label);
    assert.equal(status.action,"accounts");
    assert.equal(status.sourceSaved,true);
    assert.equal(status.embeddedSession,false);
    assert.match(status.title,/access is checked when downloading/);
  }
});

test("unsaved browser changes, file edits and empty paths remain pending", () => {
  for (const input of [
    {mode:"firefox",savedMode:"account"},
    {mode:"file",cookiePath:"/new.txt",savedMode:"file",savedPath:"/previous.txt"},
    {mode:"file",cookiePath:"",savedMode:"file",savedPath:""},
    {mode:"none",savedMode:"account"},
  ]) {
    const status = downloadAuthView(input);
    assert.equal(status.sourceSaved,false);
    assert.equal(status.sourcePending,true);
    assert.match(status.title,/not applied/);
  }
});

test("an embedded session remains a separate fact when downloads use another source or no cookies", () => {
  for (const mode of ["file","firefox","none"]) {
    const status = downloadAuthView({mode,savedMode:mode,cookiePath:"/test.txt",savedPath:"/test.txt",hasEmbeddedSession:true});
    assert.equal(status.embeddedSession,true);
    assert.equal(status.action,"accounts");
    assert.notEqual(status.label,"YouTube");
    assert.doesNotMatch(status.title,/Signed in/);
  }
  assert.equal(downloadAuthView({mode:"account",hasEmbeddedSession:true}).action,"youtube");
  assert.equal(downloadAuthView({mode:"account",hasEmbeddedSession:true}).label,"YouTube");
  assert.equal(downloadAuthView().action,"signin");
  assert.equal(downloadAuthView().label,"Sign in");
});

test("unknown modes cannot impersonate browser labels or leak a path into status text", () => {
  for (const mode of ["__proto__","constructor","/secret.txt",null]) {
    const status = downloadAuthView({mode,cookiePath:"/secret.txt",savedPath:"/secret.txt"});
    assert.equal(status.kind,"account");
    assert.equal(status.label,"Sign in");
    assert.doesNotMatch(JSON.stringify(status),/secret/);
  }
});

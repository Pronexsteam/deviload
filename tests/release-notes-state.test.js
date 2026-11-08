import test from "node:test";
import assert from "node:assert/strict";
import {shouldShowReleaseNotes,markReleaseNotesSeen,lastSeenReleaseNotes,compareVersions} from "../src/release-notes-state.js";
test("release notes appear once per installed version and migrate the old key",()=>{
  const values=new Map([["deviload-app-release-notes","deviload-2.7.6"]]);
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(shouldShowReleaseNotes(storage,"2.7.6"),false);
  assert.equal(shouldShowReleaseNotes(storage,"2.7.7"),true);
  markReleaseNotesSeen(storage,"2.7.7");
  assert.equal(shouldShowReleaseNotes(storage,"2.7.7"),false);
  assert.equal(shouldShowReleaseNotes(storage,"2.7.8"),true);
  assert.equal(values.get("deviload-app-release-notes"),"deviload-2.7.7");
});
test("missing version never prompts; blocked storage still dismisses for this session",()=>{
  const storage={getItem(){throw Error("blocked");},setItem(){throw Error("blocked");}};
  assert.equal(shouldShowReleaseNotes(storage,null),false);
  assert.equal(shouldShowReleaseNotes(storage,""),false);
  assert.equal(shouldShowReleaseNotes(storage,"test-version"),true);
  markReleaseNotesSeen(storage,"test-version");
  assert.equal(shouldShowReleaseNotes(storage,"test-version"),false);
});

test("versions compare numerically and a pre-release reads its release notes", () => {
  assert.equal(compareVersions("2.10.0","2.9.0"),1);
  assert.equal(compareVersions("2.8.0","2.11.0"),-1);
  assert.equal(compareVersions("2.11.0-beta.1","2.11.0"),0);
  const values=new Map([["deviload-app-release-notes","deviload-2.8.0"]]);
  const storage={getItem:key=>values.get(key)??null};
  assert.equal(lastSeenReleaseNotes(storage),"2.8.0");
  assert.equal(lastSeenReleaseNotes({getItem:()=>null}),null);
});

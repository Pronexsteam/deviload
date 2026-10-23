import test from "node:test";
import assert from "node:assert/strict";
import {shouldShowReleaseNotes,markReleaseNotesSeen} from "../src/release-notes-state.js";
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

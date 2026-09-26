import test from "node:test";import assert from "node:assert/strict";import {actions,counts,orbState,mediaPreview,visibleJobs,playlistSelection,diagnoseError} from "../src/view-model.js";
test("only failed or interrupted tasks are retryable",()=>{for(const s of ["error","cancelled","interrupted"])assert.deepEqual(actions(s),["retry"]);assert.deepEqual(actions("done"),[]);assert.deepEqual(actions("cancelling"),[]);});
test("waiting and active tasks can be cancelled",()=>{assert.deepEqual(actions("queued"),["pause","cancel"]);assert.deepEqual(actions("running"),["pause","cancel"]);assert.deepEqual(actions("paused"),["resume","cancel"]);});
test("counts distinguish active tasks and history",()=>{assert.deepEqual(counts([{status:"running"},{status:"cancelling"},{status:"done"},{status:"error"},{status:"queued"}]),{total:5,active:2,done:1});});

test("orb follows active work before errors and completion",()=>{
 assert.equal(orbState([]),"idle");
 assert.equal(orbState([{status:"done"}]),"done");
 assert.equal(orbState([{status:"done"},{status:"error"}]),"error");
 assert.equal(orbState([{status:"error"},{status:"running"}]),"running");
 assert.equal(orbState([{status:"interrupted"}]),"interrupted");
 assert.equal(orbState([{status:"cancelling"}]),"cancelling");
 assert.equal(orbState([{status:"paused"}]),"paused");
});
test("previews accept YouTube IDs only from official hosts",()=>{
 assert.equal(mediaPreview("https://youtu.be/dQw4w9WgXcQ"),"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
 assert.equal(mediaPreview("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
 assert.equal(mediaPreview("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ"),"");
 assert.equal(mediaPreview("https://youtu.be/invalid"),"");
});
test("queue filters and search match status and file name",()=>{
 const jobs=[{status:"queued",url:"https://example.com/one",file:""},{status:"done",url:"https://example.com/two",file:"Holiday.mp4"},{status:"error",url:"https://example.com/three",file:""}];
 const scheduled={status:"queued",scheduledAt:2_000_000_000,url:"https://example.com/later",file:""};
 assert.equal(visibleJobs([...jobs,scheduled],"active").length,1);
 assert.deepEqual(visibleJobs([...jobs,scheduled],"scheduled"),[scheduled]);
 assert.equal(visibleJobs([{status:"paused",url:"",file:""}],"active").length,1);
 assert.equal(visibleJobs(jobs,"done","holiday")[0],jobs[1]);
 assert.equal(visibleJobs(jobs,"issues")[0],jobs[2]);
 assert.deepEqual(visibleJobs([{status:"cancelled",url:"",file:""}],"issues"),[]);
 assert.deepEqual(visibleJobs(jobs,"all","missing"),[]);
});
test("playlist selection preserves exact singleton instead of first N",()=>{assert.equal(playlistSelection([2]),"2-2");assert.equal(playlistSelection([5,2,3,5,9]),"2-3,5-5,9-9");});

test("error hints identify login, disk, update and network cases",()=>{
 assert.equal(diagnoseError(["ERROR: Sign in to confirm you're not a bot"]).action,"login");
 assert.match(diagnoseError(["ERROR: Sign in to confirm you're not a bot"],true).message,/stale/);
 assert.equal(diagnoseError(["WARNING: n challenge solving failed"]).action,"update");
 assert.equal(diagnoseError(["ERROR: HTTP Error 403: Forbidden"]).action,"update");
 assert.equal(diagnoseError(["ERROR: [youtube] abc: Private video"]).title,"Private video");
 // Another site asking for an account points to the cookies settings, not to the YouTube sign-in.
 const instagram = diagnoseError(["ERROR: [Instagram] x: Instagram sent an empty media response. use --cookies-from-browser or --cookies for the authentication. please report this issue. Confirm you are on the latest version using yt-dlp -U"], true, "https://www.instagram.com/p/x/");
 assert.equal(instagram.action,"cookies");
 assert.doesNotMatch(instagram.message,/YouTube/);
 assert.equal(diagnoseError(["ERROR: login required"], false, "https://www.youtube.com/watch?v=x").action,"login");
 assert.match(diagnoseError(["No space left on device"]).message,/space/);
 assert.match(diagnoseError(["OSError: [WinError 112]"]).message,/space/);
 assert.match(diagnoseError(["Connection reset by peer"]).message,/connection/);
 assert.equal(diagnoseError(["ERROR: Unable to download webpage: ('Unable to connect to proxy', OSError('Tunnel connection failed: 403 Forbidden')) (caused by ProxyError())"]).action,"proxy");
 assert.equal(diagnoseError(["ERROR: [youtube] abc: The uploader has not made this video available in your country"]).action,"proxy");
 assert.equal(diagnoseError(["ERROR: [youtube] x: Unable to download API page: SocksHTTPSConnection(host='www.youtube.com', port=443): Failed to establish a new connection"]).action,"proxy");
 assert.equal(diagnoseError(["something odd"]).title,"Download failed");
});

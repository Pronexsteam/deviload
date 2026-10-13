import {playbackError, restricted} from './errors.ts';
function assert(value:unknown){if(!value)throw Error('Assertion failed');}
Deno.test('source restrictions retain distinct actionable messages',()=>{
  for(const [source,expected] of [['LOGIN_REQUIRED','requires sign-in'],['AGE_CHECK_REQUIRED','requires sign-in'],['UNPLAYABLE','unavailable from YouTube'],['Audio HTTP 403','denied access'],['429','Wait before trying again']]){
    assert(restricted(Error(source)));assert(playbackError(Error(source)).includes(expected));
  }
});
Deno.test('ordinary failures remain retryable and signed URLs stay private',()=>{
  assert(!restricted(Error('Opening audio timed out')));
  assert(playbackError(Error('Opening audio timed out'))==='Opening audio timed out');
  assert(playbackError(Error('Cancelled'))==='Cancelled');
  assert(playbackError(Error('Failed https://example.com/audio?token=secret'))==='Failed [url]');
});

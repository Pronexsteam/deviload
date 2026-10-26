import {pendingOpening} from './opening.ts';
function assert(value:unknown){if(!value)throw Error('Assertion failed');}
Deno.test('healthy pending opens coalesce without a second extraction',async()=>{
 const value={url:'cached'},control=new AbortController();
 assert(await pendingOpening('a',new Map([['a',Promise.resolve(value)]]),new Map([['a',control]]))===value);
});
Deno.test('returning to a canceled opening permits a fresh request',async()=>{
 const control=new AbortController();control.abort();
 const pending=Promise.reject(Error('Cancelled'));
 assert(await pendingOpening('a',new Map([['a',pending]]),new Map([['a',control]]))===undefined);
});
Deno.test('a genuine source failure still propagates instead of retrying endlessly',async()=>{
 let error='';try{await pendingOpening('a',new Map([['a',Promise.reject(Error('LOGIN_REQUIRED'))]]),new Map([['a',new AbortController()]]));}catch(e){error=String(e);}
 assert(error.includes('LOGIN_REQUIRED'));
});

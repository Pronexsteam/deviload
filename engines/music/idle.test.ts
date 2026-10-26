import {idleRelease} from './idle.ts';
Deno.test('guest lease releases once after the last operation, never during renewed work',()=>{
 const timers=new Map<number,()=>void>();let serial=0,releases=0;
 const lease=idleRelease(()=>releases++,45,((fn:()=>void)=>{timers.set(++serial,fn);return serial;}) as unknown as typeof setTimeout,(id)=>{timers.delete(Number(id));});
 lease.arm();lease.arm();if(timers.size!==1)throw Error('duplicate timer');
 lease.hold();if(timers.size)throw Error('active operation can be released');
 lease.arm();for(const fn of timers.values())fn();if(releases!==1)throw Error('worker not released');
});

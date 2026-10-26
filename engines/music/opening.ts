// A canceled speculative request must not poison a later deliberate Play.
// Healthy concurrent opens still share one promise and one network request.
export async function pendingOpening<T>(id:string,inflight:Map<string,Promise<T>>,resolving:Map<string,AbortController>):Promise<T|undefined>{
 const pending=inflight.get(id);if(!pending)return undefined;
 if(!resolving.get(id)?.signal.aborted)return pending;
 try{await pending;}catch{/* Expected cancellation; caller opens a fresh request. */}
 return undefined;
}

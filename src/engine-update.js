// Manual and automatic requests share the same backend operation.
export function createEngineUpdater(invoke, setBusy) {
  let pending = null;
  return () => {
    if (pending) return pending;
    pending = Promise.resolve().then(() => invoke("update_ytdlp")).finally(() => {
      pending = null;
      setBusy(false);
    });
    setBusy(true);
    return pending;
  };
}

// Artists known to publish AI-generated music, as canonical artist keys. Empty until the listener turns the
// filter on in Music settings; recommendations and radio then leave these artists out.
let keys = null;

export const aiArtistFilter = {
  set(next) {
    keys = next instanceof Set && next.size ? next : null;
  },
  has(key) {
    return keys !== null && keys.has(key);
  },
  get size() {
    return keys ? keys.size : 0;
  },
};

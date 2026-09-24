// A small mascot that switches between poses; each pose has its own motion in shell.css.
const POSES = ["front", "look", "working", "victory", "error"];

function fill(spot) {
  if (spot.childElementCount) return spot;
  spot.classList.add("mascot-spot");
  spot.setAttribute("aria-hidden", "true");
  for (const pose of POSES) {
    const image = document.createElement("img");
    image.src = `assets/mascot/${pose}.png`;
    image.alt = "";
    image.decoding = "async";
    image.dataset.pose = pose;
    spot.append(image);
  }
  return spot;
}

export function mascotSpot(pose = "front", className = "") {
  const spot = document.createElement("span");
  if (className) spot.className = className;
  spot.dataset.pose = pose;
  return fill(spot);
}

// Static placeholders: <span data-mascot="front"></span>
export function hydrateMascots(root = document) {
  for (const spot of root.querySelectorAll("[data-mascot]")) {
    if (!spot.dataset.pose) spot.dataset.pose = spot.dataset.mascot;
    fill(spot);
  }
}

// Changes the pose; one-shot poses can fall back to another pose afterwards.
export function setPose(spot, pose, back = null, after = 3200) {
  if (!spot) return;
  clearTimeout(spot.poseTimer);
  if (spot.dataset.pose !== pose) {
    spot.dataset.pose = pose;
    spot.style.animation = "none";
    void spot.offsetWidth;
    spot.style.animation = "";
  }
  if (back) spot.poseTimer = setTimeout(() => setPose(spot, back), after);
}

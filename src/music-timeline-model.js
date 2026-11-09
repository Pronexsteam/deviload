// The line sung at a moment of the song, for the timeline's bubble.
export function lineAt(lines, time) {
  let found = "";
  for (const line of lines) {
    if (line.at > time) break;
    if (time < line.end) found = line.text;
  }
  return found;
}

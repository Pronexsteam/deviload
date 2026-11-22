// Whether a node takes part in the page (neither it nor an ancestor is display: none). checkVisibility() answers
// from styles alone; getClientRects() gives the same answer but lays out the whole page first, which in the middle
// of opening or closing something costs a full extra layout.
export const rendered = node =>
  Boolean(node) &&
  (typeof node.checkVisibility === "function" ? node.checkVisibility() : node.getClientRects().length > 0);

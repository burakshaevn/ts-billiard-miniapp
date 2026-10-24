/**
 * Ball colours live apart from the table component on purpose: a module that
 * exports both a React component and plain constants breaks Fast Refresh,
 * and the dev server starts serving an older copy of the constants.
 *
 * Bright, flat, poster-like: the set every pool app uses, so a ball is
 * recognised by colour alone at thumbnail size.
 */
export const BALL_COLORS = [
  "#fbfaf5",
  "#f7c81c",
  "#1a63cf",
  "#df2f26",
  "#7a30a8",
  "#f07c18",
  "#0f9a4e",
  "#8f2b2b",
  "#16181a",
  "#f7c81c",
  "#1a63cf",
  "#df2f26",
  "#7a30a8",
  "#f07c18",
  "#0f9a4e",
  "#8f2b2b",
];

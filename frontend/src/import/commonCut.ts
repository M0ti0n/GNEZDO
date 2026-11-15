/**
 * Common cut: the part may share the straight lines of its outline with its neighbours on the sheet,
 * so a shared edge is cut once for both parts. Lines that must not be shared are left out in the
 * drawing (Common cut tool, or a No common cut color in Rules -> Import rules -> Line colors).
 */
export const COMMON_CUT_TIP = "Common cut: every straight line of this part's outline may be shared with a neighbouring part and cut once for both (lines left out with the Common cut tool are cut on their own)";

// How each stat is written on a card once it is revealed. Fixed English
// and fixed separators rather than the browser's locale, so a screenshot
// reads the same everywhere and the tests can pin exact strings.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

// Below this, a size keeps one decimal place.
const DECIMAL_BELOW = 100;

// A first-seen window at most this many days wide is written as the month
// it closed in; a wider one as its two ends.
const NARROW_WINDOW_DAYS = 45;

const DAY_MS = 86_400_000;

export function formatCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatBytes(n) {
  let unit = 0;
  while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  if (unit === 0) {
    return `${n} B`;
  }
  const digits = n < DECIMAL_BELOW ? 1 : 0;
  return `${n.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

export function monthYear(date) {
  const [year, month] = date.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

function plural(n, word) {
  return `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
}

// The window a package was added in, as precisely as the index knows it.
function formatWindow({ after, by }) {
  if (after === null) {
    return `by ${monthYear(by)}`;
  }
  const days = (Date.parse(by) - Date.parse(after)) / DAY_MS;
  if (days <= NARROW_WINDOW_DAYS) {
    return monthYear(by);
  }
  return `${monthYear(after)} to ${monthYear(by)}`;
}

// The revealed value of one question for one package.
export function formatStat(type, p) {
  switch (type) {
    case "rebuilds":
      return plural(p.rebuilds, "package");
    case "closureSize":
      return formatBytes(p.closureSize);
    case "versions":
      return plural(p.versions, "version");
    case "firstSeen":
      return formatWindow(p.firstSeen);
  }
  throw new Error(`unknown question ${type}`);
}

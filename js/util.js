export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Datumswerte sind lokale Kalendertage als 'YYYY-MM-DD'.
// Nie toISOString() nehmen: Das rechnet nach UTC um und verschiebt abends den Tag.
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => toISO(new Date());
export const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 864e5);

const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
export const fmtDay = (iso) => dayFmt.format(fromISO(iso));
export const fmtLong = (iso) => longFmt.format(fromISO(iso));
export const fmtMonth = (d) => monthFmt.format(d);

export function fmtRelative(iso) {
  const diff = daysBetween(iso, today());
  if (diff === 0) return 'heute';
  if (diff === 1) return 'gestern';
  if (diff === -1) return 'morgen';
  if (diff < 0) return `in ${-diff} Tagen`;
  if (diff < 14) return `vor ${diff} Tagen`;
  if (diff < 60) return `vor ${Math.round(diff / 7)} Wochen`;
  if (diff < 365) return `vor ${Math.round(diff / 30)} Monaten`;
  const years = Math.round(diff / 365);
  return years === 1 ? 'vor einem Jahr' : `vor ${years} Jahren`;
}

export const EMOJIS = ['🍝', '🍕', '🍛', '🍲', '🥘', '🍜', '🍣', '🌮', '🥗', '🍔', '🍳', '🥞',
  '🥪', '🍗', '🥩', '🐟', '🍤', '🥦', '🍠', '🥟', '🍚', '🥔', '🍰', '🍽️'];

const EMOJI_HINTS = [
  [/pasta|nudel|spaghetti|lasagne|penne|carbonara|bolognese|tortellini|gnocchi|spätzle/, '🍝'],
  [/pizza|flammkuchen/, '🍕'],
  [/curry|dal/, '🍛'],
  [/suppe|eintopf|chili/, '🍲'],
  [/ramen|pho|wok|mie/, '🍜'],
  [/sushi/, '🍣'],
  [/taco|burrito|wrap|quesadilla|fajita/, '🌮'],
  [/salat|bowl/, '🥗'],
  [/burger/, '🍔'],
  [/ei\b|eier|omelett|shakshuka|frühstück/, '🍳'],
  [/pfannkuchen|pancake|crêpe|crepe|waffel/, '🥞'],
  [/sandwich|toast|brot/, '🥪'],
  [/hähnchen|huhn|chicken|geflügel/, '🍗'],
  [/steak|schnitzel|braten|rind|gulasch|fleisch/, '🥩'],
  [/fisch|lachs|forelle|thunfisch/, '🐟'],
  [/garnele|shrimp|scampi/, '🍤'],
  [/gemüse|brokkoli|ofengemüse/, '🥦'],
  [/maultasche|knödel|dumpling|gyoza|ravioli/, '🥟'],
  [/reis|risotto|paella/, '🍚'],
  [/kartoffel|pommes|gratin/, '🥔'],
  [/kuchen|torte|dessert|tiramisu/, '🍰'],
];

export function guessEmoji(name) {
  const lower = name.toLowerCase();
  return EMOJI_HINTS.find(([re]) => re.test(lower))?.[1] ?? '🍽️';
}

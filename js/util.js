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

/* ---------- Rezept-Links ---------- */

const RECIPE_SITES = [
  ['chefkoch.de', 'Chefkoch'],
  ['kitchenstories.com', 'Kitchen Stories'],
  ['lecker.de', 'LECKER'],
  ['eatsmarter.de', 'EAT SMARTER'],
  ['essen-und-trinken.de', 'essen & trinken'],
  ['kochbar.de', 'kochbar'],
  ['gutekueche.de', 'GuteKüche'],
  ['gutekueche.at', 'GuteKüche'],
  ['ichkoche.at', 'ichkoche'],
  ['rewe.de', 'REWE'],
  ['cookidoo.de', 'Cookidoo'],
  ['hellofresh.de', 'HelloFresh'],
  ['youtube.com', 'YouTube', true],
  ['youtu.be', 'YouTube', true],
  ['instagram.com', 'Instagram', true],
  ['tiktok.com', 'TikTok', true],
  ['pinterest.de', 'Pinterest', true],
  ['pinterest.com', 'Pinterest', true],
];

// Apps teilen oft "Titel https://…", und von Hand fehlt gern das https://.
export function parseRecipeUrl(input) {
  const text = input.trim();
  if (!text) return null;
  const embedded = text.match(/https?:\/\/[^\s<>"]+/i)?.[0];
  let candidate = embedded;
  if (!candidate) {
    if (/\s/.test(text) || !text.includes('.') || /^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
    candidate = `https://${text}`;
  }
  try {
    const url = new URL(candidate.replace(/[).,;!]+$/, ''));
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? url.href : null;
  } catch {
    return null;
  }
}

// Titel und Quelle kommen nur aus der Adresse. Die Seite selbst wird nicht aufgerufen.
export function describeRecipeUrl(href) {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, '');
  const site = RECIPE_SITES.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  const source = site?.[1] ?? host;
  if (site?.[2]) return { source, title: '' };
  const segment = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let slug = segment;
  try {
    slug = decodeURIComponent(segment);
  } catch { /* kaputte Kodierung: dann bleibt es beim Rohtext */ }
  slug = slug.replace(/\.[a-z0-9]{2,5}$/i, '');
  if (!/[-_]/.test(slug) || !/[a-zäöüß]{3}/i.test(slug)) return { source, title: '' };
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return { source, title: words.charAt(0).toUpperCase() + words.slice(1) };
}

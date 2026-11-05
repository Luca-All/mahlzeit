// Zutatenkatalog: Welche Lebensmittel die App als wichtig kennt, und was jedes davon beiträgt.
// Erfasst wird nur, ob etwas im Gericht vorkommt, nicht wie viel.

export const NUTRIENTS = ['Folat', 'Eisen', 'Zink', 'B1', 'B2', 'B6', 'B12', 'Omega-3', 'Vitamin C', 'Vitamin D'];

export const DIETS = [
  { id: 'omni', label: 'Alles', hint: 'Alle Bereiche zählen, auch Fisch und das Maßhalten bei Fleisch.', hidden: ['fortified'] },
  { id: 'pesc', label: 'Pescetarisch', hint: 'Fleisch und das Maßhalte-Ziel fallen weg.', hidden: ['meat', 'fortified'] },
  { id: 'veggie', label: 'Vegetarisch', hint: 'Fleisch und Fisch fallen weg. Dafür gibt es ein Wochenziel für Nüsse und Samen.', hidden: ['meat', 'fish', 'fortified'] },
  { id: 'vegan', label: 'Vegan', hint: 'Fleisch, Fisch, Ei und Milchprodukte fallen weg. Dafür zählen angereicherte Alternativen und Nüsse und Samen.', hidden: ['meat', 'fish', 'animal'] },
];

let diet = DIETS[0];

// Gilt für die ganze Küche, weil ihr gemeinsam esst und ein gemeinsames Level habt.
export function setDiet(id) {
  diet = DIETS.find((d) => d.id === id) ?? DIETS[0];
}
export const currentDiet = () => diet;
const isHidden = (groupId) => diet.hidden.includes(groupId);
export const activeGroups = () => GROUPS.filter((g) => !isHidden(g.id));
export const coreGroups = () => activeGroups().filter((g) => !g.optional && !g.limit);

export const GROUPS = [
  { id: 'legumes', label: 'Hülsenfrüchte', badge: '🫘', goal: 'möglichst täglich' },
  { id: 'greens', label: 'Grünes Gemüse', badge: '🥦', goal: 'täglich' },
  { id: 'veg', label: 'Buntes Gemüse und Obst', badge: '🍅', goal: 'zusammen mindestens 5 Portionen am Tag' },
  { id: 'vitc', label: 'Vitamin-C-Beilage', badge: '🍊', goal: 'verbessert die Eisenaufnahme' },
  { id: 'grains', label: 'Vollkorn', badge: '🌾', goal: 'statt Weißmehl' },
  { id: 'seeds', label: 'Nüsse, Samen, Öle', badge: '🌰', goal: 'pflanzliches Omega-3' },
  { id: 'fish', label: 'Fisch', badge: '🐟', goal: 'ein- bis zweimal pro Woche' },
  { id: 'animal', label: 'Ei und Milchprodukte', badge: '🧀', goal: 'regelmäßig' },
  { id: 'fortified', label: 'Angereicherte Alternativen', badge: '🌱', goal: 'Calcium, Jod, B2 und B12 im Blick' },
  { id: 'extras', label: 'Extras', badge: '🍄', goal: 'gern dazu', optional: true },
  // Zum Begrenzen statt zum Sammeln: bekommt kein Abzeichen und keine Punkte.
  { id: 'meat', label: 'Fleisch und Wurst', badge: '🥩', goal: 'höchstens 300 g pro Woche', limit: true },
];

const LEGUME = ['Folat', 'B1', 'B6', 'Eisen', 'Zink'];
const GRAIN = ['B1', 'B6', 'Eisen', 'Zink'];
const OMEGA = ['Omega-3'];
const DAIRY = ['B12', 'B2'];
const NOT_MEAT = /vegetar|vegan|veggie|fleischlos|sojahack|linsenhack/;

// match prüft Name, Notiz und weitere Zutaten eines Gerichts. Enthält auch Gerichte, in denen
// die Zutat üblicherweise steckt (Dal, Lasagne). unless blendet Treffer aus, die nur so aussehen,
// veto schließt die Zutat für den ganzen Text aus.
export const INGREDIENTS = [
  { id: 'linsen', label: 'Linsen', group: 'legumes', nutrients: LEGUME, match: /linse|\bdal\b|\bdhal\b/ },
  { id: 'kichererbsen', label: 'Kichererbsen', group: 'legumes', nutrients: LEGUME, match: /kichererbse|hummus|falafel|\bchana\b/ },
  { id: 'kidney', label: 'Kidneybohnen', group: 'legumes', nutrients: LEGUME, match: /kidney|chili con carne|chili sin carne/ },
  { id: 'weissebohnen', label: 'Weiße Bohnen', group: 'legumes', nutrients: LEGUME, match: /wei(ß|ss)e bohne|cannellini/ },
  { id: 'erbsen', label: 'Erbsen', group: 'legumes', nutrients: LEGUME, match: /erbse/, unless: /kichererbse/g },
  { id: 'edamame', label: 'Edamame', group: 'legumes', nutrients: LEGUME, match: /edamame/ },
  { id: 'tofu', label: 'Tofu, Tempeh', group: 'legumes', nutrients: ['Eisen', 'Zink'], match: /tofu|tempeh/ },

  { id: 'feldsalat', label: 'Feldsalat', group: 'greens', nutrients: ['Folat', 'Eisen'], match: /feldsalat/ },
  { id: 'spinat', label: 'Spinat', group: 'greens', nutrients: ['Folat', 'Eisen'], match: /spinat/ },
  { id: 'rucola', label: 'Rucola', group: 'greens', nutrients: ['Folat', 'Eisen'], match: /rucola|rauke/ },
  { id: 'gruenkohl', label: 'Grünkohl', group: 'greens', nutrients: ['Folat', 'Eisen'], match: /grünkohl/ },
  { id: 'brokkoli', label: 'Brokkoli', group: 'greens', nutrients: ['Folat'], match: /brokkoli|broccoli/ },
  { id: 'rosenkohl', label: 'Rosenkohl', group: 'greens', nutrients: ['Folat'], match: /rosenkohl/ },
  { id: 'spargel', label: 'Spargel', group: 'greens', nutrients: ['Folat'], match: /spargel/ },

  { id: 'tomaten', label: 'Tomaten', group: 'veg', nutrients: [], match: /tomate|passata|pizza|lasagne|bolognese|shakshuka|ratatouille|chili/ },
  { id: 'karotten', label: 'Karotten', group: 'veg', nutrients: [], match: /karotte|möhre/ },
  { id: 'zucchini', label: 'Zucchini, Aubergine', group: 'veg', nutrients: [], match: /zucchini|aubergine|ratatouille/ },
  { id: 'kuerbis', label: 'Kürbis', group: 'veg', nutrients: [], match: /kürbis/, unless: /kürbiskern/g },
  { id: 'blumenkohl', label: 'Blumenkohl', group: 'veg', nutrients: [], match: /blumenkohl/ },
  { id: 'pilze', label: 'Pilze', group: 'veg', nutrients: [], match: /pilz|champignon/ },
  { id: 'gemuese', label: 'Anderes Gemüse', group: 'veg', nutrients: [], match: /gemüse|\bwok\b/ },
  { id: 'beeren', label: 'Beeren', group: 'veg', nutrients: [], match: /beere/ },
  { id: 'obst', label: 'Anderes Obst', group: 'veg', nutrients: [], match: /\bapfel|\bbirne|banane|\bobst/ },

  { id: 'paprika', label: 'Paprika', group: 'vitc', nutrients: ['Vitamin C'], match: /paprika|shakshuka/, unless: /paprikapulver/g },
  { id: 'zitrus', label: 'Zitrusfrüchte', group: 'vitc', nutrients: ['Vitamin C'], match: /zitrone|zitrus|limette|orange|grapefruit/ },
  { id: 'kiwi', label: 'Kiwi', group: 'vitc', nutrients: ['Vitamin C'], match: /kiwi/ },

  { id: 'haferflocken', label: 'Haferflocken', group: 'grains', nutrients: GRAIN, match: /haferflocken|porridge|müsli|overnight oats/ },
  { id: 'vollkornbrot', label: 'Vollkornbrot', group: 'grains', nutrients: GRAIN, match: /vollkorn-?(brot|toast|brötchen)/ },
  { id: 'vollkornpasta', label: 'Vollkornpasta', group: 'grains', nutrients: GRAIN, match: /vollkorn-?(pasta|nudel|spaghetti|penne|lasagne)/ },
  { id: 'naturreis', label: 'Naturreis', group: 'grains', nutrients: GRAIN, match: /naturreis|vollkornreis/ },
  { id: 'hirse', label: 'Hirse', group: 'grains', nutrients: GRAIN, match: /hirse/ },
  { id: 'quinoa', label: 'Quinoa', group: 'grains', nutrients: GRAIN, match: /quinoa/ },
  { id: 'weizenkeime', label: 'Weizenkeime', group: 'grains', nutrients: ['Folat', 'B1', 'Zink'], match: /weizenkeim/ },

  { id: 'leinsamen', label: 'Leinsamen', group: 'seeds', nutrients: OMEGA, match: /leinsamen/ },
  { id: 'chia', label: 'Chia', group: 'seeds', nutrients: OMEGA, match: /\bchia/ },
  { id: 'walnuesse', label: 'Walnüsse', group: 'seeds', nutrients: OMEGA, match: /walnuss|walnüsse/, unless: /walnussöl/g },
  { id: 'hanfsamen', label: 'Hanfsamen', group: 'seeds', nutrients: OMEGA, match: /hanfsamen/ },
  { id: 'kuerbiskerne', label: 'Kürbiskerne', group: 'seeds', nutrients: ['Eisen', 'Zink'], match: /kürbiskern/ },
  { id: 'sonnenblumenkerne', label: 'Sonnenblumenkerne', group: 'seeds', nutrients: ['B1', 'B6', 'Folat'], match: /sonnenblumenkern/ },
  { id: 'oel', label: 'Lein-, Raps- oder Walnussöl', group: 'seeds', nutrients: OMEGA, match: /leinöl|rapsöl|walnussöl/ },

  { id: 'fettfisch', label: 'Lachs, Hering, Makrele', group: 'fish', nutrients: ['Omega-3', 'B12', 'Vitamin D'], match: /lachs|hering|makrele|sardine/, unless: /seelachs/g },
  { id: 'fisch', label: 'Anderer Fisch', group: 'fish', nutrients: ['B12'], match: /fisch|kabeljau|seelachs|forelle|scholle|dorade/ },

  { id: 'eier', label: 'Eier', group: 'animal', nutrients: DAIRY, match: /\bei\b|\beier\b|spiegelei|rührei|omelett|carbonara|shakshuka|tiramisu/ },
  { id: 'milch', label: 'Milch', group: 'animal', nutrients: DAIRY, match: /milch|b[eé]chamel|lasagne|gratin/, unless: /(kokos|hafer|mandel|soja)milch/g },
  { id: 'joghurt', label: 'Joghurt', group: 'animal', nutrients: DAIRY, match: /joghurt|jogurt|skyr|tzatziki|raita/, unless: /(soja|hafer|kokos|mandel)-?jog?hurt/g },
  { id: 'kaese', label: 'Käse', group: 'animal', nutrients: [...DAIRY, 'Zink'], match: /käse|parmesan|mozzarella|feta|gouda|halloumi|ricotta|cheddar|lasagne|pizza|carbonara|gratin/ },

  { id: 'pflanzendrink', label: 'Angereicherter Pflanzendrink', group: 'fortified', nutrients: ['B2', 'B12'], match: /(soja|hafer|mandel)-?(milch|drink)|pflanzendrink/ },
  { id: 'pflanzenjoghurt', label: 'Sojajoghurt', group: 'fortified', nutrients: ['B2', 'B12'], match: /(soja|hafer|kokos|mandel)-?jog?hurt/ },

  { id: 'hefeflocken', label: 'Hefeflocken mit B12', group: 'extras', nutrients: ['B1', 'B2', 'B6', 'B12'], match: /hefeflocken/ },
  // Bewusst nur mit "UV" im Text: Normale Champignons liefern dieses Vitamin D nicht.
  { id: 'uvpilze', label: 'UV-belichtete Champignons', group: 'extras', nutrients: ['Vitamin D'], match: /\buv\b.*champignon|uv-belichtet/ },

  {
    id: 'fleisch', label: 'Fleisch oder Wurst', group: 'meat', nutrients: [], veto: NOT_MEAT,
    match: /fleisch|\brind|\bschwein|\blamm|\bhack|wurst|salami|schinken|speck|bolognese|gulasch|steak|schnitzel|burger|carbonara|flammkuchen|döner|hähnchen|\bhuhn|\bpute|chicken|chili con carne/,
  },
];

const BY_ID = new Map(INGREDIENTS.map((i) => [i.id, i]));

export const ingredient = (id) => BY_ID.get(id);
export const ingredientsOfGroup = (groupId) => INGREDIENTS.filter((i) => i.group === groupId);
const isActive = (id) => !isHidden(BY_ID.get(id)?.group);

function guessAll(text) {
  const lower = text.toLowerCase();
  return INGREDIENTS
    .filter((i) => !i.veto?.test(lower) && i.match.test(i.unless ? lower.replace(i.unless, '') : lower))
    .map((i) => i.id);
}

export const guessIngredients = (text) => guessAll(text).filter(isActive);

const dishText = (dish) => [dish.name, dish.note, dish.otherIngredients].filter(Boolean).join(' ');

// Ohne eigene Auswahl gilt die Annahme. So bekommen auch ältere Gerichte Abzeichen.
export const isAssumed = (dish) => !dish.ingredients;
export const dishIngredients = (dish) => (dish.ingredients ?? guessAll(dishText(dish))).filter(isActive);
// Was im Gericht steckt, aber nicht zur gewählten Ernährungsweise passt.
export const conflictingIngredients = (dish) => (dish.ingredients ?? guessAll(dishText(dish))).filter((id) => !isActive(id));
export const guessForDish = (dish) => guessIngredients(dishText(dish));

export const isActiveIngredient = (id) => isActive(id);

// Was man gern zwischendurch isst. Für den Schnell-Eintrag, ohne dafür ein Gericht anzulegen.
export const QUICK_ITEMS = [
  'zitrus', 'kiwi', 'beeren', 'obst', 'paprika', 'gemuese', 'haferflocken', 'vollkornbrot', 'weizenkeime',
  'walnuesse', 'kuerbiskerne', 'sonnenblumenkerne', 'leinsamen', 'chia', 'hanfsamen', 'edamame', 'tofu',
  'joghurt', 'milch', 'kaese', 'eier', 'pflanzenjoghurt', 'pflanzendrink', 'hefeflocken',
];

export const nutrientsOf = (ids) => [...new Set(ids.flatMap((id) => BY_ID.get(id)?.nutrients ?? []))];

export function groupsOf(ids) {
  const present = new Set(ids.map((id) => BY_ID.get(id)?.group));
  return GROUPS.filter((g) => present.has(g.id));
}

// dates: die Kalendertage des Zeitraums. Einträge zu gelöschten Gerichten werden über ihren
// gespeicherten Namen eingeschätzt, damit der Rückblick stimmt.
export function summarize(cooked, dishes, dates, quick = []) {
  const inRange = new Set(dates);
  const groupDays = new Map(GROUPS.map((g) => [g.id, new Set()]));
  const nutrients = new Set();
  let meals = 0;
  for (const c of cooked) {
    if (!inRange.has(c.date)) continue;
    meals += 1;
    const dish = dishes.find((d) => d.id === c.dishId);
    const ids = dish ? dishIngredients(dish) : guessIngredients(c.dishName ?? '');
    for (const id of ids) {
      const item = BY_ID.get(id);
      if (!item) continue;
      groupDays.get(item.group).add(c.date);
      item.nutrients.forEach((n) => nutrients.add(n));
    }
  }
  for (const q of quick) {
    if (!inRange.has(q.date)) continue;
    for (const id of q.items.filter(isActive)) {
      const item = BY_ID.get(id);
      if (!item) continue;
      groupDays.get(item.group).add(q.date);
      item.nutrients.forEach((n) => nutrients.add(n));
    }
  }
  return { meals, groupDays, nutrients };
}

export const COMBOS = [
  {
    name: 'Haferflocken-Frühstück',
    note: 'Mit Weizenkeimen, Leinsamen, Walnüssen, Joghurt und Kiwi.',
    ingredients: ['haferflocken', 'weizenkeime', 'leinsamen', 'walnuesse', 'joghurt', 'kiwi'],
    vegan: {
      note: 'Mit Weizenkeimen, Leinsamen, Walnüssen, Sojajoghurt und Kiwi.',
      ingredients: ['haferflocken', 'weizenkeime', 'leinsamen', 'walnuesse', 'pflanzenjoghurt', 'kiwi'],
    },
  },
  { name: 'Linsen-Dal mit Spinat', note: '', ingredients: ['linsen', 'spinat'] },
  { name: 'Kichererbsen-Bowl mit Paprika und Feldsalat', note: '', ingredients: ['kichererbsen', 'paprika', 'feldsalat'] },
  { name: 'Vollkornpasta mit Brokkoli und Hefeflocken', note: '', ingredients: ['vollkornpasta', 'brokkoli', 'hefeflocken'] },
];

export const activeCombos = () => COMBOS.map((c) => (diet.id === 'vegan' && c.vegan ? { ...c, ...c.vegan } : c));

export const TIPS = [
  'Gemüse dämpfen statt lange kochen, damit das Folat erhalten bleibt, und täglich etwas roh essen.',
  'Getrocknete Hülsenfrüchte über Nacht einweichen. Das verbessert die Aufnahme von Eisen und Zink.',
  'Kaffee und Schwarztee mit etwa einer Stunde Abstand zu den Hauptmahlzeiten trinken.',
  'Paprika, Zitrus oder Kiwi dazu essen. Vitamin C verbessert die Eisenaufnahme.',
  'Leinöl nicht erhitzen, es gehört in den Salat.',
  'Jodsalz statt normalem Salz verwenden, und insgesamt weniger als 5 g Salz am Tag (WHO).',
  'Freien Zucker unter 50 g am Tag halten, dazu zählen auch Honig, Sirup und Saft (WHO).',
];

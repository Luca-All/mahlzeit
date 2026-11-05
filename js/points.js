// Punkte ("Löffel") und Level. Alles wird aus den gespeicherten Einträgen berechnet und nirgends
// abgelegt: Wird ein Eintrag gelöscht oder eine Regel geändert, stimmt der Stand automatisch.
// Es gibt bewusst keine Minuspunkte.
import { evaluateBadges } from './badges.js';
import {
  GROUPS, activeGroups, coreGroups, dishIngredients, guessIngredients, ingredient, isActiveIngredient,
} from './nutrition.js';
import { seasonalIngredients } from './season.js';
import { addDays, fromISO, toISO, today } from './util.js';

export const SOURCES = {
  WHO: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
  DGE: 'https://www.dge.de/gesunde-ernaehrung/gut-essen-und-trinken/dge-empfehlungen/',
  EU: 'https://knowledge-for-policy.ec.europa.eu/health-promotion-knowledge-gateway/whole-grain_en',
  B12: 'https://www.dge.de/gesunde-ernaehrung/faq/vitamin-b12/',
};

// Die Empfehlungen selbst vergeben keine Punkte. Die Gewichtung ist eine eigene Einordnung:
// Je klarer und häufiger WHO und DGE etwas empfehlen, desto mehr Löffel gibt es dafür.
export const GROUP_RULES = {
  greens: { points: 15, why: 'WHO: mindestens 400 g Gemüse und Obst am Tag. DGE: mindestens 5 Portionen.', sources: ['WHO', 'DGE'] },
  veg: { points: 10, why: 'Zählt auf dieselben 400 g und 5 Portionen.', sources: ['WHO', 'DGE'] },
  vitc: { points: 10, why: 'Zählt auf dieselben 400 g und 5 Portionen.', sources: ['WHO', 'DGE'] },
  legumes: { points: 15, why: 'WHO: Kohlenhydrate vor allem aus Hülsenfrüchten, Vollkorn, Gemüse und Obst. DGE: mindestens einmal pro Woche.', sources: ['WHO', 'DGE'] },
  grains: { points: 15, why: 'WHO: vorrangige Kohlenhydratquelle. DGE: die beste Wahl bei Getreide. EU: mit geringerem Risiko für nichtübertragbare Krankheiten verbunden.', sources: ['WHO', 'DGE', 'EU'] },
  fish: { points: 15, why: 'DGE: ein- bis zweimal pro Woche, deshalb höchstens zwei Tage pro Woche. WHO: Quelle ungesättigter Fette.', sources: ['DGE', 'WHO'] },
  seeds: { points: 10, why: 'DGE: täglich eine kleine Handvoll Nüsse, pflanzliche Öle bevorzugen. WHO: ungesättigte Fette bevorzugen.', sources: ['DGE', 'WHO'] },
  animal: { points: 5, why: 'DGE: Milchprodukte jeden Tag. WHO zählt Käse aber zu den Quellen gesättigter Fette, darum weniger Löffel.', sources: ['DGE', 'WHO'] },
  fortified: { points: 5, why: 'DGE: Bei pflanzlichen Alternativen auf Calcium, Jod, B2 und B12 achten.', sources: ['DGE'] },
  extras: { points: 3, why: 'Aus deiner persönlichen Liste, keine allgemeine WHO- oder DGE-Empfehlung.', sources: [] },
};

export const USAGE_RULES = {
  meal: 10,
  mealsPerDay: 3,
  wish: 2,
  wishesPerDay: 3,
  plan: 5,
  fulfil: 15,
  onTime: 5,
  quick: 5,
};

// Ein Goldener Wunsch kann nicht abgelehnt werden. Bezahlt wird aus dem eigenen Anteil der Löffel.
export const GOLDEN_WISH_COST = 300;

export const BONUS = {
  legumes: 20,
  fish: 20,
  seeds: 20,
  palette: 50,
  moderation: 30,
  streak: 40,
};

const MEAT_MEALS_PER_WEEK = 2; // 300 g laut DGE, grob zwei Portionen zu 150 g
const MIN_MEALS_FOR_MODERATION = 4;
const STREAK_LENGTH = 7;
const SEED_DAYS_PER_WEEK = 3;
const PLANT_GROUPS = ['greens', 'veg', 'vitc'];

export const LEVELS = [
  { min: 0, emoji: '📡', name: 'Mikrowellen-Stube', line: 'Die Mikrowelle kennt euch beim Vornamen.' },
  { min: 100, emoji: '🥪', name: 'Toastbrot-Taverne', line: 'Immerhin ist schon etwas knusprig.' },
  { min: 300, emoji: '💧', name: 'Nudelwasser-Akademie', line: 'Salzig wie das Mittelmeer, wie es sich gehört.' },
  { min: 600, emoji: '🫘', name: 'Linsen-Liga', line: 'Ihr spielt jetzt in der Hülsenfrucht-Oberklasse.' },
  { min: 1000, emoji: '🥦', name: 'Brokkoli-Bistro', line: 'Kleine Bäume, große Wirkung.' },
  { min: 1600, emoji: '🧑‍🍳', name: 'Kichererbsen-Kollektiv', line: 'Basisdemokratisch und ballaststoffreich.' },
  { min: 2400, emoji: '🌾', name: 'Vollkorn-Verein', line: 'Satzung, Paragraf 1: kein Weißmehl vor dem Vorstand.' },
  { min: 3500, emoji: '🌰', name: 'Walnuss-Wirtshaus', line: 'Täglich eine Handvoll, die Stammgäste wissen das.' },
  { min: 5000, emoji: '🎓', name: 'Feldsalat-Fakultät', line: 'Lehrstuhl für angewandte Vinaigrette.' },
  { min: 7000, emoji: '🏰', name: 'Haferflocken-Hochburg', line: 'Uneinnehmbar, vor allem vor dem Frühstück.' },
  { min: 9500, emoji: '👑', name: 'Spinat-Imperium', line: 'Das Eisen regiert.' },
  { min: 13000, emoji: '🥄', name: 'Orden vom Goldenen Löffel', line: 'Wird nur an Menschen mit Saisonkalender verliehen.' },
  { min: 18000, emoji: '⭐', name: 'Drei Sterne im Grünkohl-Guide', line: 'Die Testesser kamen und blieben.' },
  { min: 25000, emoji: '🏛️', name: 'Olymp der Hülsenfrüchte', line: 'Von hier oben sieht man jede Linse.' },
];

export function levelFor(total) {
  let index = 0;
  LEVELS.forEach((l, i) => {
    if (total >= l.min) index = i;
  });
  const level = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  const progress = next ? (total - level.min) / (next.min - level.min) : 1;
  return { ...level, index, number: index + 1, next, progress };
}

export const weekStart = (iso) => addDays(iso, -((fromISO(iso).getDay() + 6) % 7));

function ingredientsOfMeal(c, dishes) {
  const dish = dishes.find((d) => d.id === c.dishId);
  return dish ? dishIngredients(dish) : guessIngredients(c.dishName ?? '');
}

const dateOf = (ms) => toISO(new Date(ms));

export function computePoints({
  cooked, dishes, wishes, quick = [],
}) {
  const now = today();
  const core = coreGroups().map((g) => g.id);
  const has = (id) => activeGroups().some((g) => g.id === id);
  const entries = [];
  const add = (date, points, label, who) => entries.push({ date, points, label, who });

  const stats = {
    mealDates: [],
    dishDates: dishes.filter((d) => d.createdAt).map((d) => dateOf(d.createdAt)),
    groupDays: new Map(),
    plantDays: [],
    paletteDates: [],
    varietyDates: [],
    seasonDates: [],
    fulfilDates: [],
    goldenDates: [],
    onTimeDates: [],
    quickDates: [],
    entryDays: [],
  };
  const seenIngredients = new Set();

  const days = new Map();
  const weeks = new Map();
  const weekOf = (date) => {
    const key = weekStart(date);
    if (!weeks.has(key)) {
      weeks.set(key, { start: key, meals: 0, meatMeals: 0, fishDays: 0, seedDays: 0, groups: new Set() });
    }
    return weeks.get(key);
  };

  const events = [
    ...cooked.map((c) => ({ date: c.date, createdAt: c.createdAt ?? 0, meal: c, who: c.by })),
    ...quick.map((q) => ({ date: q.date, createdAt: Infinity, quick: q, who: q.who })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  for (const event of events) {
    const { date, who } = event;
    if (!days.has(date)) days.set(date, { dishes: new Set(), groups: new Set(), counted: 0 });
    const day = days.get(date);
    const week = weekOf(date);
    const ids = event.meal ? ingredientsOfMeal(event.meal, dishes) : event.quick.items.filter(isActiveIngredient);
    const groups = new Set(ids.map((id) => ingredient(id)?.group).filter(Boolean));

    if (event.meal) {
      const c = event.meal;
      // Dasselbe Gericht am selben Tag zählt nur einmal, und pro Tag höchstens drei Mahlzeiten.
      if (day.dishes.has(c.dishId)) continue;
      day.dishes.add(c.dishId);
      week.meals += 1;
      if (groups.has('meat')) week.meatMeals += 1;
      stats.mealDates.push(date);
      const season = seasonalIngredients(fromISO(date).getMonth() + 1);
      if (ids.some((id) => season.has(id))) stats.seasonDates.push(date);
      if (day.counted < USAGE_RULES.mealsPerDay) {
        day.counted += 1;
        add(date, USAGE_RULES.meal, `${c.dishName} eingetragen`, who);
      }
      if (c.fromPlan) {
        add(date, USAGE_RULES.onTime, 'Wie geplant gekocht', who);
        stats.onTimeDates.push(date);
      }
    } else if (ids.length) {
      add(date, USAGE_RULES.quick, 'Schnell-Eintrag', who);
      stats.quickDates.push(date);
    }

    for (const id of ids) {
      if (!seenIngredients.has(id)) {
        seenIngredients.add(id);
        stats.varietyDates.push(date);
      }
    }

    for (const g of groups) {
      const rule = GROUP_RULES[g];
      if (!rule || day.groups.has(g)) continue;
      day.groups.add(g);
      if (!stats.groupDays.has(g)) stats.groupDays.set(g, new Set());
      stats.groupDays.get(g).add(date);
      if (g === 'fish') {
        week.fishDays += 1;
        if (week.fishDays > 2) continue;
      }
      if (g === 'seeds') {
        week.seedDays += 1;
        if (!has('fish') && week.seedDays === SEED_DAYS_PER_WEEK) add(date, BONUS.seeds, 'Wochenziel Nüsse und Samen', who);
      }
      if (g === 'legumes' && !week.groups.has(g)) add(date, BONUS.legumes, 'Wochenziel Hülsenfrüchte', who);
      if (g === 'fish' && !week.groups.has(g)) add(date, BONUS.fish, 'Wochenziel Fisch', who);
      week.groups.add(g);
      add(date, rule.points, GROUPS.find((x) => x.id === g).label, who);
      if (!week.palette && core.every((x) => week.groups.has(x))) {
        week.palette = true;
        add(date, BONUS.palette, 'Volle Palette', 'both');
        stats.paletteDates.push(date);
      }
    }
  }

  for (const week of weeks.values()) {
    const end = addDays(week.start, 6);
    // Erst nach Wochenende vergeben, sonst müsste ein spätes Schnitzel Punkte wieder wegnehmen.
    if (has('meat') && end < now && week.meals >= MIN_MEALS_FOR_MODERATION && week.meatMeals <= MEAT_MEALS_PER_WEEK) {
      add(end, BONUS.moderation, 'Maßhalte-Medaille', 'both');
    }
  }

  const plantDays = [...days.entries()]
    .filter(([, d]) => PLANT_GROUPS.some((g) => d.groups.has(g)))
    .map(([date]) => date)
    .sort();
  let run = 0;
  let previous = null;
  for (const date of plantDays) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    previous = date;
    if (run % STREAK_LENGTH === 0) add(date, BONUS.streak, `${run} Tage Gemüse in Folge`, 'both');
  }
  stats.plantDays = plantDays;
  stats.entryDays = [...days.keys()].sort();
  // Heute darf noch fehlen: Die Serie reißt erst, wenn auch der Tag vorbei ist.
  const streak = previous && previous >= addDays(now, -1) ? run : 0;

  const wishesPerDay = new Map();
  for (const w of wishes) {
    const created = dateOf(w.createdAt);
    const sameDay = wishesPerDay.get(created) ?? 0;
    wishesPerDay.set(created, sameDay + 1);
    if (sameDay < USAGE_RULES.wishesPerDay) add(created, USAGE_RULES.wish, `${w.dishName} gewünscht`, w.from);
    if (w.golden) stats.goldenDates.push(created);
    if (w.plannedDate && w.status !== 'declined') add(created, USAGE_RULES.plan, `${w.dishName} eingeplant`, w.to);
    if (w.status === 'done') {
      const log = cooked.find((c) => c.id === w.cookedId);
      const date = log?.date ?? dateOf(w.resolvedAt ?? w.createdAt);
      add(date, USAGE_RULES.fulfil, `Wunsch erfüllt: ${w.dishName}`, w.to);
      stats.fulfilDates.push(date);
      if (log && log.date === w.plannedDate) {
        add(date, USAGE_RULES.onTime, 'Pünktlich wie geplant', w.to);
        stats.onTimeDates.push(date);
      }
    }
  }

  const badges = evaluateBadges(stats);
  for (const b of badges) {
    if (b.earned) add(b.date, b.reward, `Abzeichen: ${b.name}`, 'both');
  }

  const total = entries.reduce((sum, e) => sum + e.points, 0);
  const byPerson = {};
  for (const e of entries) {
    if (e.who === 'both') byPerson.both = (byPerson.both ?? 0) + e.points;
    else byPerson[e.who] = (byPerson[e.who] ?? 0) + e.points;
  }

  const thisWeek = weeks.get(weekStart(now)) ?? { meals: 0, meatMeals: 0, fishDays: 0, seedDays: 0, groups: new Set() };
  const quests = [
    {
      emoji: '🫘', name: 'Bohnen-Pflicht', goal: 'Mindestens einmal Hülsenfrüchte', reward: BONUS.legumes,
      done: thisWeek.groups.has('legumes'), progress: thisWeek.groups.has('legumes') ? 'Geschafft' : 'Noch offen',
    },
    has('fish') ? {
      emoji: '🎣', name: 'Angelschein', goal: 'Einmal Fisch', reward: BONUS.fish,
      done: thisWeek.groups.has('fish'), progress: thisWeek.groups.has('fish') ? 'Geschafft' : 'Noch offen',
    } : {
      emoji: '🐿️', name: 'Nussknacker', goal: `An ${SEED_DAYS_PER_WEEK} Tagen Nüsse, Samen oder gutes Öl`, reward: BONUS.seeds,
      done: thisWeek.seedDays >= SEED_DAYS_PER_WEEK, progress: `${Math.min(thisWeek.seedDays, SEED_DAYS_PER_WEEK)} von ${SEED_DAYS_PER_WEEK} Tagen`,
    },
    {
      emoji: '🎨', name: 'Volle Palette', goal: `Alle ${core.length} Bereiche in einer Woche`, reward: BONUS.palette,
      done: Boolean(thisWeek.palette), progress: `${core.filter((id) => thisWeek.groups.has(id)).length} von ${core.length}`,
    },
    has('meat') && {
      emoji: '⚖️', name: 'Maßhalte-Medaille', goal: `Höchstens ${MEAT_MEALS_PER_WEEK}× Fleisch bei mindestens ${MIN_MEALS_FOR_MODERATION} Mahlzeiten`, reward: BONUS.moderation,
      done: false, progress: `${thisWeek.meatMeals}× Fleisch, ${thisWeek.meals} Mahlzeiten. Wertung nach dem Sonntag`,
    },
    {
      emoji: '🔥', name: 'Gemüse-Serie', goal: `${STREAK_LENGTH} Tage in Folge Gemüse oder Obst`, reward: BONUS.streak,
      done: streak > 0 && streak % STREAK_LENGTH === 0, progress: `Aktuell ${streak} ${streak === 1 ? 'Tag' : 'Tage'}`,
    },
  ].filter(Boolean);

  entries.sort((a, b) => b.date.localeCompare(a.date));
  return {
    total, byPerson, entries, level: levelFor(total), quests, streak, badges,
  };
}

// Was eine Person für Goldene Wünsche ausgeben kann. Das Level bleibt davon unberührt.
export function wishBalance(points, wishes, personId) {
  const earned = (points.byPerson[personId] ?? 0) + Math.floor((points.byPerson.both ?? 0) / 2);
  const spent = wishes.filter((w) => w.golden && w.from === personId).reduce((sum) => sum + GOLDEN_WISH_COST, 0);
  return earned - spent;
}

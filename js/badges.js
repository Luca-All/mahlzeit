// Sammel-Abzeichen. Wie die Löffel werden sie aus den Einträgen berechnet und geben einmalig Punkte.
// count: Anzahl Ereignisse, run: Tage in Folge.
import { activeGroups } from './nutrition.js';
import { addDays } from './util.js';

const hasFish = () => activeGroups().some((g) => g.id === 'fish');
const group = (id) => (st) => [...(st.groupDays.get(id) ?? [])];

export const BADGES = [
  { id: 'first-meal', emoji: '🍳', name: 'Der erste Löffel', goal: 'Die erste Mahlzeit eingetragen', reward: 10, target: 1, events: (st) => st.mealDates },
  { id: 'meals-25', emoji: '📒', name: 'Küchenchronik', goal: '25 Mahlzeiten eingetragen', reward: 30, target: 25, events: (st) => st.mealDates },
  { id: 'meals-100', emoji: '📚', name: 'Hundert Töpfe', goal: '100 Mahlzeiten eingetragen', reward: 100, target: 100, events: (st) => st.mealDates },
  { id: 'dishes-10', emoji: '📖', name: 'Eigenes Kochbuch', goal: '10 Gerichte gespeichert', reward: 20, target: 10, events: (st) => st.dishDates },
  { id: 'legumes-1', emoji: '🫘', name: 'Erste Linse', goal: 'Zum ersten Mal Hülsenfrüchte', reward: 10, target: 1, events: group('legumes') },
  { id: 'legumes-25', emoji: '🦸', name: 'Hülsen-Held', goal: 'An 25 Tagen Hülsenfrüchte', reward: 50, target: 25, events: group('legumes') },
  { id: 'grains-25', emoji: '🌾', name: 'Vollkorn-Fan', goal: 'An 25 Tagen Vollkorn', reward: 40, target: 25, events: group('grains') },
  { id: 'seeds-25', emoji: '🐿️', name: 'Eichhörnchen', goal: 'An 25 Tagen Nüsse, Samen oder gutes Öl', reward: 40, target: 25, events: group('seeds') },
  { id: 'fish-10', emoji: '🎣', name: 'Alter Seebär', goal: 'An 10 Tagen Fisch', reward: 40, target: 10, events: group('fish'), when: hasFish },
  { id: 'streak-7', emoji: '🔥', name: 'Eine Woche grün', goal: '7 Tage in Folge Gemüse oder Obst', reward: 20, target: 7, run: true, events: (st) => st.plantDays },
  { id: 'streak-30', emoji: '🌳', name: 'Ein Monat im Grünen', goal: '30 Tage in Folge Gemüse oder Obst', reward: 100, target: 30, run: true, events: (st) => st.plantDays },
  { id: 'palette-1', emoji: '🎨', name: 'Volle Palette', goal: 'Alle Bereiche in einer Woche', reward: 20, target: 1, events: (st) => st.paletteDates },
  { id: 'palette-4', emoji: '🌈', name: 'Regenbogen-Monat', goal: 'Viermal die volle Palette', reward: 60, target: 4, events: (st) => st.paletteDates },
  { id: 'variety-20', emoji: '🧺', name: 'Bunter Korb', goal: '20 verschiedene wichtige Zutaten', reward: 40, target: 20, events: (st) => st.varietyDates },
  { id: 'season-10', emoji: '🍂', name: 'Saisonkenner', goal: '10 Mahlzeiten mit etwas, das gerade Saison hat', reward: 30, target: 10, events: (st) => st.seasonDates },
  { id: 'wish-1', emoji: '💌', name: 'Wunscherfüller', goal: 'Den ersten Wunsch erfüllt', reward: 10, target: 1, events: (st) => st.fulfilDates },
  { id: 'wish-10', emoji: '🧞', name: 'Flaschengeist', goal: '10 Wünsche erfüllt', reward: 50, target: 10, events: (st) => st.fulfilDates },
  { id: 'golden-1', emoji: '🏅', name: 'Goldesel', goal: 'Einen Goldenen Wunsch eingelöst', reward: 10, target: 1, events: (st) => st.goldenDates },
  { id: 'plan-5', emoji: '🗓️', name: 'Vorausdenker', goal: '5-mal am geplanten Tag gekocht', reward: 25, target: 5, events: (st) => st.onTimeDates },
  { id: 'quick-7', emoji: '⚡', name: 'Zwischendurch', goal: 'An 7 Tagen einen Schnell-Eintrag gemacht', reward: 20, target: 7, events: (st) => st.quickDates },
  { id: 'gapless-14', emoji: '📅', name: 'Ohne Lücke', goal: '14 Tage in Folge etwas eingetragen', reward: 50, target: 14, run: true, events: (st) => st.entryDays },
];

function evaluateRun(days, target) {
  let run = 0;
  let best = 0;
  let previous = null;
  let date = null;
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    previous = day;
    best = Math.max(best, run);
    if (!date && run >= target) date = day;
  }
  return { count: best, date };
}

export function evaluateBadges(stats) {
  return BADGES.filter((b) => !b.when || b.when()).map((b) => {
    const events = [...new Set(b.run ? b.events(stats) : [])];
    const dates = b.run ? events.sort() : [...b.events(stats)].sort();
    const { count, date } = b.run
      ? evaluateRun(dates, b.target)
      : { count: dates.length, date: dates[b.target - 1] ?? null };
    return { ...b, count: Math.min(count, b.target), earned: Boolean(date), date };
  });
}

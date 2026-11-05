// Monatsrückblick aus den Einträgen eines Monats. prefix ist 'YYYY-MM'.
import { GROUPS, dishIngredients, guessIngredients, ingredient } from './nutrition.js';
import { addDays, toISO } from './util.js';

function topOf(counts) {
  let best = null;
  for (const [key, value] of counts) {
    if (!best || value > best.value) best = { key, value };
  }
  return best;
}

const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

export function computeRecap({
  cooked, dishes, wishes, points,
}, prefix) {
  const inMonth = cooked.filter((c) => c.date.startsWith(prefix));
  const dishCounts = new Map();
  const groupCounts = new Map();
  const ingredientCounts = new Map();
  const cookCounts = new Map();
  const plantDays = new Set();

  for (const c of inMonth) {
    bump(dishCounts, c.dishId);
    bump(cookCounts, c.by);
    const dish = dishes.find((d) => d.id === c.dishId);
    const ids = dish ? dishIngredients(dish) : guessIngredients(c.dishName ?? '');
    for (const id of ids) {
      const item = ingredient(id);
      if (!item) continue;
      bump(ingredientCounts, id);
      if (!GROUPS.find((g) => g.id === item.group)?.limit) bump(groupCounts, item.group);
      if (['greens', 'veg', 'vitc'].includes(item.group)) plantDays.add(c.date);
    }
  }

  let bestRun = 0;
  let run = 0;
  let previous = null;
  for (const day of [...plantDays].sort()) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    previous = day;
    bestRun = Math.max(bestRun, run);
  }

  const topDish = topOf(dishCounts);
  const topGroup = topOf(groupCounts);
  const topIngredient = topOf(ingredientCounts);
  const meal = topDish && inMonth.find((c) => c.dishId === topDish.key);
  const current = topDish && dishes.find((d) => d.id === topDish.key);

  return {
    meals: inMonth.length,
    days: new Set(inMonth.map((c) => c.date)).size,
    topDish: topDish && {
      name: current?.name ?? meal.dishName, emoji: current?.emoji ?? meal.dishEmoji, count: topDish.value,
    },
    topGroup: topGroup && { ...GROUPS.find((g) => g.id === topGroup.key), count: topGroup.value },
    topIngredient: topIngredient && { label: ingredient(topIngredient.key).label, count: topIngredient.value },
    cooks: cookCounts,
    bestRun,
    spoons: points.entries.filter((e) => e.date.startsWith(prefix)).reduce((sum, e) => sum + e.points, 0),
    newDishes: dishes.filter((d) => d.createdAt && toISO(new Date(d.createdAt)).startsWith(prefix)).length,
    wishesDone: wishes.filter((w) => w.status === 'done' && (cooked.find((c) => c.id === w.cookedId)?.date ?? '').startsWith(prefix)).length,
    badges: points.badges.filter((b) => b.earned && b.date.startsWith(prefix)),
  };
}

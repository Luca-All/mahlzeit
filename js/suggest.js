// "Was kochen wir heute?": bewertet alle Gerichte und nennt die Gründe dafür.
import {
  coreGroups, dishIngredients, ingredient,
} from './nutrition.js';
import { GROUP_RULES, weekStart } from './points.js';
import { seasonalIngredients } from './season.js';
import {
  addDays, daysBetween, fmtRelative, fromISO, today,
} from './util.js';

export function rankDishes({
  dishes, cooked, wishes, plans, quick, meId, focus = [], otherName = 'Dein Gegenüber', random = Math.random,
}) {
  const now = today();
  const start = weekStart(now);
  const inThisWeek = (date) => date >= start && date <= addDays(start, 6);
  const season = seasonalIngredients(fromISO(now).getMonth() + 1);

  const groupsThisWeek = new Set();
  let meatMeals = 0;
  const lastCooked = new Map();
  for (const c of cooked) {
    if (!lastCooked.has(c.dishId) || c.date > lastCooked.get(c.dishId)) lastCooked.set(c.dishId, c.date);
    if (!inThisWeek(c.date)) continue;
    const dish = dishes.find((d) => d.id === c.dishId);
    if (!dish) continue;
    const groups = dishIngredients(dish).map((id) => ingredient(id)?.group);
    groups.forEach((g) => groupsThisWeek.add(g));
    if (groups.includes('meat')) meatMeals += 1;
  }
  for (const q of quick) {
    if (inThisWeek(q.date)) q.items.forEach((id) => groupsThisWeek.add(ingredient(id)?.group));
  }

  return dishes.map((dish) => {
    const ids = dishIngredients(dish);
    const groups = new Set(ids.map((id) => ingredient(id)?.group));
    const reasons = [];
    let score = random() * 10;

    if (plans.some((p) => p.dishId === dish.id && p.date === now)) {
      score += 80;
      reasons.push('Für heute geplant');
    }
    if (wishes.some((w) => w.to === meId && ['open', 'planned'].includes(w.status) && (w.dishId === dish.id || w.dishName === dish.name))) {
      score += 50;
      reasons.push(`${otherName} wünscht sich das`);
    }

    const gaps = coreGroups().filter((g) => groups.has(g.id) && !groupsThisWeek.has(g.id));
    gaps.forEach((g) => {
      score += GROUP_RULES[g.id]?.points ?? 0;
    });
    gaps.slice(0, 2).forEach((g) => reasons.push(`${g.label} fehlt diese Woche noch`));

    const provided = focus.filter((n) => ids.some((id) => ingredient(id)?.nutrients.includes(n)));
    score += provided.length * 8;
    if (provided.length) reasons.push(`Liefert ${provided.join(', ')} für deinen Fokus`);

    const seasonal = ids.filter((id) => season.has(id)).map((id) => ingredient(id).label);
    if (seasonal.length) {
      score += 10;
      reasons.push(`${seasonal[0]} hat gerade Saison`);
    }

    const last = lastCooked.get(dish.id);
    if (!last) {
      score += 10;
      reasons.push('Noch nie gekocht');
    } else {
      const days = daysBetween(last, now);
      score += Math.min(days, 30) * 0.7;
      if (days <= 3) score -= 40;
      else if (days >= 14) reasons.push(`Zuletzt ${fmtRelative(last)}`);
    }

    if (groups.has('meat') && meatMeals >= 2) score -= 30;

    return { dish, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

import {
  DATA_SOURCES, createStore, newCode, newId, normalizeCode, formatCode,
} from './store.js';
import {
  esc, toISO, fromISO, today, addDays, parseRecipeUrl, describeRecipeUrl, fmtDay, fmtLong, fmtMonth, fmtRelative, EMOJIS, guessEmoji,
} from './util.js';
import {
  DIETS, GROUPS, NUTRIENTS, QUICK_ITEMS, TIPS, activeCombos, activeGroups, conflictingIngredients, coreGroups, currentDiet,
  dishIngredients, groupsOf, guessForDish, guessIngredients, ingredient, ingredientsOfGroup, isActiveIngredient, isAssumed,
  nutrientsOf, setDiet, summarize,
} from './nutrition.js';
import {
  BONUS, GOLDEN_WISH_COST, GROUP_RULES, LEVELS, SOURCES, USAGE_RULES, computePoints, weekStart, wishBalance,
} from './points.js';
import { computeRecap } from './recap.js';
import { SEASON_SOURCE, inSeason, seasonalIngredients } from './season.js';
import { rankDishes } from './suggest.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const LOADING_HTML = app.innerHTML; // Der Ladebildschirm steht in index.html, damit er vor dem JS sichtbar ist.
const sheet = $('#sheet');
const SESSION_KEY = 'mahlzeit.session';

const S = {
  code: null,
  meId: null,
  household: null,
  dishes: [],
  cooked: [],
  wishes: [],
  plans: [],
  quick: [],
  tab: 'dishes',
  shownTab: null,
  search: '',
  sort: 'recent',
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  day: today(),
  calView: 'month',
  calWeek: weekStart(today()),
  wishTab: 'in',
  points: null,
  suggestion: null,
};
let store = null;
let unsubscribe = null;

/* ---------- Helfer ---------- */

const members = () => S.household?.members ?? {};
const me = () => members()[S.meId];
const otherId = () => Object.keys(members()).find((id) => id !== S.meId) ?? null;
const other = () => members()[otherId()] ?? null;
const personClass = (id) => (id === 'both' ? 'both' : `p${members()[id]?.color ?? 0}`);
const personName = (id) => (id === 'both' ? 'Zusammen' : members()[id]?.name || 'Jemand');
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const findDishByName = (name) => S.dishes.find((d) => sameName(d.name, name));
// Früher gab es nur ein Feld "link". Geteilte Daten können alles enthalten, deshalb wird hier geprüft.
const dishLinks = (d) => (d?.links ?? (d?.link ? [d.link] : [])).map(parseRecipeUrl).filter(Boolean);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// Fokus-Nährstoffe sind persönlich und bleiben auf diesem Gerät.
const focusKey = () => `mahlzeit.focus.${S.code}.${S.meId}`;
function loadFocus() {
  try {
    return JSON.parse(localStorage.getItem(focusKey())) ?? {};
  } catch {
    return {};
  }
}
const focusNutrients = () => Object.entries(loadFocus()).filter(([, v]) => v === 'focus').map(([n]) => n);
const supplementedNutrients = () => Object.entries(loadFocus()).filter(([, v]) => v === 'supplement').map(([n]) => n);

function selectDay(date) {
  S.day = date;
  S.month = new Date(fromISO(date).getFullYear(), fromISO(date).getMonth(), 1);
  S.calWeek = weekStart(date);
}

// Legt das Gericht an, falls es den Namen noch nicht gibt.
function resolveDish(name, emoji, ops) {
  const known = findDishByName(name);
  if (known) return known;
  const dish = {
    id: newId(), name, emoji: emoji ?? guessEmoji(name), note: '', links: [], createdBy: S.meId, createdAt: Date.now(),
  };
  const { id, ...data } = dish;
  ops.push({ type: 'set', col: 'dishes', id, data });
  return dish;
}

function whoField(who, legend) {
  const friendId = otherId();
  const option = (id, label) => `
    <label class="${personClass(id)}"><input type="radio" name="by" value="${esc(id)}" ${who === id ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  return `<fieldset class="segmented"><legend>${esc(legend)}</legend>
    ${option(S.meId, me().name)}
    ${friendId ? option(friendId, other().name) + option('both', 'Zusammen') : ''}
  </fieldset>`;
}

function dishStats() {
  const stats = new Map();
  for (const c of S.cooked) {
    const s = stats.get(c.dishId) ?? { count: 0, last: null };
    s.count += 1;
    if (!s.last || c.date > s.last) s.last = c.date;
    stats.set(c.dishId, s);
  }
  return stats;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Nicht auf das Ergebnis warten: Offline bleibt der Promise offen, bis wieder Netz da ist,
// die Änderung ist lokal aber schon sichtbar.
function commit(ops) {
  store.commit(S.code, ops).catch((err) => {
    console.error(err);
    toast('Speichern hat nicht geklappt.');
  });
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code: S.code, meId: S.meId }));
}

const ICONS = {
  dishes: '<path d="M7 3v7a3 3 0 0 0 3 3v8M4 3v5m6-5v5M17 21v-7h-2.5V8c0-2.8 1.2-5 2.5-5s2 1 2 2v16"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4m8-4v4"/>',
  wishes: '<path d="M12 20.5s-8-4.8-8-10.8A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8 3.1c0 6-8 10.8-8 10.8Z"/>',
  nutrition: '<path d="M5 19c0-8 5-14 15-15 0 11-5 16-13 15"/><path d="M5 21c1-6 4-9 9-11"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".6"/><circle cx="15" cy="15" r=".6"/><circle cx="15" cy="9" r=".6"/><circle cx="9" cy="15" r=".6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5m0 13V21m9-9h-2.5m-13 0H3m15.4-6.4-1.8 1.8M7.4 16.6l-1.8 1.8m12.8 0-1.8-1.8M7.4 7.4 5.6 5.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/* ---------- Start und Onboarding ---------- */

function installHint() {
  if (isStandalone()) return '';
  const steps = isIOS()
    ? 'Tippe in Safari auf <b>Teilen</b> und dann auf <b>Zum Home-Bildschirm</b>. Öffne Mahlzeit danach über das neue Icon und richte es erst dort ein.'
    : 'Öffne im Browser-Menü <b>App installieren</b> oder <b>Zum Startbildschirm hinzufügen</b> und starte Mahlzeit dann über das neue Icon.';
  return `<div class="hint"><strong>Erst aufs Handy holen</strong><p>${steps}</p></div>`;
}

function demoNote() {
  return store?.demo
    ? '<p class="demo-note">Demo-Modus: Die Daten bleiben auf diesem Gerät.</p>'
    : '';
}

function renderWelcome() {
  S.shownTab = null;
  app.innerHTML = `
    <main class="onboard">
      <img class="logo" src="icons/icon-192.png" alt="" width="84" height="84">
      <h1>Mahlzeit</h1>
      <p class="lead">Eure Lieblingsgerichte, wann ihr sie gekocht habt, und was ihr euch voneinander wünscht.</p>
      ${installHint()}
      <div class="stack">
        <button class="btn primary" data-action="welcomeCreate">Neue Küche anlegen</button>
        <button class="btn" data-action="welcomeJoin">Ich habe einen Code</button>
        ${store.demo ? '<button class="btn quiet" data-action="loadDemo">Mit Beispieldaten ausprobieren</button>' : ''}
      </div>
      ${demoNote()}
    </main>`;
}

function renderCreate() {
  app.innerHTML = `
    <main class="onboard">
      <h1>Wie heißt du?</h1>
      <p class="lead">Deine Küche bekommt danach einen Code, mit dem die zweite Person dazukommt.</p>
      <form class="stack" data-form="create">
        <label class="field"><span>Dein Name</span>
          <input name="name" required maxlength="24" autocomplete="given-name" autofocus></label>
        <button class="btn primary">Küche anlegen</button>
        <button class="btn quiet" type="button" data-action="toWelcome">Zurück</button>
      </form>
    </main>`;
}

function renderJoin(prefill = '') {
  app.innerHTML = `
    <main class="onboard">
      <h1>Küche beitreten</h1>
      <p class="lead">Gib den Code ein, den du bekommen hast.</p>
      <form class="stack" data-form="join">
        <label class="field"><span>Küchen-Code</span>
          <input name="code" required value="${esc(prefill)}" autocapitalize="characters"
            autocomplete="off" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>
        <p class="error" id="join-error" hidden></p>
        <button class="btn primary">Weiter</button>
        <button class="btn quiet" type="button" data-action="toWelcome">Zurück</button>
      </form>
    </main>`;
}

function renderPickPerson(code, household) {
  const list = Object.entries(household.members);
  app.innerHTML = `
    <main class="onboard">
      <h1>Wer bist du?</h1>
      <div class="stack">
        ${list.map(([id, m]) => `
          <button class="btn" data-action="pickPerson" data-id="${esc(id)}" data-code="${esc(code)}">${esc(m.name)}</button>
        `).join('')}
      </div>
      ${list.length < 2 ? `
        <form class="stack" data-form="joinNew" data-code="${esc(code)}">
          <label class="field"><span>Oder neu dabei? Dein Name</span>
            <input name="name" required maxlength="24" autocomplete="given-name"></label>
          <button class="btn primary">Beitreten</button>
        </form>` : ''}
    </main>`;
}

function renderCodeReveal() {
  app.innerHTML = `
    <main class="onboard">
      <h1>Eure Küche steht</h1>
      <p class="lead">Schick diesen Code an die zweite Person. Sie öffnet die App, tippt auf „Ich habe einen Code“ und gibt ihn ein.</p>
      <p class="code">${esc(formatCode(S.code))}</p>
      <div class="stack">
        <button class="btn primary" data-action="shareCode">Code teilen</button>
        <button class="btn" data-action="enterApp">Los geht’s</button>
      </div>
    </main>`;
}

function renderLoading() {
  // Läuft er schon, nicht neu setzen, sonst springt die Animation.
  if (!app.querySelector('.splash')) app.innerHTML = LOADING_HTML;
}

function renderFatal(text) {
  app.innerHTML = `
    <main class="onboard">
      <h1>Das hat nicht geklappt</h1>
      <p class="lead">${esc(text)}</p>
      <div class="stack"><button class="btn primary" data-action="reload">Nochmal versuchen</button></div>
    </main>`;
}

function enterHousehold() {
  unsubscribe?.();
  lastTotal = null;
  S.household = null;
  S.shownTab = null;
  renderLoading();
  // Erst rendern, wenn alles da ist, sonst blitzt kurz "Noch keine Gerichte" auf.
  const pending = new Set(DATA_SOURCES);
  unsubscribe = store.subscribe(S.code, (col, value) => {
    S[col] = value;
    if (col === 'household' && !value) {
      leaveHousehold();
      return;
    }
    pending.delete(col);
    if (!pending.size) render();
  }, (err) => {
    console.error(err);
    renderFatal('Die Verbindung zur Datenbank wurde abgelehnt. Prüfe die Firestore-Regeln und ob der Code stimmt.');
  });
}

function leaveHousehold() {
  unsubscribe?.();
  unsubscribe = null;
  localStorage.removeItem(SESSION_KEY);
  Object.assign(S, { code: null, meId: null, household: null, dishes: [], cooked: [], wishes: [], plans: [], quick: [], shownTab: null });
  document.body.className = '';
  sheet.close();
  renderWelcome();
}

/* ---------- Hauptansicht ---------- */

function render() {
  if (!me()) {
    renderPickPerson(S.code, S.household);
    return;
  }
  document.body.className = `accent-${me().color ?? 0}`;
  setDiet(S.household.diet);
  S.points = computePoints(S);
  if (S.shownTab !== S.tab) {
    S.shownTab = S.tab;
    app.innerHTML = `<main id="view"></main><div id="fab-slot"></div><nav class="tabs" aria-label="Bereiche" id="tabs"></nav>`;
    if (S.tab === 'dishes') renderDishesShell();
    scrollTo(0, 0);
  }
  if (S.tab === 'dishes') updateDishes();
  if (S.tab === 'calendar') renderCalendar();
  if (S.tab === 'wishes') renderWishes();
  if (S.tab === 'nutrition') renderNutrition();
  renderTabs();
  renderFab();
  document.querySelectorAll('.level-pill').forEach((el) => {
    el.innerHTML = levelPill();
  });
  notePointsChange();
}

function renderTabs() {
  const openIn = S.wishes.filter((w) => w.to === S.meId && w.status === 'open').length;
  const tab = (id, label, badge = 0) => `
    <button data-action="tab" data-tab="${id}" ${S.tab === id ? 'aria-current="page"' : ''}>
      ${icon(id)}<span>${label}</span>
      ${badge ? `<i class="badge" aria-label="${badge} offen">${badge}</i>` : ''}
    </button>`;
  $('#tabs').innerHTML = tab('dishes', 'Gerichte') + tab('calendar', 'Kalender') + tab('wishes', 'Wünsche', openIn) + tab('nutrition', 'Ernährung');
}

function renderFab() {
  const fab = (action, label) => `<button class="fab" data-action="${action}">${icon('plus')}<span>${label}</span></button>`;
  let html = '';
  if (S.tab === 'dishes') html = fab('newDish', 'Gericht');
  if (S.tab === 'calendar') {
    html = S.calView === 'month' && S.day <= today() ? fab('newCookForDay', 'Eintragen') : fab('newPlan', 'Einplanen');
  }
  if (S.tab === 'wishes' && other()) html = fab('newWish', 'Wünschen');
  if (S.tab === 'nutrition') html = fab('newCook', 'Eintragen');
  $('#fab-slot').innerHTML = html;
}

const levelPill = () => {
  const p = S.points;
  return p ? `<span aria-hidden="true">${p.level.emoji}</span> <span class="visually-hidden">Level </span>${p.level.number} · ${p.total.toLocaleString('de-DE')} 🥄` : '';
};

const topBar = (title) => `
  <header class="top">
    <h1>${esc(title)}</h1>
    <div class="top-actions">
      <button class="level-pill" data-action="openPoints">${levelPill()}</button>
      <button class="icon-btn" data-action="settings" aria-label="Einstellungen">${icon('gear')}</button>
    </div>
  </header>`;

/* ---------- Gerichte ---------- */

function renderDishesShell() {
  const sorts = [['recent', 'Zuletzt'], ['stale', 'Lange nicht'], ['often', 'Am häufigsten'], ['az', 'A–Z']];
  $('#view').innerHTML = `
    ${topBar('Gerichte')}
    <button class="suggest-cta" data-action="suggest"><span aria-hidden="true">🎲</span> Was kochen wir heute?</button>
    <div class="searchbar"><input type="search" id="dish-search" placeholder="Gericht suchen" aria-label="Gericht suchen" value="${esc(S.search)}"></div>
    <div class="chips" role="group" aria-label="Sortierung" id="sort-chips">
      ${sorts.map(([id, label]) => `<button class="chip" data-action="sort" data-sort="${id}">${label}</button>`).join('')}
    </div>
    <ul class="list" id="dish-list"></ul>`;
}

function updateDishes() {
  const stats = dishStats();
  const statOf = (d) => stats.get(d.id) ?? { count: 0, last: null };
  const q = S.search.trim().toLowerCase();
  const list = S.dishes.filter((d) => d.name.toLowerCase().includes(q));
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  const comparators = {
    az: byName,
    often: (a, b) => statOf(b).count - statOf(a).count || byName(a, b),
    recent: (a, b) => (statOf(b).last ?? '').localeCompare(statOf(a).last ?? '') || byName(a, b),
    stale: (a, b) => (statOf(a).last ?? '').localeCompare(statOf(b).last ?? '') || byName(a, b),
  };
  list.sort(comparators[S.sort]);

  document.querySelectorAll('#sort-chips .chip').forEach((c) => {
    c.setAttribute('aria-pressed', String(c.dataset.sort === S.sort));
  });

  const el = $('#dish-list');
  if (!S.dishes.length) {
    el.innerHTML = `<li class="empty"><span class="empty-emoji">🍝</span>
      <strong>Noch keine Gerichte</strong><p>Fangt mit dem an, was ihr am liebsten esst.</p></li>`;
    return;
  }
  if (!list.length) {
    el.innerHTML = `<li class="empty"><strong>Kein Treffer</strong>
      <p>„${esc(S.search)}“ gibt es noch nicht.</p>
      <button class="btn" data-action="newDish" data-name="${esc(S.search.trim())}">Als Gericht anlegen</button></li>`;
    return;
  }
  el.innerHTML = list.map((d) => {
    const s = statOf(d);
    const meta = s.count ? `${s.count}× gekocht · ${fmtRelative(s.last)}` : 'Noch nie gekocht';
    return `<li><button class="row" data-action="openDish" data-id="${esc(d.id)}">
      <span class="tile">${esc(d.emoji)}</span>
      <span class="row-text"><b>${esc(d.name)}</b><small>${esc(meta)}</small>${foodBadges(d)}${dishTags(d)}</span>
      ${icon('next')}
    </button></li>`;
  }).join('');
}

function openDish(id) {
  const d = S.dishes.find((x) => x.id === id);
  if (!d) return;
  const logs = S.cooked.filter((c) => c.dishId === id).sort((a, b) => b.date.localeCompare(a.date));
  const friend = other();
  openSheet(`
    <div class="sheet-head">
      <span class="tile big">${esc(d.emoji)}</span>
      <h2>${esc(d.name)}</h2>
    </div>
    <dl class="stats">
      <div><dt>Gekocht</dt><dd>${logs.length}×</dd></div>
      <div><dt>Zuletzt</dt><dd>${logs.length ? esc(fmtRelative(logs[0].date)) : '–'}</dd></div>
    </dl>
    ${dishIngredientsSection(d)}
    ${d.note ? `<p class="note">${esc(d.note)}</p>` : ''}
    ${recipeSection(d)}
    <div class="stack">
      <button class="btn primary" data-action="newCook" data-dish="${esc(d.id)}">Gekocht eintragen</button>
      <button class="btn" data-action="newPlan" data-dish="${esc(d.id)}">Einplanen</button>
      ${friend ? `<button class="btn" data-action="newWish" data-dish="${esc(d.id)}">Von ${esc(friend.name)} wünschen</button>` : ''}
    </div>
    ${logs.length ? `<h3>Verlauf</h3><ul class="history">
      ${logs.slice(0, 12).map((c) => `<li><span>${esc(fmtDay(c.date))}</span>
        <span class="person ${personClass(c.by)}">${esc(personName(c.by))}</span></li>`).join('')}
    </ul>` : ''}
    <div class="sheet-foot">
      <button class="btn quiet" data-action="editDish" data-id="${esc(d.id)}">Bearbeiten</button>
      <button class="btn quiet" data-action="closeSheet">Schließen</button>
    </div>`);
}

function openDishForm(id, presetName = '', preset = {}) {
  const d = S.dishes.find((x) => x.id === id);
  const name = d?.name ?? presetName;
  const chosen = d?.ingredients ?? preset.ingredients ?? null;
  const selected = chosen ?? (d ? guessForDish(d) : guessIngredients(name));
  const current = d?.emoji ?? guessEmoji(name);
  openSheet(`
    <h2>${d ? 'Gericht bearbeiten' : 'Neues Gericht'}</h2>
    <form class="stack" data-form="dish" data-id="${esc(id ?? '')}" ${d ? 'data-touched="1"' : ''} ${chosen ? 'data-ing-touched="1"' : ''}>
      <label class="field"><span>Name</span>
        <input name="name" required maxlength="60" value="${esc(name)}" data-guess-emoji></label>
      <fieldset class="emoji-grid"><legend>Symbol</legend>
        ${EMOJIS.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${e === current ? 'checked' : ''}><span>${e}</span></label>`).join('')}
      </fieldset>
      <label class="field"><span>Notiz (optional)</span>
        <textarea name="note" rows="3" maxlength="1000" placeholder="Tricks, was beim letzten Mal besser ging">${esc(d?.note ?? preset.note)}</textarea></label>
      ${ingredientFields(selected, !chosen)}
      <label class="field"><span>Weitere Zutaten (optional)</span>
        <input name="otherIngredients" maxlength="300" placeholder="Hackfleisch, Tomaten, Basilikum" value="${esc(d?.otherIngredients)}"></label>
      <div class="field"><span>Rezept-Links (optional)</span>
        <div class="link-rows" id="link-rows">${(dishLinks(d).length ? dishLinks(d) : ['']).map(linkRow).join('')}</div>
        <button class="btn small add-link" type="button" data-action="addLinkRow">Weiteren Link</button>
      </div>
      <p class="error" id="dish-error" hidden></p>
      <button class="btn primary">Speichern</button>
      ${d ? `<button class="btn danger" type="button" data-action="confirmDeleteDish" data-id="${esc(d.id)}">Gericht löschen</button>` : ''}
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

/* ---------- Zutaten und Abzeichen ---------- */

function foodBadges(dish) {
  const groups = groupsOf(dishIngredients(dish)).filter((g) => !g.limit);
  if (!groups.length) return '';
  const assumed = isAssumed(dish);
  return `<span class="badges">${groups.map((g) => {
    const label = `${g.label}${assumed ? ' (angenommen)' : ''}`;
    return `<i class="food ${assumed ? 'assumed' : ''}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${g.badge}</i>`;
  }).join('')}</span>`;
}

function dishTags(d) {
  const ids = dishIngredients(d);
  const focus = focusNutrients().filter((n) => nutrientsOf(ids).includes(n));
  const season = seasonalIngredients(new Date().getMonth() + 1);
  const seasonal = ids.find((id) => season.has(id));
  if (!focus.length && !seasonal) return '';
  return `<span class="tags">
    ${focus.length ? `<span class="tag focus">⭐ ${esc(focus.slice(0, 2).join(', '))}</span>` : ''}
    ${seasonal ? `<span class="tag">🍂 ${esc(ingredient(seasonal).label)}</span>` : ''}
  </span>`;
}

function dishIngredientsSection(d) {
  const ids = dishIngredients(d);
  const groups = groupsOf(ids);
  const rows = groups.map((g) => {
    const names = ids.map(ingredient).filter((i) => i?.group === g.id).map((i) => i.label);
    return `<li><i class="food ${isAssumed(d) ? 'assumed' : ''}" aria-hidden="true">${g.badge}</i>
      <span class="row-text"><b>${esc(g.label)}</b><small>${esc(names.join(', '))}</small></span></li>`;
  }).join('');
  const conflicts = conflictingIngredients(d).map((id) => ingredient(id)?.label).filter(Boolean);
  const conflictNote = conflicts.length
    ? `<div class="assumed-note"><span>${isAssumed(d) ? 'Vermutlich' : 'Enthält'} ${esc(conflicts.join(', '))}, das zählt bei ${esc(currentDiet().label)} nicht.</span>
        <button class="btn small" data-action="confirmIngredients" data-id="${esc(d.id)}">Ist nicht drin</button></div>`
    : '';
  const assumedNote = isAssumed(d) && groups.length && !conflicts.length
    ? `<div class="assumed-note"><span>Aus dem Namen angenommen.</span>
        <button class="btn small" data-action="confirmIngredients" data-id="${esc(d.id)}">Stimmt so</button></div>`
    : '';
  return `<section class="dish-ingredients">
    <h3>Wichtige Zutaten</h3>
    ${rows ? `<ul class="food-list">${rows}</ul>` : '<p class="muted">Noch keine erkannt. Trag sie über „Bearbeiten“ ein.</p>'}
    ${assumedNote}
    ${conflictNote}
    ${d.otherIngredients ? `<p class="muted">Außerdem: ${esc(d.otherIngredients)}</p>` : ''}
  </section>`;
}

function ingredientFields(selected, assumed) {
  return `<fieldset class="ingredients ${assumed ? 'assumed' : ''}"><legend>Wichtige Zutaten</legend>
    <p class="ing-hint">Gestrichelt ist angenommen. Antippen zum Ändern.</p>
    ${activeGroups().map((g) => {
      const items = ingredientsOfGroup(g.id);
      const count = items.filter((i) => selected.includes(i.id)).length;
      return `<details data-group="${g.id}" ${count ? 'open' : ''}>
        <summary>${g.badge} ${esc(g.label)} <small class="ing-count">${count || ''}</small></summary>
        <div class="ing-list">${items.map((i) => `<label class="ing"><input type="checkbox" name="ing" value="${i.id}" ${selected.includes(i.id) ? 'checked' : ''}><span>${esc(i.label)}</span></label>`).join('')}</div>
      </details>`;
    }).join('')}
  </fieldset>`;
}

function refreshIngredientCounts(form) {
  form.querySelectorAll('details[data-group]').forEach((el) => {
    const count = el.querySelectorAll('input:checked').length;
    el.querySelector('.ing-count').textContent = count || '';
    if (count) el.open = true;
  });
}

// Solange niemand selbst gewählt hat, folgt die Auswahl dem, was in Name und Notiz steht.
function syncAssumedIngredients(form) {
  if (form.dataset.ingTouched) return;
  const f = new FormData(form);
  const guessed = guessIngredients(`${f.get('name')} ${f.get('note')} ${f.get('otherIngredients')}`);
  form.querySelectorAll('input[name="ing"]').forEach((input) => {
    input.checked = guessed.includes(input.value);
  });
  refreshIngredientCounts(form);
}

/* ---------- Rezept-Links ---------- */

const LINK_INPUT_ATTRS = 'type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" maxlength="2000"';

function linkRow(url = '') {
  return `<div class="link-row">
    <input name="links" ${LINK_INPUT_ATTRS} aria-label="Rezept-Link" placeholder="chefkoch.de/rezepte/…" value="${esc(url)}">
    <button class="icon-btn" type="button" data-action="removeLinkRow" aria-label="Link entfernen">×</button>
  </div>`;
}

function recipeSection(d) {
  const links = dishLinks(d);
  return `<section class="recipes">
    <h3>Rezepte</h3>
    ${links.length ? `<ul class="recipe-list">${links.map((href) => {
    const { source, title } = describeRecipeUrl(href);
    return `<li><a class="recipe-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
        <span class="row-text"><b>${esc(title || source)}</b>${title ? `<small>${esc(source)}</small>` : ''}</span>
        ${icon('external')}
      </a></li>`;
  }).join('')}</ul>` : ''}
    <button class="btn small add-link" data-action="addLink" data-id="${esc(d.id)}">${links.length ? 'Weiteren Link hinzufügen' : 'Rezept-Link hinzufügen'}</button>
  </section>`;
}

function openAddLink(id) {
  const d = S.dishes.find((x) => x.id === id);
  openSheet(`
    <h2>Rezept zu ${esc(d.name)}</h2>
    <form class="stack" data-form="addLink" data-id="${esc(id)}">
      <label class="field"><span>Link</span>
        <input name="url" required ${LINK_INPUT_ATTRS} placeholder="chefkoch.de/rezepte/…"></label>
      <p class="muted setting-hint">Kopier den Link aus Chefkoch, Kitchen Stories oder von jeder anderen Seite und füg ihn hier ein.</p>
      <p class="error" id="link-error" hidden></p>
      <button class="btn primary">Hinzufügen</button>
      <button class="btn quiet" type="button" data-action="openDish" data-id="${esc(id)}">Zurück</button>
    </form>`);
}

/* ---------- Gericht-Auswahl (Eintragen und Wünschen) ---------- */

function dishPicker(value = '') {
  return `
    <label class="field"><span>Gericht</span>
      <input name="dishName" required maxlength="60" value="${esc(value)}" autocomplete="off" data-dish-picker
        placeholder="Tippen oder unten auswählen"></label>
    <div class="suggest" id="dish-suggest">${dishSuggestions(value)}</div>`;
}

function dishSuggestions(query) {
  const q = query.trim().toLowerCase();
  const stats = dishStats();
  const hits = S.dishes
    .filter((d) => d.name.toLowerCase().includes(q) && !sameName(d.name, query))
    .sort((a, b) => (stats.get(b.id)?.count ?? 0) - (stats.get(a.id)?.count ?? 0))
    .slice(0, 8);
  const isNew = q && !findDishByName(query);
  return hits.map((d) => `<button type="button" class="chip" data-action="pickDish" data-name="${esc(d.name)}">${esc(d.emoji)} ${esc(d.name)}</button>`).join('')
    + (isNew ? '<small class="new-hint">Neu: Wird beim Kochen als Gericht gespeichert.</small>' : '');
}

/* ---------- Gekocht eintragen ---------- */

function openCookForm({
  dishId = null, dishName = '', date = today(), wishId = null, planId = null, by = null,
} = {}) {
  const dish = S.dishes.find((d) => d.id === dishId);
  const cookDate = date > today() ? today() : date;
  openSheet(`
    <h2>Gekocht eintragen</h2>
    <form class="stack" data-form="cook" data-wish="${esc(wishId ?? '')}" data-plan="${esc(planId ?? '')}">
      ${dish
    ? `<input type="hidden" name="dishName" value="${esc(dish.name)}"><p class="picked"><span class="tile">${esc(dish.emoji)}</span><b>${esc(dish.name)}</b></p>`
    : dishPicker(dishName)}
      <label class="field"><span>Wann</span>
        <input type="date" name="date" required value="${esc(cookDate)}" max="${today()}"></label>
      ${whoField(by ?? S.meId, 'Wer hat gekocht?')}
      <label class="field"><span>Notiz (optional)</span>
        <input name="note" maxlength="200" placeholder="War besonders gut, weil …"></label>
      <button class="btn primary">Eintragen</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

function saveCook(form) {
  const f = new FormData(form);
  const name = f.get('dishName').trim();
  const by = f.get('by');
  const date = f.get('date');
  const ops = [];
  const wish = S.wishes.find((w) => w.id === form.dataset.wish);
  const dish = resolveDish(name, wish?.dishEmoji, ops);

  // Passende Pläne erledigen sich mit dem Eintrag. "Wie geplant" gilt nur am geplanten Tag.
  const donePlans = S.plans.filter((p) => p.id === form.dataset.plan || (p.dishId === dish.id && p.date === date));
  donePlans.forEach((p) => ops.push({ type: 'delete', col: 'plans', id: p.id }));

  const logId = newId();
  ops.push({
    type: 'set', col: 'cooked', id: logId,
    data: {
      dishId: dish.id, dishName: dish.name, dishEmoji: dish.emoji, date, by,
      note: f.get('note').trim(), fromPlan: donePlans.some((p) => p.date === date), createdBy: S.meId, createdAt: Date.now(),
    },
  });

  // Wer ein gewünschtes Gericht kocht, erfüllt den Wunsch, auch ohne Umweg über den Wünsche-Tab.
  const fulfilled = S.wishes.filter((w) => ['open', 'planned'].includes(w.status)
    && (w.id === form.dataset.wish
      || ((w.dishId === dish.id || sameName(w.dishName, dish.name)) && (w.to === by || by === 'both'))));
  for (const w of fulfilled) {
    ops.push({
      type: 'update', col: 'wishes', id: w.id,
      data: { status: 'done', cookedId: logId, dishId: dish.id, resolvedAt: Date.now() },
    });
  }

  commit(ops);
  sheet.close();
  toast(fulfilled.length ? `Eingetragen. Wunsch von ${personName(fulfilled[0].from)} erfüllt!` : 'Eingetragen.');
}

function openCookEdit(id) {
  const c = S.cooked.find((x) => x.id === id);
  if (!c) return;
  openSheet(`
    <h2>Eintrag bearbeiten</h2>
    <form class="stack" data-form="cookEdit" data-id="${esc(id)}">
      <p class="picked"><span class="tile">${esc(c.dishEmoji)}</span><b>${esc(S.dishes.find((d) => d.id === c.dishId)?.name ?? c.dishName)}</b></p>
      <label class="field"><span>Verschieben auf</span>
        <input type="date" name="date" required value="${esc(c.date)}" max="${today()}"></label>
      ${whoField(c.by, 'Wer hat gekocht?')}
      <label class="field"><span>Notiz (optional)</span>
        <input name="note" maxlength="200" value="${esc(c.note)}"></label>
      <button class="btn primary">Speichern</button>
      <button class="btn danger" type="button" data-action="confirmDeleteCook" data-id="${esc(id)}">Eintrag löschen</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

/* ---------- Wochenplan ---------- */

function openPlanDish({ dishId = null, date = null } = {}) {
  const dish = S.dishes.find((d) => d.id === dishId);
  const planDate = date && date >= today() ? date : today();
  openSheet(`
    <h2>Gericht einplanen</h2>
    <form class="stack" data-form="planDish">
      ${dish
    ? `<input type="hidden" name="dishName" value="${esc(dish.name)}"><p class="picked"><span class="tile">${esc(dish.emoji)}</span><b>${esc(dish.name)}</b></p>`
    : dishPicker('')}
      <label class="field"><span>Wann</span>
        <input type="date" name="date" required min="${today()}" value="${esc(planDate)}"></label>
      ${whoField(S.meId, 'Wer kocht?')}
      <button class="btn primary">Einplanen</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

function openPlanEntry(id) {
  const p = S.plans.find((x) => x.id === id);
  if (!p) return;
  openSheet(`
    <h2>Geplantes Gericht</h2>
    <form class="stack" data-form="planEdit" data-id="${esc(id)}">
      <p class="picked"><span class="tile planned">${esc(p.dishEmoji)}</span><b>${esc(S.dishes.find((d) => d.id === p.dishId)?.name ?? p.dishName)}</b></p>
      <label class="field"><span>Verschieben auf</span>
        <input type="date" name="date" required min="${today()}" value="${esc(p.date >= today() ? p.date : today())}"></label>
      ${whoField(p.by, 'Wer kocht?')}
      <button class="btn">Speichern</button>
      <button class="btn primary" type="button" data-action="cookPlan" data-id="${esc(id)}">Gekocht eintragen</button>
      <button class="btn danger" type="button" data-action="deletePlan" data-id="${esc(id)}">Plan entfernen</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

/* ---------- Schnell-Eintrag ---------- */

const quickId = (date) => `${date}_${S.meId}`;
const quickNames = (q) => q.items.filter(isActiveIngredient).map((id) => ingredient(id)?.label).filter(Boolean);

function openQuick(date = today()) {
  const entry = S.quick.find((q) => q.id === quickId(date));
  const selected = entry?.items ?? [];
  const groups = activeGroups().filter((g) => QUICK_ITEMS.some((id) => ingredient(id)?.group === g.id && isActiveIngredient(id)));
  openSheet(`
    <h2>Nebenbei gegessen</h2>
    <p class="muted">Frühstück, Obst, Nüsse: alles, wofür sich kein Gericht lohnt. Das gilt nur für dich.</p>
    <form class="stack" data-form="quick">
      <label class="field"><span>Wann</span>
        <input type="date" name="date" required value="${esc(date)}" max="${today()}" data-quick-date></label>
      <div class="ingredients">
        ${groups.map((g) => `<div class="quick-group"><h3>${g.badge} ${esc(g.label)}</h3>
          <div class="ing-list">${QUICK_ITEMS.filter((id) => ingredient(id)?.group === g.id).map((id) => `<label class="ing"><input type="checkbox" name="item" value="${id}" ${selected.includes(id) ? 'checked' : ''}><span>${esc(ingredient(id).label)}</span></label>`).join('')}</div>
        </div>`).join('')}
      </div>
      <button class="btn primary">Speichern</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

function quickCard() {
  const entry = S.quick.find((q) => q.id === quickId(today()));
  const names = entry ? quickNames(entry) : [];
  return `<button class="quick-card" data-action="openQuick">
    <span class="tile" aria-hidden="true">⚡</span>
    <span class="row-text"><b>Heute nebenbei</b><small>${names.length ? esc(names.join(', ')) : 'Frühstück, Obst oder Nüsse schnell antippen'}</small></span>
    ${icon(names.length ? 'next' : 'plus')}
  </button>`;
}

/* ---------- Was kochen wir heute? ---------- */

function openSuggestion(step = 0) {
  if (!S.dishes.length) {
    openSheet(`<h2>Was kochen wir heute?</h2>
      <p class="muted">Dafür braucht es erst ein paar Gerichte.</p>
      <div class="stack"><button class="btn primary" data-action="newDish">Gericht anlegen</button>
      <button class="btn quiet" data-action="closeSheet">Schließen</button></div>`);
    return;
  }
  if (!S.suggestion || !step) {
    S.suggestion = {
      index: 0,
      list: rankDishes({
        dishes: S.dishes, cooked: S.cooked, wishes: S.wishes, plans: S.plans, quick: S.quick, meId: S.meId,
        focus: focusNutrients(), otherName: other()?.name,
      }),
    };
  } else {
    S.suggestion.index = (S.suggestion.index + step) % S.suggestion.list.length;
  }
  const { dish, reasons } = S.suggestion.list[S.suggestion.index];
  openSheet(`
    <div class="suggestion">
      <span class="suggest-emoji" aria-hidden="true">${esc(dish.emoji)}</span>
      <p class="muted">Wie wäre es mit</p>
      <h2>${esc(dish.name)}</h2>
      ${foodBadges(dish)}
      ${reasons.length ? `<ul class="reasons">${reasons.slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="stack">
      <button class="btn primary" data-action="planToday" data-id="${esc(dish.id)}">Für heute einplanen</button>
      <button class="btn" data-action="suggestNext">${icon('dice')} Nochmal würfeln</button>
      <button class="btn quiet" data-action="openDish" data-id="${esc(dish.id)}">Details ansehen</button>
    </div>`);
}

/* ---------- Kalender ---------- */

function calendarData() {
  const collect = (list, dateOf) => {
    const map = new Map();
    for (const item of list) {
      const date = dateOf(item);
      if (!date) continue;
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(item);
    }
    return map;
  };
  return {
    cooked: collect(S.cooked, (c) => c.date),
    wishes: collect(S.wishes.filter((w) => w.status === 'planned'), (w) => w.plannedDate),
    plans: collect(S.plans, (p) => p.date),
    quick: collect(S.quick, (q) => q.date),
  };
}

function dayEntries(date, data) {
  const now = today();
  const dishName = (item) => S.dishes.find((d) => d.id === item.dishId)?.name ?? item.dishName;
  return [
    ...(data.cooked.get(date) ?? []).map((c) => `<li class="entry">
      <span class="tile">${esc(c.dishEmoji)}</span>
      <span class="row-text"><b>${esc(dishName(c))}</b>
        <small><span class="person ${personClass(c.by)}">${esc(personName(c.by))}</span>${c.note ? ` · ${esc(c.note)}` : ''}</small>
        ${foodBadges(S.dishes.find((d) => d.id === c.dishId) ?? { name: c.dishName })}</span>
      <button class="btn quiet small" data-action="editCook" data-id="${esc(c.id)}">Bearbeiten</button>
    </li>`),
    ...(data.plans.get(date) ?? []).map((p) => `<li class="entry">
      <span class="tile planned">${esc(p.dishEmoji)}</span>
      <span class="row-text"><b>${esc(dishName(p))}</b>
        <small>${date < now ? 'War geplant' : 'Geplant'} · <span class="person ${personClass(p.by)}">${esc(personName(p.by))}</span></small></span>
      <button class="btn quiet small" data-action="openPlan" data-id="${esc(p.id)}">Bearbeiten</button>
    </li>`),
    ...(data.wishes.get(date) ?? []).map((w) => `<li class="entry">
      <span class="tile planned">${esc(w.dishEmoji)}</span>
      <span class="row-text"><b>${esc(w.dishName)}</b>
        <small>Wunsch · <span class="person ${personClass(w.to)}">${esc(personName(w.to))}</span> kocht</small></span>
      ${w.to === S.meId ? `<button class="btn quiet small" data-action="planWish" data-id="${esc(w.id)}">Verschieben</button>` : ''}
    </li>`),
    ...(data.quick.get(date) ?? []).filter((q) => quickNames(q).length).map((q) => `<li class="entry">
      <span class="tile">⚡</span>
      <span class="row-text"><b>Nebenbei</b>
        <small><span class="person ${personClass(q.who)}">${esc(personName(q.who))}</span> · ${esc(quickNames(q).join(', '))}</small></span>
      ${q.who === S.meId ? `<button class="btn quiet small" data-action="openQuick" data-date="${esc(date)}">Bearbeiten</button>` : ''}
    </li>`),
  ].join('');
}

function monthView(data) {
  const first = S.month;
  const year = first.getFullYear();
  const month = first.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Woche beginnt am Montag
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const now = today();

  let cells = '<span class="blank"></span>'.repeat(leading);
  for (let n = 1; n <= daysInMonth; n += 1) {
    const iso = `${prefix}-${String(n).padStart(2, '0')}`;
    const cooked = data.cooked.get(iso) ?? [];
    const planned = [...(data.plans.get(iso) ?? []).map((p) => ({ emoji: p.dishEmoji, who: p.by, name: p.dishName })),
      ...(data.wishes.get(iso) ?? []).map((w) => ({ emoji: w.dishEmoji, who: w.to, name: w.dishName }))];
    const marks = [
      ...cooked.map((c) => `<i class="meal ${personClass(c.by)}">${esc(c.dishEmoji)}</i>`),
      ...planned.map((p) => `<i class="meal planned ${personClass(p.who)}">${esc(p.emoji)}</i>`),
    ];
    const names = [...cooked.map((c) => c.dishName), ...planned.map((p) => `${p.name} (geplant)`)];
    const label = `${fmtLong(iso)}${names.length ? `: ${names.join(', ')}` : ''}`;
    cells += `<button class="day ${iso === now ? 'today' : ''}" data-action="pickDay" data-day="${iso}"
      aria-pressed="${iso === S.day}" aria-label="${esc(label)}">
      <span class="num">${n}</span>
      <span class="meals">${marks.slice(0, 2).join('')}${marks.length > 2 ? `<small>+${marks.length - 2}</small>` : ''}</span>
    </button>`;
  }

  const inMonth = S.cooked.filter((c) => c.date.startsWith(prefix));
  const tally = (id) => inMonth.filter((c) => c.by === id || c.by === 'both').length;
  const summary = inMonth.length
    ? `${inMonth.length}× gekocht${Object.keys(members()).length > 1
      ? ` · ${Object.entries(members()).map(([id, m]) => `<span class="person p${m.color}">${esc(m.name)} ${tally(id)}</span>`).join(' ')}` : ''}`
    : 'Diesen Monat noch nichts eingetragen';

  const entries = dayEntries(S.day, data);
  return `
    <div class="month-nav">
      <button class="icon-btn" data-action="month" data-step="-1" aria-label="Voriger Monat">${icon('back')}</button>
      <h2>${esc(fmtMonth(first))}</h2>
      <button class="icon-btn" data-action="month" data-step="1" aria-label="Nächster Monat">${icon('next')}</button>
    </div>
    <div class="weekdays" aria-hidden="true">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="grid">${cells}</div>
    <p class="summary">${summary}</p>
    ${inMonth.length ? `<button class="btn small recap-btn" data-action="openRecap" data-prefix="${prefix}">🎞️ Rückblick ${esc(fmtMonth(first))}</button>` : ''}
    <section class="day-panel">
      <h3>${esc(fmtLong(S.day))}</h3>
      ${entries ? `<ul class="list">${entries}</ul>` : `<p class="muted">${S.day > now ? 'Für diesen Tag ist nichts geplant.' : 'An diesem Tag ist nichts eingetragen.'}</p>`}
      ${S.day >= now ? `<button class="btn small day-plan" data-action="newPlan" data-date="${S.day}">Für diesen Tag einplanen</button>` : ''}
    </section>`;
}

function weekView(data) {
  const now = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(S.calWeek, i));
  const title = `${fmtDay(days[0])} bis ${fmtDay(days[6])}`;
  return `
    <div class="month-nav">
      <button class="icon-btn" data-action="week" data-step="-7" aria-label="Vorige Woche">${icon('back')}</button>
      <h2 class="week-title">${esc(title)}</h2>
      <button class="icon-btn" data-action="week" data-step="7" aria-label="Nächste Woche">${icon('next')}</button>
    </div>
    <ul class="week">${days.map((date) => {
    const entries = dayEntries(date, data);
    return `<li class="week-day ${date === now ? 'today' : ''}">
        <div class="week-head">
          <h3>${esc(fmtLong(date))}</h3>
          <span class="week-actions">
            ${date >= now ? `<button class="btn quiet small" data-action="newPlan" data-date="${date}">Einplanen</button>` : ''}
            ${date <= now ? `<button class="btn quiet small" data-action="newCookOn" data-date="${date}">Eintragen</button>` : ''}
          </span>
        </div>
        ${entries ? `<ul class="list">${entries}</ul>` : ''}
      </li>`;
  }).join('')}</ul>`;
}

function renderCalendar() {
  const data = calendarData();
  $('#view').innerHTML = `
    ${topBar('Kalender')}
    <div class="switch" role="group" aria-label="Ansicht">
      <button data-action="calView" data-view="month" aria-pressed="${S.calView === 'month'}">Monat</button>
      <button data-action="calView" data-view="week" aria-pressed="${S.calView === 'week'}">Woche</button>
    </div>
    ${S.calView === 'month' ? monthView(data) : weekView(data)}`;
}

/* ---------- Rückblick ---------- */

function recapText(prefix) {
  const r = computeRecap({ ...S, points: S.points }, prefix);
  const month = fmtMonth(fromISO(`${prefix}-01`));
  const lines = [`Unser ${month} bei Mahlzeit:`, `🍽️ ${r.meals}× gekocht an ${r.days} Tagen`];
  if (r.topDish) lines.push(`👑 Liebling: ${r.topDish.name} (${r.topDish.count}×)`);
  if (r.topGroup) lines.push(`${r.topGroup.badge} Am häufigsten: ${r.topGroup.label}`);
  lines.push(`🥄 ${r.spoons} Löffel verdient`);
  return lines.join('\n');
}

function openRecap(prefix) {
  const r = computeRecap({ ...S, points: S.points }, prefix);
  const month = fmtMonth(fromISO(`${prefix}-01`));
  const stat = (value, label) => `<div><dd>${esc(value)}</dd><dt>${esc(label)}</dt></div>`;
  const cooks = [...r.cooks.entries()].sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `<span class="person ${personClass(id)}">${esc(personName(id))} ${n}×</span>`).join(' ');
  openSheet(`
    <div class="recap">
      <p class="muted">Euer Rückblick</p>
      <h2>${esc(month)}</h2>
      ${r.topDish ? `<div class="recap-hero"><span aria-hidden="true">${esc(r.topDish.emoji)}</span>
        <div><small>Liebling des Monats</small><b>${esc(r.topDish.name)}</b><small>${r.topDish.count}× gekocht</small></div></div>` : ''}
      <dl class="recap-stats">
        ${stat(`${r.meals}×`, 'gekocht')}
        ${stat(r.days, r.days === 1 ? 'Kochtag' : 'Kochtage')}
        ${stat(r.spoons.toLocaleString('de-DE'), 'Löffel verdient')}
        ${stat(r.bestRun, r.bestRun === 1 ? 'Tag Gemüse-Serie' : 'Tage Gemüse-Serie')}
        ${stat(r.wishesDone, r.wishesDone === 1 ? 'Wunsch erfüllt' : 'Wünsche erfüllt')}
        ${stat(r.newDishes, r.newDishes === 1 ? 'neues Gericht' : 'neue Gerichte')}
      </dl>
      ${r.topGroup ? `<p>${r.topGroup.badge} Am häufigsten dabei: <b>${esc(r.topGroup.label)}</b></p>` : ''}
      ${r.topIngredient ? `<p>🥇 Top-Zutat: <b>${esc(r.topIngredient.label)}</b> (${r.topIngredient.count}×)</p>` : ''}
      ${cooks ? `<p class="contribution">${cooks}</p>` : ''}
      ${r.badges.length ? `<p>Neue Abzeichen: ${r.badges.map((b) => `${b.emoji} ${esc(b.name)}`).join(', ')}</p>` : ''}
    </div>
    <div class="stack">
      <button class="btn primary" data-action="shareRecap" data-prefix="${prefix}">Rückblick teilen</button>
      <button class="btn quiet" data-action="closeSheet">Schließen</button>
    </div>`);
}

/* ---------- Wünsche ---------- */

function renderWishes() {
  const friend = other();
  if (!friend) {
    $('#view').innerHTML = `
      ${topBar('Wünsche')}
      <div class="empty"><span class="empty-emoji">💌</span>
        <strong>Noch niemand zum Wünschen da</strong>
        <p>Schick der zweiten Person euren Küchen-Code.</p>
        <p class="code">${esc(formatCode(S.code))}</p>
        <button class="btn primary" data-action="shareCode">Code teilen</button>
      </div>`;
    return;
  }

  const active = (w) => w.status === 'open' || w.status === 'planned';
  const newest = (a, b) => b.createdAt - a.createdAt;
  const incoming = S.wishes.filter((w) => w.to === S.meId && active(w)).sort(newest);
  const outgoing = S.wishes.filter((w) => w.from === S.meId && active(w)).sort(newest);
  const closed = S.wishes.filter((w) => !active(w)
    && (S.wishTab === 'in' ? w.to === S.meId : w.from === S.meId))
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 10);
  const shown = S.wishTab === 'in' ? incoming : outgoing;

  const statusLine = (w) => (w.status === 'planned'
    ? `<span class="pill planned">Geplant für ${esc(fmtDay(w.plannedDate))}</span>`
    : `<span class="pill">Offen seit ${esc(fmtRelative(toISO(new Date(w.createdAt))))}</span>`);

  const goldenLabel = (w) => (w.golden ? '<span class="pill golden">✨ Goldener Wunsch</span>' : '');

  const incomingCard = (w) => `<li class="wish ${personClass(w.from)} ${w.golden ? 'golden' : ''}">
    <p class="wish-from">${esc(personName(w.from))} wünscht sich</p>
    ${goldenLabel(w)}
    <div class="wish-dish"><span class="tile">${esc(w.dishEmoji)}</span><b>${esc(w.dishName)}</b></div>
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    ${statusLine(w)}
    <div class="wish-actions">
      <button class="btn primary small" data-action="cookWish" data-id="${esc(w.id)}">Gekocht</button>
      <button class="btn small" data-action="planWish" data-id="${esc(w.id)}">${w.status === 'planned' ? 'Verschieben' : 'Einplanen'}</button>
      ${w.golden ? '' : `<button class="btn quiet small" data-action="declineWish" data-id="${esc(w.id)}">${w.status === 'planned' ? 'Doch nicht' : 'Lieber nicht'}</button>`}
    </div>
  </li>`;

  const outgoingCard = (w) => `<li class="wish ${personClass(S.meId)} ${w.golden ? 'golden' : ''}">
    <p class="wish-from">Dein Wunsch an ${esc(personName(w.to))}</p>
    ${goldenLabel(w)}
    <div class="wish-dish"><span class="tile">${esc(w.dishEmoji)}</span><b>${esc(w.dishName)}</b></div>
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    ${statusLine(w)}
    <div class="wish-actions">
      <a class="btn small whatsapp" href="${esc(whatsappUrl(w))}" target="_blank" rel="noopener noreferrer">Per WhatsApp</a>
      <button class="btn quiet small" data-action="confirmDeleteWish" data-id="${esc(w.id)}">Zurückziehen</button>
    </div>
  </li>`;

  const closedLine = (w) => {
    const label = w.status === 'done' ? 'Erfüllt' : 'Abgelehnt';
    return `<li class="closed"><span>${esc(w.dishEmoji)} ${esc(w.dishName)}</span>
      <span class="pill ${w.status}">${label}</span></li>`;
  };

  const emptyText = S.wishTab === 'in'
    ? `<strong>Gerade keine Wünsche an dich</strong><p>Wenn ${esc(friend.name)} sich was wünscht, steht es hier.</p>`
    : `<strong>Worauf hast du Lust?</strong><p>Wünsch dir was von ${esc(friend.name)}.</p>`;

  $('#view').innerHTML = `
    ${topBar('Wünsche')}
    <div class="switch" role="group" aria-label="Richtung">
      <button data-action="wishTab" data-tab="in" aria-pressed="${S.wishTab === 'in'}">An mich${incoming.length ? ` (${incoming.length})` : ''}</button>
      <button data-action="wishTab" data-tab="out" aria-pressed="${S.wishTab === 'out'}">Von mir${outgoing.length ? ` (${outgoing.length})` : ''}</button>
    </div>
    <p class="wish-balance">✨ Dein Guthaben für Goldene Wünsche: <b>${Math.max(wishBalance(S.points, S.wishes, S.meId), 0).toLocaleString('de-DE')} 🥄</b></p>
    ${shown.length
      ? `<ul class="wishes">${shown.map(S.wishTab === 'in' ? incomingCard : outgoingCard).join('')}</ul>`
      : `<div class="empty"><span class="empty-emoji">💌</span>${emptyText}</div>`}
    ${closed.length ? `<section class="closed-list"><h3>Erledigt</h3><ul>${closed.map(closedLine).join('')}</ul></section>` : ''}`;
}

function whatsappUrl(wish) {
  const lines = [
    wish.golden
      ? `✨ Goldener Wunsch: Ich wünsche mir von dir ${wish.dishName} ${wish.dishEmoji}. Den kannst du nicht ablehnen!`
      : `Ich wünsche mir von dir: ${wish.dishName} ${wish.dishEmoji}`,
  ];
  if (wish.note) lines.push(wish.note);
  lines.push(`Steht in Mahlzeit: ${location.origin}${location.pathname}`);
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
}

function openWishForm(dishId) {
  const dish = S.dishes.find((d) => d.id === dishId);
  const balance = wishBalance(S.points, S.wishes, S.meId);
  const canAfford = balance >= GOLDEN_WISH_COST;
  openSheet(`
    <h2>Von ${esc(other().name)} wünschen</h2>
    <form class="stack" data-form="wish">
      ${dishPicker(dish?.name ?? '')}
      <label class="field"><span>Nachricht (optional)</span>
        <input name="note" maxlength="200" placeholder="Am liebsten dieses Wochenende …"></label>
      <label class="golden-option ${canAfford ? '' : 'locked'}">
        <input type="checkbox" name="golden" ${canAfford ? '' : 'disabled'}>
        <span class="row-text"><b>✨ Als Goldenen Wunsch einlösen</b>
          <small>Kostet ${GOLDEN_WISH_COST} 🥄 und kann nicht abgelehnt werden. ${canAfford
    ? `Du hast ${balance.toLocaleString('de-DE')} 🥄.`
    : `Dir fehlen noch ${(GOLDEN_WISH_COST - balance).toLocaleString('de-DE')} 🥄.`}</small></span>
      </label>
      <button class="btn primary">Wunsch abschicken</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

function saveWish(form) {
  const f = new FormData(form);
  const name = f.get('dishName').trim();
  const dish = findDishByName(name);
  const golden = f.get('golden') === 'on' && wishBalance(S.points, S.wishes, S.meId) >= GOLDEN_WISH_COST;
  const wish = {
    dishId: dish?.id ?? null,
    dishName: dish?.name ?? name,
    dishEmoji: dish?.emoji ?? guessEmoji(name),
    from: S.meId, to: otherId(), note: f.get('note').trim(),
    status: 'open', plannedDate: null, golden, createdAt: Date.now(),
  };
  commit([{ type: 'set', col: 'wishes', id: newId(), data: wish }]);
  S.tab = 'wishes';
  S.wishTab = 'out';
  sheet.close();
  render();
  openSheet(`
    <h2>${golden ? '✨ Goldener Wunsch ist raus' : 'Wunsch ist eingetragen'}</h2>
    <p class="muted">${esc(other().name)} sieht ihn beim nächsten Öffnen der App. Du kannst auch direkt Bescheid sagen.</p>
    <div class="stack">
      <a class="btn primary whatsapp" href="${esc(whatsappUrl(wish))}" target="_blank" rel="noopener noreferrer" data-action="closeSheet">Per WhatsApp schicken</a>
      <button class="btn quiet" data-action="closeSheet">Fertig</button>
    </div>`);
}

function openPlanForm(id) {
  const w = S.wishes.find((x) => x.id === id);
  openSheet(`
    <h2>${esc(w.dishName)} einplanen</h2>
    <form class="stack" data-form="plan" data-id="${esc(id)}">
      <label class="field"><span>Wann kochst du es?</span>
        <input type="date" name="date" required min="${today()}" value="${esc(w.plannedDate ?? today())}"></label>
      <button class="btn primary">Einplanen</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

/* ---------- Ernährung ---------- */

const lastSevenDays = () => Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));

function renderNutrition() {
  const dates = lastSevenDays();
  const { meals, groupDays, nutrients } = summarize(S.cooked, S.dishes, dates, S.quick);
  const core = coreGroups();
  const missing = core.filter((g) => !groupDays.get(g.id).size);
  const head = !meals
    ? '<strong>Noch nichts eingetragen</strong><p>In den letzten 7 Tagen gab es keine gekochten Gerichte.</p>'
    : `<strong>${core.length - missing.length} von ${core.length} Bereichen dabei</strong>
       <p>${meals} ${meals === 1 ? 'Mahlzeit' : 'Mahlzeiten'} in den letzten 7 Tagen.${missing.length ? ` Noch offen: ${esc(missing.map((g) => g.label).join(', '))}.` : ''}</p>`;

  const groupRow = (g) => {
    const days = groupDays.get(g.id);
    const dots = dates.map((d) => `<i class="${days.has(d) ? 'on' : ''}"></i>`).join('');
    const count = days.size ? `${days.size} von 7 Tagen` : 'Nicht dabei';
    return `<li><button class="row group-row ${g.limit ? 'limit' : ''}" data-action="openGroup" data-id="${g.id}">
      <span class="tile">${g.badge}</span>
      <span class="row-text"><b>${esc(g.label)}</b><small>${esc(count)} · ${esc(g.goal)}</small>
        <span class="dots" aria-hidden="true">${dots}</span></span>
      ${icon('next')}
    </button></li>`;
  };

  const combos = activeCombos().filter((c) => !findDishByName(c.name));
  const vegan = currentDiet().id === 'vegan';
  const supplements = supplementedNutrients();
  const focus = focusNutrients();
  // Vegan lässt sich B12 laut DGE nicht sicher über Essen decken, deshalb hier kein Häkchen.
  if (vegan) nutrients.delete('B12');
  const b12Note = vegan && !supplements.includes('B12')
    ? `<p class="diet-note"><b>B12 nicht vergessen:</b> Laut DGE ist bei veganer Ernährung eine ausreichende Versorgung nur mit einem Präparat möglich, Hefeflocken und angereicherte Produkte reichen nicht sicher. Der Wert sollte regelmäßig ärztlich geprüft werden. <a class="link" href="${SOURCES.B12}" target="_blank" rel="noopener noreferrer">DGE</a></p>`
    : '';

  $('#view').innerHTML = `
    ${topBar('Ernährung')}
    ${levelCard()}
    ${quickCard()}
    ${focusSection()}
    ${questList()}
    <button class="btn small badges-btn" data-action="openBadges">🏅 Abzeichen: ${S.points.badges.filter((b) => b.earned).length} von ${S.points.badges.length}</button>
    <div class="nutrition-head">${head}</div>
    <ul class="list">${activeGroups().map(groupRow).join('')}</ul>
    <section class="nutrition-section">
      <h3>Nährstoffe in den letzten 7 Tagen</h3>
      <ul class="nutrients">${NUTRIENTS.map((n) => {
    if (supplements.includes(n)) return `<li class="supplement">💊 ${esc(n)}</li>`;
    const on = nutrients.has(n);
    return `<li class="${on ? 'on' : ''} ${focus.includes(n) ? 'focus' : ''}">${focus.includes(n) ? '⭐ ' : ''}${on ? '✓ ' : ''}${esc(n)}</li>`;
  }).join('')}</ul>
      ${b12Note}
      <p class="fineprint">Zeigt, was in euren eingetragenen Gerichten vorkommt, nicht wie viel davon. Frühstück und Snacks zählen nur, wenn ihr sie als eigenes Gericht eintragt.</p>
    </section>
    ${seasonSection()}
    ${combos.length ? `<section class="nutrition-section">
      <h3>Einfache Kombis</h3>
      <ul class="list">${combos.map((c) => `<li><button class="row" data-action="addCombo" data-name="${esc(c.name)}">
        <span class="tile">${esc(guessEmoji(c.name))}</span>
        <span class="row-text"><b>${esc(c.name)}</b>${foodBadges(c)}</span>
        ${icon('plus')}
      </button></li>`).join('')}</ul>
    </section>` : ''}
    <section class="nutrition-section">
      <details class="tips"><summary>Tipps zur Zubereitung</summary>
        <ul>${TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </details>
    </section>`;
}

function focusSection() {
  const focus = focusNutrients();
  const supplements = supplementedNutrients();
  if (!focus.length && !supplements.length) {
    return '<button class="btn small focus-empty" data-action="openFocus">⭐ Persönliche Fokus-Nährstoffe wählen</button>';
  }
  const dates = lastSevenDays();
  const mine = S.quick.filter((q) => q.who === S.meId);
  const rows = focus.map((n) => {
    const days = dates.filter((d) => summarize(S.cooked, S.dishes, [d], mine).nutrients.has(n)).length;
    const dots = dates.map((d) => `<i class="${summarize(S.cooked, S.dishes, [d], mine).nutrients.has(n) ? 'on' : ''}"></i>`).join('');
    const match = S.dishes.filter((d) => nutrientsOf(dishIngredients(d)).includes(n)).slice(0, 2).map((d) => d.name);
    return `<li><span class="row-text"><b>⭐ ${esc(n)}</b>
      <small>${days ? `${days} von 7 Tagen` : 'Diese Woche noch nicht dabei'}${!days && match.length ? `. Passt: ${esc(match.join(', '))}` : ''}</small>
      <span class="dots" aria-hidden="true">${dots}</span></span></li>`;
  }).join('');
  return `<section class="focus-card">
    <div class="focus-head"><h3>Mein Fokus</h3><button class="btn quiet small" data-action="openFocus">Ändern</button></div>
    ${rows ? `<ul class="focus-list">${rows}</ul>` : ''}
    ${supplements.length ? `<p class="muted setting-hint">💊 Per Präparat: ${esc(supplements.join(', '))}</p>` : ''}
  </section>`;
}

function openFocus() {
  const state = loadFocus();
  const option = (nutrient, value, label) => `<label class="accent"><input type="radio" name="focus-${esc(nutrient)}" value="${value}" data-nutrient="${esc(nutrient)}" ${(state[nutrient] ?? 'normal') === value ? 'checked' : ''}><span>${label}</span></label>`;
  openSheet(`
    <h2>Mein Fokus</h2>
    <p class="muted">Fokus-Nährstoffe hebt die App bei dir besonders hervor. Was du als Präparat nimmst, wird nicht extra hervorgehoben. Das bleibt nur auf diesem Handy.</p>
    <ul class="focus-settings">${NUTRIENTS.map((n) => `<li><b>${esc(n)}</b>
      <fieldset class="segmented" aria-label="${esc(n)}">
        ${option(n, 'normal', 'Normal')}${option(n, 'focus', '⭐ Fokus')}${option(n, 'supplement', '💊 Präparat')}
      </fieldset></li>`).join('')}</ul>
    <div class="sheet-foot"><button class="btn primary" data-action="closeSheet">Fertig</button></div>`);
}

function seasonSection() {
  const monthNumber = new Date().getMonth() + 1;
  const season = seasonalIngredients(monthNumber);
  const items = inSeason(monthNumber);
  const matches = S.dishes.filter((d) => dishIngredients(d).some((id) => season.has(id))).slice(0, 3);
  return `<section class="nutrition-section">
    <h3>Jetzt Saison</h3>
    <ul class="nutrients season-list">${items.map((i) => `<li>${esc(i.label)}</li>`).join('')}</ul>
    ${matches.length ? `<p class="fineprint">Bei euch: ${matches.map((d) => `${esc(d.emoji)} ${esc(d.name)}`).join(', ')}</p>` : ''}
    <p class="fineprint">Frisch aus heimischem Anbau, ohne Lagerware, laut <a class="link" href="${SEASON_SOURCE}" target="_blank" rel="noopener noreferrer">regional-saisonal.de</a>. Die DGE empfiehlt Gemüse und Obst der Saison.</p>
  </section>`;
}

function openBadges() {
  const { badges } = S.points;
  const earned = badges.filter((b) => b.earned).length;
  const reward = badges.filter((b) => b.earned).reduce((sum, b) => sum + b.reward, 0);
  openSheet(`
    <h2>Abzeichen</h2>
    <p class="muted">${earned} von ${badges.length} gesammelt, zusammen ${reward} 🥄.</p>
    <ul class="badge-grid">${badges.map((b) => `<li class="${b.earned ? 'earned' : ''}">
      <span class="badge-emoji" aria-hidden="true">${b.earned ? b.emoji : '🔒'}</span>
      <b>${esc(b.name)}</b>
      <small>${esc(b.goal)}</small>
      <small class="badge-state">${b.earned ? `+${b.reward} 🥄 · ${esc(fmtDay(b.date))}` : `${b.count} von ${b.target} · +${b.reward} 🥄`}</small>
    </li>`).join('')}</ul>
    <div class="sheet-foot"><button class="btn quiet" data-action="closeSheet">Schließen</button></div>`);
}

function openGroup(id) {
  const group = GROUPS.find((g) => g.id === id);
  const stats = dishStats();
  const matching = S.dishes
    .filter((d) => dishIngredients(d).some((i) => ingredient(i)?.group === id))
    .sort((a, b) => (stats.get(a.id)?.last ?? '').localeCompare(stats.get(b.id)?.last ?? ''));
  openSheet(`
    <div class="sheet-head"><span class="tile big">${group.badge}</span><h2>${esc(group.label)}</h2></div>
    <h3>Eure Gerichte damit</h3>
    ${matching.length ? `<ul class="list">${matching.map((d) => {
      const last = stats.get(d.id)?.last;
      return `<li><button class="row" data-action="openDish" data-id="${esc(d.id)}">
        <span class="tile">${esc(d.emoji)}</span>
        <span class="row-text"><b>${esc(d.name)}</b><small>${last ? esc(`Zuletzt ${fmtRelative(last)}`) : 'Noch nie gekocht'}</small></span>
        ${icon('next')}
      </button></li>`;
    }).join('')}</ul>` : '<p class="muted">Noch keins. Leg eins an oder ergänze die Zutaten bei einem Gericht.</p>'}
    <h3>Das zählt dazu</h3>
    <ul class="history">${ingredientsOfGroup(id).map((i) => `<li><span>${esc(i.label)}</span><small class="muted">${esc(i.nutrients.join(', '))}</small></li>`).join('')}</ul>
    <div class="sheet-foot"><button class="btn quiet" data-action="closeSheet">Schließen</button></div>`);
}

/* ---------- Löffel und Level ---------- */

function levelCard() {
  const { level, total } = S.points;
  const toGo = level.next ? `Noch ${(level.next.min - total).toLocaleString('de-DE')} 🥄 bis ${esc(level.next.name)}` : 'Höher geht es nicht.';
  return `<button class="level-card" data-action="openPoints">
    <span class="level-emoji" aria-hidden="true">${level.emoji}</span>
    <span class="level-text">
      <small>Level ${level.number} · ${total.toLocaleString('de-DE')} 🥄</small>
      <b>${esc(level.name)}</b>
      <span class="level-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(level.progress * 100)}" aria-label="Fortschritt zum nächsten Level"><i style="width:${level.progress * 100}%"></i></span>
      <small>${toGo}</small>
    </span>
  </button>`;
}

function questList() {
  return `<section class="quests"><h3>Wochenziele</h3><ul class="list">
    ${S.points.quests.map((q) => `<li class="quest ${q.done ? 'done' : ''}">
      <span class="tile" aria-hidden="true">${q.emoji}</span>
      <span class="row-text"><b>${esc(q.name)}</b><small>${esc(q.goal)}</small><small class="quest-progress">${q.done ? '✓ ' : ''}${esc(q.progress)}</small></span>
      <span class="reward">+${q.reward}</span>
    </li>`).join('')}
  </ul></section>`;
}

function openPoints() {
  const { level, total, byPerson, entries } = S.points;
  const sourceLinks = (keys) => keys.map((k) => `<a class="link" href="${SOURCES[k]}" target="_blank" rel="noopener noreferrer">${k}</a>`).join(' · ');
  const contribution = Object.entries(members()).map(([id, m]) => `<span class="person p${m.color}">${esc(m.name)} ${(byPerson[id] ?? 0).toLocaleString('de-DE')}</span>`);
  if (byPerson.both) contribution.push(`<span class="person both">Gemeinsam ${byPerson.both.toLocaleString('de-DE')}</span>`);

  const usage = [
    ['Mahlzeit eingetragen, bis zu 3 am Tag', USAGE_RULES.meal],
    ['Wunsch geäußert, bis zu 3 am Tag', USAGE_RULES.wish],
    ['Wunsch eingeplant', USAGE_RULES.plan],
    ['Wunsch erfüllt', USAGE_RULES.fulfil],
    ['Am geplanten Tag gekocht', USAGE_RULES.onTime],
    ['Schnell-Eintrag, einer pro Person und Tag', USAGE_RULES.quick],
  ];
  const hasGroup = (id) => activeGroups().some((g) => g.id === id);
  const groupRules = activeGroups().filter((g) => GROUP_RULES[g.id])
    .sort((a, b) => GROUP_RULES[b.id].points - GROUP_RULES[a.id].points);

  openSheet(`
    <div class="sheet-head"><span class="tile big" aria-hidden="true">${level.emoji}</span>
      <div><h2>${esc(level.name)}</h2><p class="muted">${esc(level.line)}</p></div></div>
    <p class="points-total"><b>${total.toLocaleString('de-DE')} 🥄</b> <span class="muted">Level ${level.number} von ${LEVELS.length}</span></p>
    <p class="contribution">${contribution.join(' ')}</p>

    <details class="rules" open><summary>Alle Level</summary>
      <ol class="ladder">${LEVELS.map((l, i) => `<li class="${i <= level.index ? 'reached' : ''} ${i === level.index ? 'current' : ''}">
        <span aria-hidden="true">${i <= level.index ? l.emoji : '🔒'}</span>
        <span class="row-text"><b>${i + 1}. ${esc(l.name)}</b></span>
        <small>${l.min.toLocaleString('de-DE')}</small>
      </li>`).join('')}</ol>
    </details>

    <div class="stack points-actions"><button class="btn" data-action="openBadges">🏅 Abzeichen: ${S.points.badges.filter((b) => b.earned).length} von ${S.points.badges.length}</button></div>
    <details class="rules"><summary>So gibt es Löffel</summary>
      <h3>Pro Tag, einmal je Bereich</h3>
      <ul class="rule-list">${groupRules.map((g) => {
    const r = GROUP_RULES[g.id];
    return `<li><span class="reward">+${r.points}</span><span class="row-text"><b>${g.badge} ${esc(g.label)}</b><small>${esc(r.why)}</small>${r.sources.length ? `<small>${sourceLinks(r.sources)}</small>` : ''}</span></li>`;
  }).join('')}</ul>
      <h3>Fürs Benutzen</h3>
      <ul class="rule-list">${usage.map(([label, points]) => `<li><span class="reward">+${points}</span><span class="row-text">${esc(label)}</span></li>`).join('')}</ul>
      <h3>Wochenboni</h3>
      <ul class="rule-list">
        <li><span class="reward">+${BONUS.palette}</span><span class="row-text">Volle Palette: alle Bereiche in einer Woche</span></li>
        <li><span class="reward">+${BONUS.streak}</span><span class="row-text">Je 7 Tage in Folge Gemüse oder Obst</span></li>
        ${hasGroup('meat') ? `<li><span class="reward">+${BONUS.moderation}</span><span class="row-text"><span>Maßhalte-Medaille: höchstens 2× Fleisch pro Woche</span><small>DGE: höchstens 300 g pro Woche. Zwei Portionen zu 150 g sind eine Schätzung, weil die App keine Mengen kennt. WHO: besser pflanzliches Eiweiß statt rotem Fleisch. ${sourceLinks(['DGE', 'WHO'])}</small></span></li>` : ''}
        <li><span class="reward">+${BONUS.legumes}</span><span class="row-text">Bohnen-Pflicht: Hülsenfrüchte mindestens einmal pro Woche</span></li>
        ${hasGroup('fish')
    ? `<li><span class="reward">+${BONUS.fish}</span><span class="row-text">Angelschein: Fisch mindestens einmal pro Woche</span></li>`
    : `<li><span class="reward">+${BONUS.seeds}</span><span class="row-text"><span>Nussknacker: an 3 Tagen pro Woche Nüsse, Samen oder gutes Öl</span><small>DGE: täglich eine kleine Handvoll Nüsse. ${sourceLinks(['DGE'])}</small></span></li>`}
      </ul>
      <h3>Abzeichen und Gutscheine</h3>
      <p class="fineprint">Jedes Abzeichen gibt einmalig Löffel. Ein Goldener Wunsch kostet ${GOLDEN_WISH_COST} 🥄 aus deinem Anteil, das Level bleibt davon unberührt.</p>
      <p class="fineprint">Die Empfehlungen stammen von WHO, DGE und EU, die Punktzahlen sind eine eigene Gewichtung danach. Minuspunkte gibt es keine. Gezählt wird nur, ob etwas vorkommt, nicht die Menge. Das ersetzt keine Ernährungsberatung.</p>
    </details>

    ${entries.length ? `<details class="rules"><summary>Zuletzt verdient</summary>
      <ul class="history">${entries.slice(0, 25).map((e) => `<li><span>${esc(fmtDay(e.date))} · ${esc(e.label)}</span><b>+${e.points}</b></li>`).join('')}</ul>
    </details>` : ''}
    <div class="sheet-foot"><button class="btn quiet" data-action="closeSheet">Schließen</button></div>`);
}

function openLevelUp(level) {
  const food = ['🥦', '🫘', '🌾', '🍅', '🌰', '🥄', '🍠', '🍊'];
  openSheet(`
    <div class="level-up">
      <div class="confetti" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<i style="left:${(i * 37) % 100}%;animation-delay:${(i % 8) * 90}ms">${food[i % food.length]}</i>`).join('')}</div>
      <span class="level-up-emoji" aria-hidden="true">${level.emoji}</span>
      <p class="muted">Level ${level.number} erreicht</p>
      <h2>${esc(level.name)}</h2>
      <p class="muted">${esc(level.line)}</p>
      <button class="btn primary" data-action="closeSheet">Weiter so</button>
    </div>`);
}

let lastTotal = null;
let pointsTimer = null;
let quietPoints = false; // Eine Änderung der Ernährungsweise rechnet nur neu, verdient ist dadurch nichts.

// Kurz warten: Bei Firebase kommt ein Eintrag als mehrere Snapshots an, das soll ein Pop sein.
function notePointsChange() {
  clearTimeout(pointsTimer);
  pointsTimer = setTimeout(() => {
    const { total, level } = S.points;
    if (!quietPoints && lastTotal !== null && total > lastTotal) showPointsPop(total - lastTotal);
    lastTotal = total;

    const earnedIds = S.points.badges.filter((b) => b.earned).map((b) => b.id);
    const badgeKey = `mahlzeit.badges.${S.code}`;
    const seenBadges = JSON.parse(localStorage.getItem(badgeKey) ?? 'null');
    const fresh = seenBadges ? S.points.badges.filter((b) => b.earned && !seenBadges.includes(b.id)) : [];
    if (fresh.length && !quietPoints) toast(`Neues Abzeichen: ${fresh[0].emoji} ${fresh[0].name} (+${fresh[0].reward} 🥄)`);
    localStorage.setItem(badgeKey, JSON.stringify(earnedIds));

    const key = `mahlzeit.level.${S.code}`;
    const stored = localStorage.getItem(key);
    if (stored === null || level.index < Number(stored) || quietPoints) {
      localStorage.setItem(key, level.index);
    } else if (level.index > Number(stored) && !sheet.open) {
      localStorage.setItem(key, level.index);
      openLevelUp(level);
    }
    quietPoints = false;
  }, 250);
}

function showPointsPop(amount) {
  const el = $('#points-pop');
  el.textContent = `+${amount} 🥄`;
  el.classList.remove('show');
  void el.offsetWidth; // Animation neu starten
  el.classList.add('show');
}

/* ---------- Einstellungen und Bestätigungen ---------- */

function openSettings() {
  const friend = other();
  openSheet(`
    <h2>Einstellungen</h2>
    <form class="stack" data-form="rename">
      <label class="field"><span>Dein Name</span>
        <input name="name" required maxlength="24" value="${esc(me().name)}"></label>
      <button class="btn">Name speichern</button>
    </form>
    <h3>Ernährungsweise</h3>
    <fieldset class="segmented two" aria-label="Ernährungsweise für die ganze Küche">
      ${DIETS.map((d) => `<label class="accent"><input type="radio" name="diet" value="${d.id}" ${currentDiet().id === d.id ? 'checked' : ''}><span>${esc(d.label)}</span></label>`).join('')}
    </fieldset>
    <p class="muted setting-hint" id="diet-hint">${esc(currentDiet().hint)}</p>
    <p class="muted setting-hint">Gilt für euch beide. Die Löffel werden danach neu berechnet, das Level kann also sinken.</p>
    <h3>Mein Fokus</h3>
    <button class="btn" data-action="openFocus">⭐ Fokus-Nährstoffe und Präparate</button>
    <h3>Darstellung</h3>
    <fieldset class="segmented" aria-label="Darstellung auf diesem Gerät">
      ${[['auto', 'Auto'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([id, label]) => `<label class="accent"><input type="radio" name="theme" value="${id}" ${currentTheme() === id ? 'checked' : ''}><span>${label}</span></label>`).join('')}
    </fieldset>
    <h3>Küchen-Code</h3>
    <p class="muted">${friend ? `Du teilst diese Küche mit ${esc(friend.name)}. Mit dem Code kommst du auch auf einem neuen Handy wieder rein, heb ihn also gut auf.` : 'Mit diesem Code kommt die zweite Person dazu.'}</p>
    <p class="code">${esc(formatCode(S.code))}</p>
    <div class="stack">
      <button class="btn" data-action="shareCode">Code teilen</button>
      ${store.demo && friend ? `<button class="btn" data-action="switchPerson">Als ${esc(friend.name)} ansehen (Demo)</button>` : ''}
      <button class="btn danger" data-action="confirmLeave">Auf diesem Gerät abmelden</button>
      <button class="btn quiet" data-action="closeSheet">Schließen</button>
    </div>
    ${demoNote()}`);
}

const THEME_KEY = 'mahlzeit.theme';
const THEME_COLORS = { light: '#F7F3EC', dark: '#14110E' };

function currentTheme() {
  return document.documentElement.dataset.theme ?? 'auto';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') {
    delete root.dataset.theme;
    localStorage.removeItem(THEME_KEY);
  } else {
    root.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }
  syncThemeColor();
}

// Die Statusleiste soll auch dann passen, wenn die Wahl vom System abweicht.
function syncThemeColor() {
  const theme = currentTheme();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const own = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = THEME_COLORS[theme === 'auto' ? own : theme];
  });
}

function confirmSheet(title, text, label, action, id = '') {
  openSheet(`
    <h2>${esc(title)}</h2>
    <p class="muted">${esc(text)}</p>
    <div class="stack">
      <button class="btn danger" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>
      <button class="btn quiet" data-action="closeSheet">Abbrechen</button>
    </div>`);
}

function openSheet(html) {
  // Fokus auf den Griff: Sonst springt beim Öffnen sofort Tastatur oder Datumsrad auf.
  resetSheetDrag();
  sheet.innerHTML = `<div class="sheet-grip"><div class="grabber" tabindex="-1" autofocus aria-hidden="true"></div></div><div class="sheet-body">${html}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}

// Am Griff nach unten ziehen schließt das Sheet: ab 100 px oder mit einem schnellen Wisch.
const SHEET_CLOSE_DISTANCE = 100;
const SHEET_CLOSE_SPEED = 0.5; // px pro ms
const SHEET_SETTLE_MS = 200;
let sheetDrag = null;
let sheetSettle = null;

function resetSheetDrag() {
  clearTimeout(sheetSettle);
  sheetDrag = null;
  sheet.classList.remove('settling');
  sheet.style.removeProperty('transform');
  sheet.style.removeProperty('--sheet-fade');
}

function settleSheet(close) {
  sheet.classList.add('settling');
  sheet.style.transform = close ? 'translateY(100%)' : '';
  sheet.style.setProperty('--sheet-fade', close ? '0' : '1');
  const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
  sheetSettle = setTimeout(() => {
    if (close) sheet.close();
    resetSheetDrag();
  }, instant ? 0 : SHEET_SETTLE_MS);
}

sheet.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('.sheet-grip');
  if (!grip || sheet.classList.contains('settling')) return;
  grip.setPointerCapture(e.pointerId);
  sheetDrag = { id: e.pointerId, startY: e.clientY, y: e.clientY, t: e.timeStamp, speed: 0 };
});

sheet.addEventListener('pointermove', (e) => {
  if (e.pointerId !== sheetDrag?.id) return;
  const elapsed = e.timeStamp - sheetDrag.t;
  if (elapsed > 0) sheetDrag.speed = (e.clientY - sheetDrag.y) / elapsed;
  sheetDrag.y = e.clientY;
  sheetDrag.t = e.timeStamp;
  const offset = Math.max(0, e.clientY - sheetDrag.startY);
  sheet.style.transform = `translateY(${offset}px)`;
  sheet.style.setProperty('--sheet-fade', String(Math.max(0, 1 - offset / sheet.offsetHeight)));
});

sheet.addEventListener('pointerup', (e) => {
  if (e.pointerId !== sheetDrag?.id) return;
  const offset = e.clientY - sheetDrag.startY;
  // Wer vor dem Loslassen kurz innehält, hat nicht mehr gewischt.
  const flicked = offset > 10 && sheetDrag.speed > SHEET_CLOSE_SPEED && e.timeStamp - sheetDrag.t < 100;
  sheetDrag = null;
  settleSheet(offset > SHEET_CLOSE_DISTANCE || flicked);
});

sheet.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== sheetDrag?.id) return;
  sheetDrag = null;
  settleSheet(false);
});

/* ---------- Beispieldaten für den Demo-Modus ---------- */

async function loadDemo() {
  const code = newCode();
  const a = newId();
  const b = newId();
  await store.createHousehold(code, {
    createdAt: Date.now(),
    members: { [a]: { name: 'Du', color: 0 }, [b]: { name: 'Sam', color: 1 } },
  });
  const samples = [
    ['Lasagne', 'Béchamel selbst machen lohnt sich.', [[-3, a], [-24, b], [-52, a]]],
    ['Rotes Linsen-Curry', 'Mit Kokosmilch und viel Ingwer.', [[-1, b], [-10, b], [-19, a], [-33, 'both']]],
    ['Pizza vom Blech', '', [[-6, 'both'], [-27, 'both']]],
    ['Lachs mit Ofengemüse', '', [[-12, a]]],
    ['Ramen', 'Brühe am Vortag ansetzen.', []],
    ['Shakshuka', '', [[-40, b]]],
  ];
  const ops = [];
  const shift = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return toISO(d);
  };
  const ids = {};
  for (const [name, note, logs] of samples) {
    const id = newId();
    const emoji = guessEmoji(name);
    ids[name] = { id, emoji };
    ops.push({ type: 'set', col: 'dishes', id, data: { name, emoji, note, links: [], createdBy: a, createdAt: Date.now() } });
    for (const [days, by] of logs) {
      ops.push({
        type: 'set', col: 'cooked', id: newId(),
        data: { dishId: id, dishName: name, dishEmoji: emoji, date: shift(days), by, note: '', createdBy: a, createdAt: Date.now() },
      });
    }
  }
  const wish = (name, from, to, note, extra = {}) => ops.push({
    type: 'set', col: 'wishes', id: newId(),
    data: {
      dishId: ids[name].id, dishName: name, dishEmoji: ids[name].emoji, from, to, note,
      status: 'open', plannedDate: null, createdAt: Date.now() - 864e5, ...extra,
    },
  });
  wish('Ramen', b, a, 'Am liebsten dieses Wochenende!');
  wish('Lasagne', a, b, '', { status: 'planned', plannedDate: shift(2) });
  ops.push({
    type: 'set', col: 'plans', id: newId(),
    data: {
      dishId: ids['Pizza vom Blech'].id, dishName: 'Pizza vom Blech', dishEmoji: ids['Pizza vom Blech'].emoji,
      date: shift(1), by: 'both', createdBy: a, createdAt: Date.now(),
    },
  });
  ops.push({
    type: 'set', col: 'quick', id: `${toISO(new Date())}_${b}`,
    data: { date: toISO(new Date()), who: b, items: ['kiwi', 'walnuesse'], createdAt: Date.now() },
  });
  await store.commit(code, ops);
  S.code = code;
  S.meId = a;
  saveSession();
  enterHousehold();
}

/* ---------- Aktionen ---------- */

const actions = {
  reload: () => location.reload(),
  welcomeCreate: renderCreate,
  welcomeJoin: () => renderJoin(),
  toWelcome: renderWelcome,
  loadDemo,
  enterApp: enterHousehold,
  closeSheet: () => sheet.close(),
  settings: openSettings,
  async shareCode() {
    const url = `${location.origin}${location.pathname}`;
    const text = `Komm in unsere Küche bei Mahlzeit: ${url}\nCode: ${formatCode(S.code)}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast('In die Zwischenablage kopiert.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Teilen ging nicht. Kopier den Code von Hand.');
    }
  },
  pickPerson({ id, code }) {
    S.code = code;
    S.meId = id;
    saveSession();
    enterHousehold();
  },
  tab({ tab }) {
    S.tab = tab;
    render();
  },
  sort({ sort }) {
    S.sort = sort;
    updateDishes();
  },
  openDish: ({ id }) => openDish(id),
  newDish: ({ name }) => openDishForm(null, name ?? ''),
  addLink: ({ id }) => openAddLink(id),
  addLinkRow() {
    $('#link-rows', sheet).insertAdjacentHTML('beforeend', linkRow());
    $('#link-rows .link-row:last-child input', sheet).focus();
  },
  removeLinkRow(_, el) {
    const rows = $('#link-rows', sheet);
    if (rows.children.length > 1) el.closest('.link-row').remove();
    else $('input', rows).value = '';
  },
  addCombo({ name }) {
    const { ingredients, note } = activeCombos().find((c) => c.name === name);
    openDishForm(null, name, { ingredients, note });
  },
  openGroup: ({ id }) => openGroup(id),
  openPoints,
  confirmIngredients({ id }) {
    const dish = S.dishes.find((d) => d.id === id);
    const data = { ingredients: dishIngredients(dish) };
    commit([{ type: 'update', col: 'dishes', id, data }]);
    Object.assign(dish, data); // Bei Firebase kommt der Snapshot erst nach dem Neuzeichnen
    openDish(id);
    toast('Zutaten bestätigt.');
  },
  editDish: ({ id }) => openDishForm(id),
  confirmDeleteDish: ({ id }) => confirmSheet(
    'Gericht löschen?',
    'Das Gericht verschwindet aus der Liste. Einträge im Kalender bleiben erhalten.',
    'Löschen', 'deleteDish', id
  ),
  deleteDish({ id }) {
    commit([{ type: 'delete', col: 'dishes', id }]);
    sheet.close();
    toast('Gericht gelöscht.');
  },
  newCook: ({ dish }) => openCookForm({ dishId: dish }),
  newCookForDay: () => openCookForm({ date: S.day }),
  newCookOn: ({ date }) => openCookForm({ date }),
  editCook: ({ id }) => openCookEdit(id),
  newPlan: ({ dish, date }) => openPlanDish({ dishId: dish, date }),
  openPlan: ({ id }) => openPlanEntry(id),
  cookPlan({ id }) {
    const p = S.plans.find((x) => x.id === id);
    openCookForm({
      dishId: p.dishId, dishName: p.dishName, date: p.date <= today() ? p.date : today(), planId: id, by: p.by,
    });
  },
  deletePlan({ id }) {
    commit([{ type: 'delete', col: 'plans', id }]);
    sheet.close();
    toast('Plan entfernt.');
  },
  planToday({ id }) {
    const dish = S.dishes.find((d) => d.id === id);
    if (S.plans.some((p) => p.dishId === id && p.date === today())) {
      toast('Steht schon im Plan.');
      sheet.close();
      return;
    }
    commit([{
      type: 'set', col: 'plans', id: newId(),
      data: {
        dishId: id, dishName: dish.name, dishEmoji: dish.emoji, date: today(), by: S.meId, createdBy: S.meId, createdAt: Date.now(),
      },
    }]);
    selectDay(today());
    S.calView = 'month';
    S.tab = 'calendar';
    sheet.close();
    render();
    toast(`${dish.name} ist für heute geplant.`);
  },
  suggest: () => openSuggestion(),
  suggestNext: () => openSuggestion(1),
  openQuick: ({ date }) => openQuick(date ?? today()),
  openFocus,
  openBadges,
  openRecap: ({ prefix }) => openRecap(prefix),
  async shareRecap({ prefix }) {
    const text = recapText(prefix);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast('In die Zwischenablage kopiert.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Teilen ging nicht.');
    }
  },
  calView({ view }) {
    S.calView = view;
    render();
  },
  week({ step }) {
    S.calWeek = addDays(S.calWeek, Number(step));
    renderCalendar();
  },
  confirmDeleteCook: ({ id }) => confirmSheet('Eintrag löschen?', 'Der Eintrag verschwindet aus dem Kalender.', 'Löschen', 'deleteCook', id),
  deleteCook({ id }) {
    commit([{ type: 'delete', col: 'cooked', id }]);
    sheet.close();
  },
  pickDish({ name }) {
    const input = $('[data-dish-picker]', sheet);
    input.value = name;
    $('#dish-suggest', sheet).innerHTML = dishSuggestions(name);
  },
  month({ step }) {
    S.month = new Date(S.month.getFullYear(), S.month.getMonth() + Number(step), 1);
    renderCalendar();
    renderFab();
  },
  pickDay({ day }) {
    S.day = day;
    renderCalendar();
    renderFab();
  },
  wishTab({ tab }) {
    S.wishTab = tab;
    renderWishes();
  },
  newWish: ({ dish }) => openWishForm(dish),
  cookWish({ id }) {
    const w = S.wishes.find((x) => x.id === id);
    const planned = w.plannedDate && w.plannedDate <= today() ? w.plannedDate : today();
    openCookForm({
      dishId: w.dishId ?? findDishByName(w.dishName)?.id, dishName: w.dishName, date: planned, wishId: id, by: w.to,
    });
  },
  planWish: ({ id }) => openPlanForm(id),
  declineWish({ id }) {
    if (S.wishes.find((w) => w.id === id)?.golden) return;
    commit([{ type: 'update', col: 'wishes', id, data: { status: 'declined', plannedDate: null, resolvedAt: Date.now() } }]);
  },
  confirmDeleteWish: ({ id }) => confirmSheet('Wunsch zurückziehen?', 'Der Wunsch wird für euch beide gelöscht.', 'Zurückziehen', 'deleteWish', id),
  deleteWish({ id }) {
    commit([{ type: 'delete', col: 'wishes', id }]);
    sheet.close();
  },
  switchPerson() {
    S.meId = otherId();
    saveSession();
    sheet.close();
    render();
  },
  confirmLeave: () => confirmSheet(
    'Abmelden?',
    `Eure Daten bleiben erhalten. Zum Zurückkommen brauchst du den Code ${formatCode(S.code)}.`,
    'Abmelden', 'leave'
  ),
  leave: leaveHousehold,
};

const forms = {
  async create(form) {
    const name = new FormData(form).get('name').trim();
    if (!name) return;
    const code = newCode();
    const meId = newId();
    try {
      await store.createHousehold(code, { createdAt: Date.now(), members: { [meId]: { name, color: 0 } } });
    } catch (err) {
      console.error(err);
      renderFatal('Die Küche konnte nicht angelegt werden. Bist du online?');
      return;
    }
    S.code = code;
    S.meId = meId;
    saveSession();
    renderCodeReveal();
  },
  async join(form) {
    const code = normalizeCode(new FormData(form).get('code'));
    const error = $('#join-error');
    const fail = (text) => {
      error.textContent = text;
      error.hidden = false;
    };
    if (code.length !== 16) {
      fail('Der Code hat 16 Zeichen.');
      return;
    }
    try {
      const household = await store.getHousehold(code);
      if (household) renderPickPerson(code, household);
      else fail('Zu diesem Code gibt es keine Küche.');
    } catch (err) {
      console.error(err);
      fail('Das hat nicht geklappt. Bist du online?');
    }
  },
  async joinNew(form) {
    const name = new FormData(form).get('name').trim();
    if (!name) return;
    const { code } = form.dataset;
    const meId = newId();
    try {
      await store.addMember(code, meId, { name, color: 1 });
    } catch (err) {
      console.error(err);
      toast('Das hat nicht geklappt. Bist du online?');
      return;
    }
    S.code = code;
    S.meId = meId;
    saveSession();
    enterHousehold();
  },
  dish(form) {
    const f = new FormData(form);
    const name = f.get('name').trim();
    const { id } = form.dataset;
    const clash = findDishByName(name);
    if (clash && clash.id !== id) {
      const error = $('#dish-error', form);
      error.textContent = `„${clash.name}“ gibt es schon.`;
      error.hidden = false;
      return;
    }
    const rawLinks = f.getAll('links').filter((l) => l.trim());
    const links = [...new Set(rawLinks.map(parseRecipeUrl))];
    if (links.includes(null)) {
      const error = $('#dish-error', form);
      error.textContent = `„${rawLinks.find((l) => !parseRecipeUrl(l))}“ ist kein gültiger Link.`;
      error.hidden = false;
      return;
    }
    const otherIngredients = f.get('otherIngredients').trim();
    // null heißt: weiter annehmen. Was bei "Weitere Zutaten" steht, zählt auch bei eigener Auswahl.
    const ingredients = form.dataset.ingTouched
      ? [...new Set([...f.getAll('ing'), ...guessIngredients(otherIngredients)])]
      : null;
    const data = {
      name, emoji: f.get('emoji') ?? '🍽️', note: f.get('note').trim(), links, otherIngredients, ingredients,
    };
    if (id) commit([{ type: 'update', col: 'dishes', id, data }]);
    else commit([{ type: 'set', col: 'dishes', id: newId(), data: { ...data, createdBy: S.meId, createdAt: Date.now() } }]);
    sheet.close();
    toast(id ? 'Gespeichert.' : `${name} ist dabei.`);
  },
  addLink(form) {
    const url = parseRecipeUrl(new FormData(form).get('url'));
    if (!url) {
      const error = $('#link-error', form);
      error.textContent = 'Das sieht nicht nach einem Link aus.';
      error.hidden = false;
      return;
    }
    const { id } = form.dataset;
    const dish = S.dishes.find((d) => d.id === id);
    const data = { links: [...new Set([...dishLinks(dish), url])] };
    commit([{ type: 'update', col: 'dishes', id, data }]);
    Object.assign(dish, data); // Bei Firebase kommt der Snapshot erst nach dem Neuzeichnen
    openDish(id);
    toast('Rezept gespeichert.');
  },
  cook: saveCook,
  cookEdit(form) {
    const f = new FormData(form);
    const { id } = form.dataset;
    const log = S.cooked.find((c) => c.id === id);
    const date = f.get('date');
    commit([{
      type: 'update', col: 'cooked', id,
      data: {
        date, by: f.get('by'), note: f.get('note').trim(), fromPlan: date === log.date ? Boolean(log.fromPlan) : false,
      },
    }]);
    selectDay(date);
    sheet.close();
    if (S.tab === 'calendar') render();
    toast(date === log.date ? 'Gespeichert.' : `Verschoben auf ${fmtDay(date)}.`);
  },
  planDish(form) {
    const f = new FormData(form);
    const date = f.get('date');
    const ops = [];
    const dish = resolveDish(f.get('dishName').trim(), null, ops);
    ops.push({
      type: 'set', col: 'plans', id: newId(),
      data: {
        dishId: dish.id, dishName: dish.name, dishEmoji: dish.emoji, date, by: f.get('by'), createdBy: S.meId, createdAt: Date.now(),
      },
    });
    commit(ops);
    selectDay(date);
    sheet.close();
    if (S.tab === 'calendar') render();
    toast(`Eingeplant für ${fmtDay(date)}.`);
  },
  planEdit(form) {
    const f = new FormData(form);
    const date = f.get('date');
    commit([{ type: 'update', col: 'plans', id: form.dataset.id, data: { date, by: f.get('by') } }]);
    selectDay(date);
    sheet.close();
    if (S.tab === 'calendar') render();
    toast(`Geplant für ${fmtDay(date)}.`);
  },
  quick(form) {
    const f = new FormData(form);
    const date = f.get('date');
    const items = f.getAll('item');
    const id = quickId(date);
    if (items.length) {
      commit([{
        type: 'set', col: 'quick', id, data: {
          date, who: S.meId, items, createdAt: Date.now(),
        },
      }]);
    } else if (S.quick.some((q) => q.id === id)) {
      commit([{ type: 'delete', col: 'quick', id }]);
    }
    sheet.close();
    toast('Gespeichert.');
  },
  wish: saveWish,
  plan(form) {
    const date = new FormData(form).get('date');
    commit([{ type: 'update', col: 'wishes', id: form.dataset.id, data: { status: 'planned', plannedDate: date } }]);
    selectDay(date);
    sheet.close();
    toast(`Eingeplant für ${fmtDay(date)}.`);
  },
  rename(form) {
    const name = new FormData(form).get('name').trim();
    if (!name) return;
    store.updateMember(S.code, S.meId, { name }).catch(() => toast('Speichern hat nicht geklappt.'));
    sheet.close();
  },
};

document.addEventListener('click', (e) => {
  if (e.target === sheet) {
    sheet.close();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (el) actions[el.dataset.action]?.(el.dataset, el);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(form);
});

document.addEventListener('input', (e) => {
  const { target } = e;
  if (target.id === 'dish-search') {
    S.search = target.value;
    updateDishes();
  } else if (target.matches('[data-dish-picker]')) {
    $('#dish-suggest', sheet).innerHTML = dishSuggestions(target.value);
  } else if (target.form?.dataset.form === 'dish' && ['name', 'note', 'otherIngredients'].includes(target.name)) {
    syncAssumedIngredients(target.form);
    // Symbol mitraten, bis jemand selbst eins ausgewählt hat.
    if (target.name !== 'name' || target.form.dataset.touched) return;
    const match = target.form.querySelector(`input[name="emoji"][value="${guessEmoji(target.value)}"]`);
    if (match) match.checked = true;
  } else if (target.matches('[data-quick-date]')) {
    if (target.value) openQuick(target.value);
  } else if (target.dataset.nutrient) {
    const state = loadFocus();
    if (target.value === 'normal') delete state[target.dataset.nutrient];
    else state[target.dataset.nutrient] = target.value;
    localStorage.setItem(focusKey(), JSON.stringify(state));
    render();
  } else if (target.name === 'diet') {
    quietPoints = true;
    store.updateHousehold(S.code, { diet: target.value }).catch(() => toast('Speichern hat nicht geklappt.'));
    $('#diet-hint', sheet).textContent = DIETS.find((d) => d.id === target.value).hint;
  } else if (target.name === 'theme') {
    applyTheme(target.value);
  } else if (target.name === 'emoji') {
    target.form.dataset.touched = '1';
  } else if (target.name === 'ing') {
    target.form.dataset.ingTouched = '1';
    target.closest('fieldset').classList.remove('assumed');
    refreshIngredientCounts(target.form);
  }
});

/* ---------- Start ---------- */

// iOS ignoriert user-scalable=no, Pinch-Zoom lässt sich dort nur über die Gesten-Events abfangen.
['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
});

async function boot() {
  syncThemeColor();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
  renderLoading();
  try {
    store = await createStore();
  } catch (err) {
    console.error(err);
    renderFatal('Die App konnte sich nicht verbinden. Beim allerersten Start braucht sie Internet.');
    return;
  }
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  if (session?.code) {
    S.code = session.code;
    S.meId = session.meId;
    enterHousehold();
  } else {
    renderWelcome();
  }
}

boot();

// Nach dem Zurückholen aus dem Hintergrund stimmen "heute" und "vor 3 Tagen" sonst nicht mehr.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.household && me()) render();
});

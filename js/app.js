import { createStore, newCode, newId, normalizeCode, formatCode } from './store.js';
import {
  esc, toISO, fromISO, today, addDays, fmtDay, fmtLong, fmtMonth, fmtRelative, EMOJIS, guessEmoji,
} from './util.js';
import {
  COMBOS, GROUPS, NUTRIENTS, TIPS, dishIngredients, groupsOf, guessForDish, guessIngredients,
  ingredient, ingredientsOfGroup, isAssumed, summarize,
} from './nutrition.js';
import {
  BONUS, GROUP_RULES, LEVELS, SOURCES, USAGE_RULES, computePoints,
} from './points.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const sheet = $('#sheet');
const SESSION_KEY = 'mahlzeit.session';

const S = {
  code: null,
  meId: null,
  household: null,
  dishes: [],
  cooked: [],
  wishes: [],
  tab: 'dishes',
  shownTab: null,
  search: '',
  sort: 'recent',
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  day: today(),
  wishTab: 'in',
  points: null,
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
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

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
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5m0 13V21m9-9h-2.5m-13 0H3m15.4-6.4-1.8 1.8M7.4 16.6l-1.8 1.8m12.8 0-1.8-1.8M7.4 7.4 5.6 5.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
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
  app.innerHTML = '<main class="onboard"><p class="lead" aria-busy="true">Einen Moment …</p></main>';
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
  const pending = new Set(['household', 'dishes', 'cooked', 'wishes']);
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
  Object.assign(S, { code: null, meId: null, household: null, dishes: [], cooked: [], wishes: [], shownTab: null });
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
  if (S.tab === 'calendar' && S.day <= today()) html = fab('newCookForDay', 'Eintragen');
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
      <span class="row-text"><b>${esc(d.name)}</b><small>${esc(meta)}</small>${foodBadges(d)}</span>
      ${icon('next')}
    </button></li>`;
  }).join('');
}

function openDish(id) {
  const d = S.dishes.find((x) => x.id === id);
  if (!d) return;
  const logs = S.cooked.filter((c) => c.dishId === id).sort((a, b) => b.date.localeCompare(a.date));
  const safeLink = /^https?:\/\//i.test(d.link ?? '') ? d.link : '';
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
    ${safeLink ? `<p><a class="link" href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">Rezept öffnen</a></p>` : ''}
    <div class="stack">
      <button class="btn primary" data-action="newCook" data-dish="${esc(d.id)}">Gekocht eintragen</button>
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
      <label class="field"><span>Rezept-Link (optional)</span>
        <input name="link" type="url" inputmode="url" placeholder="https://" value="${esc(d?.link)}"></label>
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

function dishIngredientsSection(d) {
  const ids = dishIngredients(d);
  const groups = groupsOf(ids);
  const rows = groups.map((g) => {
    const names = ids.map(ingredient).filter((i) => i?.group === g.id).map((i) => i.label);
    return `<li><i class="food ${isAssumed(d) ? 'assumed' : ''}" aria-hidden="true">${g.badge}</i>
      <span class="row-text"><b>${esc(g.label)}</b><small>${esc(names.join(', '))}</small></span></li>`;
  }).join('');
  const assumedNote = isAssumed(d) && groups.length
    ? `<div class="assumed-note"><span>Aus dem Namen angenommen.</span>
        <button class="btn small" data-action="confirmIngredients" data-id="${esc(d.id)}">Stimmt so</button></div>`
    : '';
  return `<section class="dish-ingredients">
    <h3>Wichtige Zutaten</h3>
    ${rows ? `<ul class="food-list">${rows}</ul>` : '<p class="muted">Noch keine erkannt. Trag sie über „Bearbeiten“ ein.</p>'}
    ${assumedNote}
    ${d.otherIngredients ? `<p class="muted">Außerdem: ${esc(d.otherIngredients)}</p>` : ''}
  </section>`;
}

function ingredientFields(selected, assumed) {
  return `<fieldset class="ingredients ${assumed ? 'assumed' : ''}"><legend>Wichtige Zutaten</legend>
    <p class="ing-hint">Gestrichelt ist angenommen. Antippen zum Ändern.</p>
    ${GROUPS.map((g) => {
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

function openCookForm({ dishId = null, dishName = '', date = today(), wishId = null, by = null } = {}) {
  const dish = S.dishes.find((d) => d.id === dishId);
  const friendId = otherId();
  const who = by ?? S.meId;
  const option = (id, label) => `
    <label class="${personClass(id)}"><input type="radio" name="by" value="${esc(id)}" ${who === id ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  openSheet(`
    <h2>Gekocht eintragen</h2>
    <form class="stack" data-form="cook" data-wish="${esc(wishId ?? '')}">
      ${dish
        ? `<input type="hidden" name="dishName" value="${esc(dish.name)}"><p class="picked"><span class="tile">${esc(dish.emoji)}</span><b>${esc(dish.name)}</b></p>`
        : dishPicker(dishName)}
      <label class="field"><span>Wann</span>
        <input type="date" name="date" required value="${esc(date)}" max="${today()}"></label>
      <fieldset class="segmented"><legend>Wer hat gekocht?</legend>
        ${option(S.meId, me().name)}
        ${friendId ? option(friendId, other().name) + option('both', 'Zusammen') : ''}
      </fieldset>
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
  const ops = [];

  let dish = findDishByName(name);
  const wish = S.wishes.find((w) => w.id === form.dataset.wish);
  if (!dish) {
    dish = {
      id: newId(), name, emoji: wish?.dishEmoji ?? guessEmoji(name), note: '', link: '',
      createdBy: S.meId, createdAt: Date.now(),
    };
    const { id, ...data } = dish;
    ops.push({ type: 'set', col: 'dishes', id, data });
  }

  const logId = newId();
  ops.push({
    type: 'set', col: 'cooked', id: logId,
    data: {
      dishId: dish.id, dishName: dish.name, dishEmoji: dish.emoji, date: f.get('date'), by,
      note: f.get('note').trim(), createdBy: S.meId, createdAt: Date.now(),
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

/* ---------- Kalender ---------- */

function renderCalendar() {
  const first = S.month;
  const year = first.getFullYear();
  const month = first.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Woche beginnt am Montag
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const now = today();

  const cookedByDay = new Map();
  for (const c of S.cooked) {
    if (!cookedByDay.has(c.date)) cookedByDay.set(c.date, []);
    cookedByDay.get(c.date).push(c);
  }
  const plannedByDay = new Map();
  for (const w of S.wishes) {
    if (w.status !== 'planned' || !w.plannedDate) continue;
    if (!plannedByDay.has(w.plannedDate)) plannedByDay.set(w.plannedDate, []);
    plannedByDay.get(w.plannedDate).push(w);
  }

  let cells = '<span class="blank"></span>'.repeat(leading);
  for (let n = 1; n <= daysInMonth; n += 1) {
    const iso = `${prefix}-${String(n).padStart(2, '0')}`;
    const cooked = cookedByDay.get(iso) ?? [];
    const planned = plannedByDay.get(iso) ?? [];
    const marks = [
      ...cooked.map((c) => `<i class="meal ${personClass(c.by)}">${esc(c.dishEmoji)}</i>`),
      ...planned.map((w) => `<i class="meal planned ${personClass(w.to)}">${esc(w.dishEmoji)}</i>`),
    ];
    const names = [...cooked.map((c) => c.dishName), ...planned.map((w) => `${w.dishName} (geplant)`)];
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

  const dayCooked = cookedByDay.get(S.day) ?? [];
  const dayPlanned = plannedByDay.get(S.day) ?? [];
  const entries = [
    ...dayCooked.map((c) => `<li class="entry">
      <span class="tile">${esc(c.dishEmoji)}</span>
      <span class="row-text"><b>${esc(S.dishes.find((d) => d.id === c.dishId)?.name ?? c.dishName)}</b>
        <small><span class="person ${personClass(c.by)}">${esc(personName(c.by))}</span>${c.note ? ` · ${esc(c.note)}` : ''}</small>
        ${foodBadges(S.dishes.find((d) => d.id === c.dishId) ?? { name: c.dishName })}</span>
      <button class="btn quiet small" data-action="confirmDeleteCook" data-id="${esc(c.id)}">Löschen</button>
    </li>`),
    ...dayPlanned.map((w) => `<li class="entry">
      <span class="tile planned">${esc(w.dishEmoji)}</span>
      <span class="row-text"><b>${esc(w.dishName)}</b>
        <small>Geplant · <span class="person ${personClass(w.to)}">${esc(personName(w.to))}</span> kocht</small></span>
      ${S.day <= now ? `<button class="btn quiet small" data-action="cookWish" data-id="${esc(w.id)}">Gekocht</button>` : ''}
    </li>`),
  ].join('');

  $('#view').innerHTML = `
    ${topBar('Kalender')}
    <div class="month-nav">
      <button class="icon-btn" data-action="month" data-step="-1" aria-label="Voriger Monat">${icon('back')}</button>
      <h2>${esc(fmtMonth(first))}</h2>
      <button class="icon-btn" data-action="month" data-step="1" aria-label="Nächster Monat">${icon('next')}</button>
    </div>
    <div class="weekdays" aria-hidden="true">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="grid">${cells}</div>
    <p class="summary">${summary}</p>
    <section class="day-panel">
      <h3>${esc(fmtLong(S.day))}</h3>
      ${entries ? `<ul class="list">${entries}</ul>` : `<p class="muted">${S.day > now ? 'Für diesen Tag ist nichts geplant.' : 'An diesem Tag ist nichts eingetragen.'}</p>`}
    </section>`;
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

  const incomingCard = (w) => `<li class="wish ${personClass(w.from)}">
    <p class="wish-from">${esc(personName(w.from))} wünscht sich</p>
    <div class="wish-dish"><span class="tile">${esc(w.dishEmoji)}</span><b>${esc(w.dishName)}</b></div>
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    ${statusLine(w)}
    <div class="wish-actions">
      <button class="btn primary small" data-action="cookWish" data-id="${esc(w.id)}">Gekocht</button>
      <button class="btn small" data-action="planWish" data-id="${esc(w.id)}">${w.status === 'planned' ? 'Verschieben' : 'Einplanen'}</button>
      <button class="btn quiet small" data-action="declineWish" data-id="${esc(w.id)}">${w.status === 'planned' ? 'Doch nicht' : 'Lieber nicht'}</button>
    </div>
  </li>`;

  const outgoingCard = (w) => `<li class="wish ${personClass(S.meId)}">
    <p class="wish-from">Dein Wunsch an ${esc(personName(w.to))}</p>
    <div class="wish-dish"><span class="tile">${esc(w.dishEmoji)}</span><b>${esc(w.dishName)}</b></div>
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    ${statusLine(w)}
    <div class="wish-actions">
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
    ${shown.length
      ? `<ul class="wishes">${shown.map(S.wishTab === 'in' ? incomingCard : outgoingCard).join('')}</ul>`
      : `<div class="empty"><span class="empty-emoji">💌</span>${emptyText}</div>`}
    ${closed.length ? `<section class="closed-list"><h3>Erledigt</h3><ul>${closed.map(closedLine).join('')}</ul></section>` : ''}`;
}

function openWishForm(dishId) {
  const dish = S.dishes.find((d) => d.id === dishId);
  openSheet(`
    <h2>Von ${esc(other().name)} wünschen</h2>
    <form class="stack" data-form="wish">
      ${dishPicker(dish?.name ?? '')}
      <label class="field"><span>Nachricht (optional)</span>
        <input name="note" maxlength="200" placeholder="Am liebsten dieses Wochenende …"></label>
      <button class="btn primary">Wunsch abschicken</button>
      <button class="btn quiet" type="button" data-action="closeSheet">Abbrechen</button>
    </form>`);
}

function saveWish(form) {
  const f = new FormData(form);
  const name = f.get('dishName').trim();
  const dish = findDishByName(name);
  commit([{
    type: 'set', col: 'wishes', id: newId(),
    data: {
      dishId: dish?.id ?? null,
      dishName: dish?.name ?? name,
      dishEmoji: dish?.emoji ?? guessEmoji(name),
      from: S.meId, to: otherId(), note: f.get('note').trim(),
      status: 'open', plannedDate: null, createdAt: Date.now(),
    },
  }]);
  S.tab = 'wishes';
  S.wishTab = 'out';
  sheet.close();
  render();
  toast(`Wunsch an ${other().name} geschickt.`);
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
  const { meals, groupDays, nutrients } = summarize(S.cooked, S.dishes, dates);
  const core = GROUPS.filter((g) => !g.optional && !g.limit);
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

  const combos = COMBOS.filter((c) => !findDishByName(c.name));

  $('#view').innerHTML = `
    ${topBar('Ernährung')}
    ${levelCard()}
    ${questList()}
    <div class="nutrition-head">${head}</div>
    <ul class="list">${GROUPS.map(groupRow).join('')}</ul>
    <section class="nutrition-section">
      <h3>Nährstoffe in den letzten 7 Tagen</h3>
      <ul class="nutrients">${NUTRIENTS.map((n) => `<li class="${nutrients.has(n) ? 'on' : ''}">${nutrients.has(n) ? '✓ ' : ''}${esc(n)}</li>`).join('')}</ul>
      <p class="fineprint">Zeigt, was in euren eingetragenen Gerichten vorkommt, nicht wie viel davon. Frühstück und Snacks zählen nur, wenn ihr sie als eigenes Gericht eintragt.</p>
    </section>
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
  ];
  const groupRules = GROUPS.filter((g) => GROUP_RULES[g.id])
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
        <li><span class="reward">+${BONUS.moderation}</span><span class="row-text"><span>Maßhalte-Medaille: höchstens 2× Fleisch pro Woche</span><small>DGE: höchstens 300 g pro Woche. Zwei Portionen zu 150 g sind eine Schätzung, weil die App keine Mengen kennt. WHO: besser pflanzliches Eiweiß statt rotem Fleisch. ${sourceLinks(['DGE', 'WHO'])}</small></span></li>
        <li><span class="reward">+${BONUS.legumes}</span><span class="row-text">Bohnen-Pflicht: Hülsenfrüchte mindestens einmal pro Woche</span></li>
        <li><span class="reward">+${BONUS.fish}</span><span class="row-text">Angelschein: Fisch mindestens einmal pro Woche</span></li>
      </ul>
      <p class="fineprint">Die Empfehlungen stammen von WHO, DGE und EU, die Punktzahlen sind eine eigene Gewichtung danach. Minuspunkte gibt es keine. Gezählt wird nur, ob etwas vorkommt, nicht die Menge. Das ersetzt keine Ernährungsberatung.</p>
    </details>

    ${entries.length ? `<details class="rules"><summary>Zuletzt verdient</summary>
      <ul class="history">${entries.slice(0, 25).map((e) => `<li><span>${esc(fmtDay(e.date))} · ${esc(e.label)}</span><b>+${e.points}</b></li>`).join('')}</ul>
    </details>` : ''}
    <div class="sheet-foot"><button class="btn quiet" data-action="closeSheet">Schließen</button></div>`);
}

function openLevelUp(level) {
  const food = ['🥦', '🫘', '🌾', '🍅', '🌰', '🥄', '🐟', '🍊'];
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

// Kurz warten: Bei Firebase kommt ein Eintrag als mehrere Snapshots an, das soll ein Pop sein.
function notePointsChange() {
  clearTimeout(pointsTimer);
  pointsTimer = setTimeout(() => {
    const { total, level } = S.points;
    if (lastTotal !== null && total > lastTotal) showPointsPop(total - lastTotal);
    lastTotal = total;

    const key = `mahlzeit.level.${S.code}`;
    const stored = localStorage.getItem(key);
    if (stored === null || level.index < Number(stored)) {
      localStorage.setItem(key, level.index);
    } else if (level.index > Number(stored) && !sheet.open) {
      localStorage.setItem(key, level.index);
      openLevelUp(level);
    }
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
  sheet.innerHTML = `<div class="sheet-body"><div class="grabber" tabindex="-1" autofocus aria-hidden="true"></div>${html}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}

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
    ops.push({ type: 'set', col: 'dishes', id, data: { name, emoji, note, link: '', createdBy: a, createdAt: Date.now() } });
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
  addCombo({ name }) {
    const { ingredients, note } = COMBOS.find((c) => c.name === name);
    openDishForm(null, name, { ingredients, note });
  },
  openGroup: ({ id }) => openGroup(id),
  openPoints,
  confirmIngredients({ id }) {
    commit([{ type: 'update', col: 'dishes', id, data: { ingredients: guessForDish(S.dishes.find((d) => d.id === id)) } }]);
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
    const otherIngredients = f.get('otherIngredients').trim();
    // null heißt: weiter annehmen. Was bei "Weitere Zutaten" steht, zählt auch bei eigener Auswahl.
    const ingredients = form.dataset.ingTouched
      ? [...new Set([...f.getAll('ing'), ...guessIngredients(otherIngredients)])]
      : null;
    const data = {
      name, emoji: f.get('emoji') ?? '🍽️', note: f.get('note').trim(), link: f.get('link').trim(), otherIngredients, ingredients,
    };
    if (id) commit([{ type: 'update', col: 'dishes', id, data }]);
    else commit([{ type: 'set', col: 'dishes', id: newId(), data: { ...data, createdBy: S.meId, createdAt: Date.now() } }]);
    sheet.close();
    toast(id ? 'Gespeichert.' : `${name} ist dabei.`);
  },
  cook: saveCook,
  wish: saveWish,
  plan(form) {
    const date = new FormData(form).get('date');
    commit([{ type: 'update', col: 'wishes', id: form.dataset.id, data: { status: 'planned', plannedDate: date } }]);
    S.day = date;
    S.month = new Date(fromISO(date).getFullYear(), fromISO(date).getMonth(), 1);
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
  } else if (target.name === 'emoji') {
    target.form.dataset.touched = '1';
  } else if (target.name === 'ing') {
    target.form.dataset.ingTouched = '1';
    target.closest('fieldset').classList.remove('assumed');
    refreshIngredientCounts(target.form);
  }
});

/* ---------- Start ---------- */

async function boot() {
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

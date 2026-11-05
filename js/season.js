// Monate mit frischer Ware aus heimischem Anbau, ohne Lagerware.
// Quelle: regional-saisonal.de (Saisonkalender für Gemüse, Obst und Salat).
export const SEASON_SOURCE = 'https://www.regional-saisonal.de/saisonkalender-gemuese';

const SEASON = [
  { label: 'Spinat', ingredient: 'spinat', months: [3, 4, 5, 9, 10, 11] },
  { label: 'Feldsalat', ingredient: 'feldsalat', months: [1, 2, 3, 4, 10, 11, 12] },
  { label: 'Rucola', ingredient: 'rucola', months: [4, 5, 6, 7, 8, 9] },
  { label: 'Grünkohl', ingredient: 'gruenkohl', months: [1, 2, 11, 12] },
  { label: 'Brokkoli', ingredient: 'brokkoli', months: [6, 7, 8, 9, 10] },
  { label: 'Rosenkohl', ingredient: 'rosenkohl', months: [1, 2, 3, 10, 11, 12] },
  { label: 'Spargel', ingredient: 'spargel', months: [4, 5, 6] },
  { label: 'Paprika', ingredient: 'paprika', months: [7, 8, 9, 10] },
  { label: 'Tomaten', ingredient: 'tomaten', months: [7, 8, 9, 10] },
  { label: 'Karotten', ingredient: 'karotten', months: [6, 7, 8, 9, 10] },
  { label: 'Zucchini', ingredient: 'zucchini', months: [6, 7, 8, 9, 10] },
  { label: 'Aubergine', ingredient: 'zucchini', months: [7, 8, 9, 10] },
  { label: 'Kürbis', ingredient: 'kuerbis', months: [8, 9, 10, 11] },
  { label: 'Blumenkohl', ingredient: 'blumenkohl', months: [5, 6, 7, 8, 9, 10] },
  { label: 'Erbsen', ingredient: 'erbsen', months: [6, 7, 8] },
  { label: 'Grüne Bohnen', months: [7, 8, 9, 10] },
  { label: 'Erdbeeren', ingredient: 'beeren', months: [5, 6, 7] },
  { label: 'Himbeeren', ingredient: 'beeren', months: [6, 7, 8] },
  { label: 'Heidelbeeren', ingredient: 'beeren', months: [6, 7, 8, 9] },
  { label: 'Äpfel', ingredient: 'obst', months: [8, 9, 10, 11] },
  { label: 'Birnen', ingredient: 'obst', months: [8, 9, 10] },
];

export const inSeason = (month) => SEASON.filter((s) => s.months.includes(month));

export function seasonalIngredients(month) {
  return new Set(inSeason(month).map((s) => s.ingredient).filter(Boolean));
}

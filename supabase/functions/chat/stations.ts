// The four exam stations and which protocol pieces (reference_pieces.id)
// each one draws scenarios from. Chapters 8–10 (standing orders, skills,
// medications) are reference material the AI looks up, not scenario topics.

export const STATIONS = {
  "קרדיו": [
    "02-01", "02-02", "02-03", "02-04", // adult cardiac arrest, ROSC
    "03-04", // pulmonary edema
    "03-07", "03-08", "03-09", // tachycardia / tachyarrhythmias
    "03-10", // bradycardia
    "03-11", // ACS
  ],
  "מצחים": [
    "03-01", "03-02", "03-03", // airway, choking, respiratory support
    "03-05", "03-06", // asthma, COPD
    "03-12", // decreased perfusion (shock, sepsis, anaphylaxis)
    "03-13", "03-14", "03-15", "03-16", "03-17", // stroke, seizure, LOC, delirium, nausea
    "05-11", "05-12", "05-13", // organophosphates, heat, hypothermia
    "06-01", "06-02", "06-03", "06-04", // labor, hemorrhage, complications, eclampsia
    "08-02", // psychiatric / suicidal patient
  ],
  "ילדים": [
    "02-05", "02-06", "02-07", "02-08", "02-09", // pediatric arrest, ROSC, newborn
    "04-01", "04-02", "04-03", "04-04", "04-05", "04-06", "04-07", "04-08", "04-09", "04-10",
  ],
  "טראומה": [
    "05-01", "05-02", "05-03", "05-04", "05-05", "05-06", "05-07", "05-08", "05-09", "05-10",
    "07-01", "07-02", "07-03", "07-05", // mass-casualty triage, toxicological MCI
  ],
} as const;

export type Station = keyof typeof STATIONS;

// Words in the student's first message that select a station. Checked as
// substrings, so prefixed forms ("תרחיש בטראומה") still match.
const KEYWORDS: Record<Station, string[]> = {
  "קרדיו": ["קרדיו", "cardio", "לבבי"],
  "מצחים": ["מצחים", "מצבי חירום", "נשימתי", "נוירולוג", "כללי"],
  "ילדים": ["ילדים", "ילד", "פדיאטר", "תינוק"],
  "טראומה": ["טראומה", "trauma", "פציעה", "תאונה"],
};

export function detectStation(message: string): Station | null {
  const text = message.toLowerCase();
  for (const [station, words] of Object.entries(KEYWORDS) as [Station, string[]][]) {
    if (words.some((w) => text.includes(w))) return station;
  }
  return null;
}

export function randomStation(): Station {
  const names = Object.keys(STATIONS) as Station[];
  return names[Math.floor(Math.random() * names.length)];
}

/** A random shortlist from the station, so the AI's pick is actually varied. */
export function shortlist(station: Station, size = 5): string[] {
  const ids = [...STATIONS[station]];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, size);
}

// Shapes shared by the scenario engine. Two halves:
//
//  - Content (CaseTemplate, DrugRule): written by hand from the protocol book,
//    kept private (git-ignored content/ folder → Supabase), loaded at runtime.
//  - Runtime (Case, Sim): one generated patient and the running simulation.
//    Plain JSON so it can be saved to localStorage and resumed.

export type Range = number | [number, number];
export type Sex = "m" | "f";

export type VitalKey = "hr" | "sbp" | "dbp" | "rr" | "spo2" | "etco2" | "glucose" | "temp" | "gcs";

export type RhythmId =
  | "sinus"
  | "sinus-brady"
  | "sinus-tachy"
  | "junctional"
  | "avb1"
  | "avb2-1" // Wenckebach
  | "avb2-2" // Mobitz II
  | "avb3"
  | "afib"
  | "aflutter"
  | "svt"
  | "vt"
  | "torsades"
  | "vf"
  | "asystole"
  | "paced";

export type FindingKey =
  | "general"
  | "airway"
  | "breathing"
  | "lungs"
  | "skin"
  | "capRefill"
  | "jvd"
  | "edema"
  | "chest"
  | "abdomen"
  | "pupils"
  | "neuro"
  | "heart";

export type AnswerKey =
  | "complaint"
  | "onset"
  | "pain"
  | "history"
  | "meds"
  | "allergies"
  | "lastMeal"
  | "events"
  | "pde5"
  | "previous"
  | "symptoms";

/** Text that may differ by the patient's sex/facts. "[[m|f]]" inside a string is also resolved by sex. */
export type Text = string | { if: string; then: string; else: string };

/** A number, or "$name" to use a value rolled into Case.vars. */
export type Num = number | string;

// ---------------------------------------------------------------------------
// Conditions and rules
// ---------------------------------------------------------------------------

export type Cond =
  /** Action performed at least `min` times (default 1). `sinceState`: only count since entering the current state. */
  | { done: string; min?: Num; sinceState?: boolean; joules?: [number, number] }
  /** Total drug dose given ≥ min (in the rule's unit; default: any dose). */
  | { drug: string; min?: Num; sinceState?: boolean }
  /** An ongoing intervention is active (cpr, o2, iv, monitor, cpap, pacing, intubated, …). */
  | { flag: string }
  /** Seconds since entering the current state ≥ n. */
  | { inState: Num }
  /** Seconds since the scenario started ≥ n. */
  | { elapsed: Num }
  /** A rolled patient fact is true (e.g. pde5, rvInfarct, asthma). */
  | { fact: string }
  /** A current vital compares against a value. */
  | { vital: VitalKey; lt?: number; gt?: number }
  /** The patient has (true) or lacks (false) a pulse right now. */
  | { pulse: boolean }
  /** A rolled variable compares against a value. */
  | { var: string; eq?: number; lt?: number; gt?: number }
  | { sex: Sex }
  | { state: string }
  /** The scenario has been in this state at some point. */
  | { visited: string }
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond };

export type Rule = {
  when: Cond;
  /** Move to this state. */
  to?: string;
  /** Examiner says this (Hebrew). */
  say?: Text;
  /** Add to the current vitals (e.g. { sbp: -15 }). */
  vitals?: Partial<Record<VitalKey, number>>;
  /** Fire every time the condition holds after an action, not just once per state entry. */
  repeat?: boolean;
};

// ---------------------------------------------------------------------------
// Case templates
// ---------------------------------------------------------------------------

export type StateDef = {
  /** Copy everything from this state, then apply the fields below. */
  extends?: string;
  rhythm?: RhythmId;
  /** false ⇒ no pulse: BP/SpO2 unmeasurable, unconscious, apneic. Default true unless rhythm is vf/asystole. */
  pulse?: boolean;
  hr?: Range;
  sbp?: Range;
  dbp?: Range;
  rr?: Range;
  spo2?: Range;
  etco2?: Range;
  glucose?: Range;
  temp?: Range;
  gcs?: Range;
  /** Wide QRS on the strip (paced, VT, bundle branch block). */
  wideQrs?: boolean;
  findings?: Partial<Record<FindingKey, Text>>;
  /** ST deviation per lead in mm, e.g. { II: 2, III: 3, aVF: 2, aVL: -1, V4R: 1.5 }. */
  st?: Record<string, number>;
  /** Patient answers in this state (overrides the case's answers). */
  answers?: Partial<Record<AnswerKey, Text>>;
  /** Examiner says this on entering the state. */
  say?: Text;
  rules?: Rule[];
  /** Entering this state ends the scenario. */
  end?: "good" | "bad";
};

export type DrugRule = {
  /** Unit the dose range is in: mg, mcg, g, ml, iu, meq, mg/kg, mcg/kg, mcg/min, mcg/kg/min, mg/min. */
  unit?: string;
  dose?: [number, number];
  routes?: string[];
  /** Max total (same unit as dose; for /kg units, per kg). */
  max?: number;
  /** Other accepted forms, e.g. adrenaline as a push (mcg) or a drip (mcg/min). */
  alts?: { unit: string; dose: [number, number]; routes?: string[] }[];
  /** expected = should be given; optional = acceptable; wrong = should not be given here. */
  status?: "expected" | "optional" | "wrong";
  why?: string;
  contra?: { when: Cond; why: string }[];
  /** Must already hold when the drug is given (e.g. BP measured before nitrates); `why` is reported if not. */
  before?: { when: Cond; why: string }[];
};

export type ChecklistItem = {
  label: string;
  when: Cond;
  critical?: boolean;
  /** Should be done within this many seconds of the start. */
  by?: number;
  /** Only part of the checklist if this holds at the end (e.g. not when the patient is allergic). */
  onlyIf?: Cond;
};

export type WeightedText = { text: Text; w?: number; facts?: string[]; allergy?: string };

export type CaseTemplate = {
  id: string;
  station: string;
  title: string;
  protocols: string[];
  /** Random values used as "$name" in conditions: an integer range [lo, hi] or { oneOf: [...] }. */
  vars?: Record<string, [number, number] | { oneOf: number[] }>;
  patient: {
    age: [number, number];
    /** Probability the patient is male. */
    male?: number;
    weight?: [number, number];
    /** Pick one background (history + meds). */
    backgrounds: { history: Text; meds: Text; w?: number; facts?: string[] }[];
    allergies?: WeightedText[];
    /** Independent random facts: { pde5: 0.2 }. */
    facts?: Record<string, number>;
  };
  dispatch: Text[];
  /** One per dispatch (paired by position), or any number to pick from at random. */
  scene: Text[];
  /** Who answers questions when the patient can't: e.g. "[[אשתו|בעלה]]". */
  bystander?: Text;
  answers: Partial<Record<AnswerKey, Text>>;
  initial: string;
  states: Record<string, StateDef>;
  /** Rules checked in every state (after the state's own rules). */
  rules?: Rule[];
  drugs?: Record<string, DrugRule>;
  checklist: ChecklistItem[];
  /** Variants pick a sub-story; their fields are deep-merged over the template. */
  variants?: ({ id: string; w?: number; title?: string } & DeepPartial<Omit<CaseTemplate, "variants" | "id">>)[];
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type Content = {
  cases: CaseTemplate[];
  /** Generic drug rules (contraindications etc.); a case's own rules are merged over these. */
  drugs: Record<string, DrugRule>;
  /** Protocol id → title, for the debrief. */
  protocols: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** A concrete patient generated from a template + variant. */
export type Case = {
  seed: number;
  templateId: string;
  variantId: string | null;
  title: string;
  station: string;
  protocols: string[];
  age: number;
  sex: Sex;
  weight: number;
  facts: string[];
  allergyDrug: string | null;
  vars: Record<string, number>;
  history: string;
  meds: string;
  allergies: string;
  dispatch: string;
  scene: string;
  bystander: string | null;
  /** The resolved template (variant merged in). */
  template: CaseTemplate;
};

export type Vitals = Record<VitalKey, number | null>;

export type DrugGiven = {
  drug: string;
  value: number | null;
  unit: string | null;
  route: string | null;
  t: number;
};

export type ActionRecord = {
  action: string;
  t: number;
  state: string;
  joules?: number;
  drug?: DrugGiven;
};

export type Feedback = { t: number; kind: "error" | "warn"; text: string };

export type Message =
  | { from: "user"; text: string }
  | { from: "examiner"; text: string; t: number }
  | { from: "examiner"; t: number; ecg: EcgSnapshot; caption: string };

export type EcgSnapshot = {
  rhythm: RhythmId;
  hr: number;
  wide: boolean;
  st: Record<string, number>;
  seed: number;
  /** "strip" = lead II, "12" = 12-lead, "right" = right-sided leads, "cpr" = compression artifact. */
  mode: "strip" | "12" | "right" | "cpr";
};

export type Sim = {
  case: Case;
  t: number;
  state: string;
  stateSince: number;
  vitals: Vitals;
  flags: string[];
  actions: ActionRecord[];
  /** Rules already fired in the current state entry (index keys). */
  fired: string[];
  feedback: Feedback[];
  /** Last value the student measured, per vital (shown on the monitor panel). */
  measured: Partial<Record<VitalKey, { value: number | null; t: number }>>;
  /** Seconds without a pulse and without CPR. */
  noFlow: number;
  /** The engine asked for a missing detail (e.g. a dose); the next message may answer it. */
  pending: { action: string; drug?: string; need: "dose" | "joules" } | null;
  messages: Message[];
  /** States entered so far, in order. */
  visited: string[];
  /** Checklist index → time it was first satisfied. */
  checks: Record<number, number>;
  ended: null | { how: "transport" | "end" | "death" | "good" | "bad"; t: number };
  transportAt: number | null;
};

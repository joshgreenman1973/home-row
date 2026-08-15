// Home Row — curriculum.
// Every drill is a list of "steps". A step is one column on the screen:
//   { rh: [midi...], lh: [midi...] }  — notes that must be held at once.
// Notes are MIDI numbers. Middle C = 60 (C4). C3 = 48. C5 = 72.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
const noteName = (m) => NAMES[m % 12];
const octaveOf = (m) => Math.floor(m / 12) - 1;
const fullName = (m) => noteName(m) + octaveOf(m);

// Home positions. Fingers: thumb = 1, pinky = 5.
const RH_HOME = [60, 62, 64, 65, 67]; // C4 D4 E4 F4 G4 -> fingers 1..5
const LH_HOME = [48, 50, 52, 53, 55]; // C3 D3 E3 F3 G3 -> fingers 5..1
const RH_OCT = [60, 62, 64, 65, 67, 69, 71, 72];
const LH_OCT = [48, 50, 52, 53, 55, 57, 59, 60];

function fingerFor(midi, hand) {
  if (hand === 'rh') { const i = RH_HOME.indexOf(midi); return i >= 0 ? i + 1 : null; }
  if (hand === 'lh') { const i = LH_HOME.indexOf(midi); return i >= 0 ? 5 - i : null; }
  return null;
}

// Seeded random so a lesson's rounds are reproducible but varied.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

// Build a random single-hand sequence from a pool. Weighted toward keys
// the player has been missing (weights map midi -> extra weight).
function randomLine(r, pool, n, weights, opts = {}) {
  const out = [];
  let last = null;
  const maxJump = opts.maxJump || 99;
  for (let i = 0; i < n; i++) {
    let cands = pool.filter((m) => m !== last && (last === null || Math.abs(m - last) <= maxJump));
    if (!cands.length) cands = pool.filter((m) => m !== last);
    if (!cands.length) cands = pool;
    const bag = [];
    for (const m of cands) { const w = 1 + (weights && weights[m] ? Math.min(weights[m], 4) : 0); for (let k = 0; k < w; k++) bag.push(m); }
    last = pick(r, bag);
    out.push(last);
  }
  return out;
}

const seq = (hand, notes) => notes.map((n) => (hand === 'rh' ? { rh: [n], lh: [] } : { rh: [], lh: [n] }));

// Songs. Melodies only, all public domain. Written as note names in a
// stated octave, translated to MIDI at load. Bars are just for readability.
const SONG_LIB = {
  mary: { title: 'Mary had a little lamb', hand: 'rh', notes: 'E4 D4 C4 D4 E4 E4 E4 D4 D4 D4 E4 G4 G4 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4' },
  twinkle: { title: 'Twinkle, twinkle', hand: 'rh', notes: 'C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4 G4 G4 F4 F4 E4 E4 D4 G4 G4 F4 F4 E4 E4 D4 C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4' },
  ode: { title: 'Ode to joy', hand: 'rh', notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4' },
  jingle: { title: 'Jingle bells (chorus)', hand: 'rh', notes: 'E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4 F4 F4 F4 F4 F4 E4 E4 E4 E4 D4 D4 E4 D4 G4 E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4 F4 F4 F4 F4 F4 E4 E4 E4 G4 G4 F4 D4 C4' },
  frere: { title: 'Frère Jacques', hand: 'rh', notes: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4 E4 F4 G4 G4 A4 G4 F4 E4 C4 G4 A4 G4 F4 E4 C4 C4 G3 C4 C4 G3 C4' },
  row: { title: 'Row, row, row your boat', hand: 'rh', notes: 'C4 C4 C4 D4 E4 E4 D4 E4 F4 G4 C5 C5 C5 G4 G4 G4 E4 E4 E4 C4 C4 C4 G4 F4 E4 D4 C4' },
  birthday: { title: 'Happy birthday', hand: 'rh', notes: 'G3 G3 A3 G3 C4 B3 G3 G3 A3 G3 D4 C4 G3 G3 G4 E4 C4 B3 A3 F4 F4 E4 C4 D4 C4' },
  // Left-hand versions of the two simplest tunes (C3 position).
  maryLH: { title: 'Mary had a little lamb (left hand)', hand: 'lh', notes: 'E3 D3 C3 D3 E3 E3 E3 D3 D3 D3 E3 G3 G3 E3 D3 C3 D3 E3 E3 E3 E3 D3 D3 E3 D3 C3' },
  odeLH: { title: 'Ode to joy (left hand)', hand: 'lh', notes: 'E3 E3 F3 G3 G3 F3 E3 D3 C3 C3 D3 E3 E3 D3 D3 E3 E3 F3 G3 G3 F3 E3 D3 C3 C3 D3 E3 D3 C3 C3' },
};

// Songs with a left-hand chord under the melody. Chord letters per melody
// note ('.' = keep holding nothing new / no chord change shown, '-' = rest).
// Chords voiced to sit under the left hand in C position:
//   C = C3 E3 G3, F = C3 F3 A3, G = B2 D3 G3
const CHORDS = { C: [48, 52, 55], F: [48, 53, 57], G: [47, 50, 55] };
const CHORD_SONGS = {
  twinkleChords: {
    title: 'Twinkle, twinkle — with chords',
    melody: 'C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4 G4 G4 F4 F4 E4 E4 D4 G4 G4 F4 F4 E4 E4 D4 C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4',
    chords: 'C . C . F . C F . C . G . C C . F . C . G C . F . C . G C . C . F . C F . C . G . C',
  },
  odeChords: {
    title: 'Ode to joy — with chords',
    melody: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4',
    chords: 'C . . . C . . G C . . . G . . C . . . C . . G C . . G C . .',
  },
  maryChords: {
    title: 'Mary had a little lamb — with chords',
    melody: 'E4 D4 C4 D4 E4 E4 E4 D4 D4 D4 E4 G4 G4 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4',
    chords: 'C . . . C . . G . . C . . C . . . C . . . G . . . C',
  },
};

function parseNote(tok) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(tok);
  if (!m) throw new Error('bad note ' + tok);
  let semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  if (m[2] === '#') semi++; if (m[2] === 'b') semi--;
  return (parseInt(m[3], 10) + 1) * 12 + semi;
}
function songSteps(key) {
  const s = SONG_LIB[key];
  return seq(s.hand, s.notes.trim().split(/\s+/).map(parseNote));
}
function chordSongSteps(key) {
  const s = CHORD_SONGS[key];
  const mel = s.melody.trim().split(/\s+/).map(parseNote);
  const ch = s.chords.trim().split(/\s+/);
  return mel.map((n, i) => ({ rh: [n], lh: ch[i] && CHORDS[ch[i]] ? CHORDS[ch[i]].slice() : [] }));
}

// ---------------------------------------------------------------------
// LESSONS. Each has rounds; round(r, weights) returns { steps, tempo? }.
// "letters": show note letters (true for early lessons; later lessons hide
// them and rely on the staff, with a hint toggle).
// ---------------------------------------------------------------------
const LESSONS = [
  {
    id: 'find',
    num: 0,
    title: 'Find middle C',
    blurb: 'Plug in, then find the one key everything is measured from.',
    letters: true, staff: false, hands: 'rh',
    guide: [
      'Look at the black keys. They come in groups of two and three.',
      'Find the group of two black keys closest to the middle of the piano.',
      'The white key just to the left of those two is middle C.',
      'Press it with your right thumb.',
    ],
    rounds: [
      () => ({ steps: seq('rh', [60]), say: 'Press middle C.' }),
      () => ({ steps: seq('rh', [60, 60, 60]), say: 'Again, three times. Feel where it is.' }),
      () => ({ steps: seq('rh', [60, 62, 64, 65, 67]), say: 'Now walk up: thumb on C, then each finger in turn — D E F G.' }),
    ],
    passAccuracy: 0,
  },
  {
    id: 'rh-home',
    num: 1,
    title: 'Right hand, home position',
    blurb: 'Five fingers on five white keys: C D E F G. Like asdfg for the piano.',
    letters: true, staff: false, hands: 'rh',
    guide: [
      'Right thumb on middle C. Then D E F G under fingers 2, 3, 4, 5.',
      'Do not move your hand. Each finger owns one key.',
      'The number under each letter is the finger to use.',
    ],
    rounds: [
      () => ({ steps: seq('rh', [60, 62, 64, 65, 67, 65, 64, 62, 60]), say: 'Up and back down.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_HOME, 12, w, { maxJump: 2 })), say: 'Neighbors only. Keep your hand still.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_HOME, 16, w)), say: 'Any order now.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_HOME, 24, w)), say: 'A longer line. Aim for no misses.' }),
    ],
  },
  {
    id: 'lh-home',
    num: 2,
    title: 'Left hand, home position',
    blurb: 'Same shape, one octave down. Pinky on C, thumb on G.',
    letters: true, staff: false, hands: 'lh',
    guide: [
      'Find the C one octave below middle C: the next C to the left.',
      'Left pinky (5) on that C, then D E F G under 4, 3, 2, 1.',
      'So the thumb is on G this time.',
    ],
    rounds: [
      () => ({ steps: seq('lh', [48, 50, 52, 53, 55, 53, 52, 50, 48]), say: 'Up and back down. Pinky first.' }),
      (r, w) => ({ steps: seq('lh', randomLine(r, LH_HOME, 12, w, { maxJump: 2 })), say: 'Neighbors only.' }),
      (r, w) => ({ steps: seq('lh', randomLine(r, LH_HOME, 16, w)), say: 'Any order.' }),
      (r, w) => ({ steps: seq('lh', randomLine(r, LH_HOME, 24, w)), say: 'A longer line.' }),
    ],
  },
  {
    id: 'both',
    num: 3,
    title: 'Both hands',
    blurb: 'Top row is the right hand, bottom row is the left. Sometimes both at once.',
    letters: true, staff: false, hands: 'both',
    guide: [
      'Both hands in home position: left pinky on low C, right thumb on middle C.',
      'The top lane is your right hand. The bottom lane is your left.',
      'When a column has a note in both lanes, press them together.',
    ],
    rounds: [
      () => ({ steps: [...seq('rh', [60, 62, 64]), ...seq('lh', [48, 50, 52]), ...seq('rh', [65, 67]), ...seq('lh', [53, 55])], say: 'One hand at a time, taking turns.' }),
      (r, w) => {
        const a = randomLine(r, RH_HOME, 6, w, { maxJump: 2 }), b = randomLine(r, LH_HOME, 6, w, { maxJump: 2 });
        const steps = []; for (let i = 0; i < 6; i++) { steps.push({ rh: [a[i]], lh: [] }); steps.push({ rh: [], lh: [b[i]] }); }
        return { steps, say: 'Alternating: right, left, right, left.' };
      },
      () => ({ steps: [60, 62, 64, 65, 67, 65, 64, 62, 60].map((n) => ({ rh: [n], lh: [n - 12] })), say: 'Same letter in both hands, together. Hands move in parallel.' }),
      (r, w) => ({ steps: randomLine(r, RH_HOME, 12, w, { maxJump: 2 }).map((n) => ({ rh: [n], lh: [n - 12] })), say: 'Parallel, random order.' }),
      (r, w) => {
        const a = randomLine(r, RH_HOME, 12, w, { maxJump: 3 }), b = randomLine(r, LH_HOME, 12, w, { maxJump: 3 });
        return { steps: a.map((n, i) => ({ rh: [n], lh: [b[i]] })), say: 'Different letters in each hand, together. Slow is fine.' };
      },
    ],
  },
  {
    id: 'reach',
    num: 4,
    title: 'Reaching out',
    blurb: 'Past the five: A, B and the next C. The hand starts to travel.',
    letters: true, staff: false, hands: 'both',
    guide: [
      'Right hand: after G comes A, B and the next C. Stretch the pinky, or slide the hand up.',
      'Left hand: after G (thumb) comes A, B and middle C. Cross the thumb or shift.',
      'There is no wrong finger here. Find the key.',
    ],
    rounds: [
      () => ({ steps: seq('rh', RH_OCT.concat(RH_OCT.slice(0, -1).reverse())), say: 'The full octave, up and down. Right hand.' }),
      () => ({ steps: seq('lh', LH_OCT.concat(LH_OCT.slice(0, -1).reverse())), say: 'Left hand, the full octave.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_OCT, 16, w, { maxJump: 4 })), say: 'Right hand, anywhere in the octave.' }),
      (r, w) => ({ steps: seq('lh', randomLine(r, LH_OCT, 16, w, { maxJump: 4 })), say: 'Left hand, anywhere in the octave.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_OCT, 24, w)), say: 'Bigger jumps.' }),
    ],
  },
  {
    id: 'time',
    num: 5,
    title: 'Keeping time',
    blurb: 'A metronome clicks. Play each note on the click, not before, not after.',
    letters: true, staff: false, hands: 'rh', timed: true,
    guide: [
      'You will hear four clicks to count you in, then one note per click.',
      'Play on the click. The column moves whether you play or not.',
      'Late is better than frantic. Slow the tempo down if you need to.',
    ],
    rounds: [
      () => ({ steps: seq('rh', [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62]), tempo: 60, say: 'Up and down, one note per click.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_HOME, 16, w, { maxJump: 2 })), tempo: 60, say: 'Neighbors, on the click.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_HOME, 16, w)), tempo: 72, say: 'A little faster.' }),
      (r, w) => ({ steps: randomLine(r, RH_HOME, 12, w, { maxJump: 2 }).map((n) => ({ rh: [n], lh: [n - 12] })), tempo: 60, say: 'Both hands, in parallel, on the click.' }),
    ],
  },
  {
    id: 'read',
    num: 6,
    title: 'Reading the staff',
    blurb: 'Letters go away. The height of the dot tells you the note.',
    letters: false, staff: true, hands: 'both',
    guide: [
      'Higher on the staff means higher on the piano. Every line and space is the next white key.',
      'Middle C sits on its own little line between the two staves.',
      'Top staff is the right hand. Bottom staff is the left.',
      'Stuck? The "letters" switch turns the hints back on.',
    ],
    rounds: [
      () => ({ steps: seq('rh', [60, 62, 64, 65, 67, 65, 64, 62, 60]), say: 'Right hand up and down. Watch the dot climb.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_HOME, 12, w, { maxJump: 2 })), say: 'Right hand, neighbors.' }),
      () => ({ steps: seq('lh', [48, 50, 52, 53, 55, 53, 52, 50, 48]), say: 'Left hand up and down, on the bottom staff.' }),
      (r, w) => ({ steps: seq('lh', randomLine(r, LH_HOME, 12, w, { maxJump: 2 })), say: 'Left hand, neighbors.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_HOME, 16, w)), say: 'Right hand, any order.' }),
      (r, w) => ({ steps: seq('rh', randomLine(r, RH_OCT, 16, w, { maxJump: 3 })), say: 'Right hand, the whole octave.' }),
      (r, w) => {
        const a = randomLine(r, RH_HOME, 12, w, { maxJump: 2 }), b = randomLine(r, LH_HOME, 12, w, { maxJump: 2 });
        const steps = []; for (let i = 0; i < 12; i++) { steps.push({ rh: [a[i]], lh: [] }); steps.push({ rh: [], lh: [b[i]] }); }
        return { steps, say: 'Both staves, alternating hands.' };
      },
    ],
  },
  {
    id: 'songs',
    num: 7,
    title: 'Songs',
    blurb: 'Real tunes. Letters on for the first pass, off after that.',
    letters: 'first', staff: true, hands: 'rh',
    guide: [
      'Each round is a whole song, one note per column.',
      'The first time through, letters are shown. Then you play it from the staff.',
      'Nobody is timing you. Take each note when you are ready.',
    ],
    rounds: [
      () => ({ steps: songSteps('mary'), say: SONG_LIB.mary.title }),
      () => ({ steps: songSteps('twinkle'), say: SONG_LIB.twinkle.title }),
      () => ({ steps: songSteps('ode'), say: SONG_LIB.ode.title }),
      () => ({ steps: songSteps('frere'), say: SONG_LIB.frere.title }),
      () => ({ steps: songSteps('row'), say: SONG_LIB.row.title }),
      () => ({ steps: songSteps('jingle'), say: SONG_LIB.jingle.title }),
      () => ({ steps: songSteps('birthday'), say: SONG_LIB.birthday.title + ' — starts on the G below middle C' }),
      () => ({ steps: songSteps('maryLH'), say: SONG_LIB.maryLH.title }),
      () => ({ steps: songSteps('odeLH'), say: SONG_LIB.odeLH.title }),
    ],
  },
  {
    id: 'chords',
    num: 8,
    title: 'Chords under the tune',
    blurb: 'Three notes at once in the left hand. Then a song with the left hand playing chords.',
    letters: 'first', staff: true, hands: 'both',
    guide: [
      'A chord is three notes pressed together. Left hand only for now.',
      'C chord: C E G (fingers 5 3 1). F chord: C F A (5 2 1). G chord: B D G (5 3 1) — the B is just below C.',
      'Then the songs: right hand plays the tune, left hand holds the chord shown underneath.',
    ],
    rounds: [
      () => ({ steps: [CHORDS.C, CHORDS.C, CHORDS.F, CHORDS.F, CHORDS.C, CHORDS.G, CHORDS.G, CHORDS.C].map((c) => ({ rh: [], lh: c.slice() })), say: 'C, C, F, F, C, G, G, C. All three notes together each time.' }),
      (r) => ({ steps: Array.from({ length: 12 }, () => ({ rh: [], lh: CHORDS[pick(r, ['C', 'F', 'G'])].slice() })), say: 'Chords in random order.' }),
      () => ({ steps: chordSongSteps('maryChords'), say: CHORD_SONGS.maryChords.title }),
      () => ({ steps: chordSongSteps('twinkleChords'), say: CHORD_SONGS.twinkleChords.title }),
      () => ({ steps: chordSongSteps('odeChords'), say: CHORD_SONGS.odeChords.title }),
    ],
  },
];

// Keyboard-typing map (GarageBand style) for practicing without the piano.
const TYPING_MAP = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73, l: 74, p: 75, ';': 76,
  // left hand octave on the row above / number row is awkward; use z-row shifted down an octave
  z: 48, x: 50, c: 52, v: 53, b: 55, n: 57, m: 59, ',': 60,
};

// ---------------------------------------------------------------------
// LESSON 9 — Play along: Leonard Cohen.
// Copyrighted songs, so no melodies and no lyrics here — only the chord
// progressions, which is how these songs are actually played anyway.
// Right hand plays a close voicing around middle C; left hand plays the
// root. Sevenths use the "shell" trick: RH plays the triad a third up,
// LH supplies the root (E7 = G# B D over E).
// Progressions taken from the Leonard Cohen Chords Archive
// (maartenmassa.be/CohenChords) and cross-checked with the recordings'
// well-known keys. Where the record is in a sharp-heavy key, the lesson is
// transposed to a white-key key and says so.
// ---------------------------------------------------------------------
const VOICE = {
  // name: [rh notes], lh root pitch class
  'C':   { rh: ['C4', 'E4', 'G4'], root: 'C' },
  'Dm':  { rh: ['D4', 'F4', 'A4'], root: 'D' },
  'Em':  { rh: ['B3', 'E4', 'G4'], root: 'E' },
  'F':   { rh: ['C4', 'F4', 'A4'], root: 'F' },
  'G':   { rh: ['B3', 'D4', 'G4'], root: 'G' },
  'Am':  { rh: ['C4', 'E4', 'A4'], root: 'A' },
  'Bb':  { rh: ['Bb3', 'D4', 'F4'], root: 'Bb' },
  'D':   { rh: ['D4', 'F#4', 'A4'], root: 'D' },
  'E':   { rh: ['B3', 'E4', 'G#4'], root: 'E' },
  'E7':  { rh: ['B3', 'D4', 'G#4'], root: 'E' },
  'B7':  { rh: ['A3', 'D#4', 'F#4'], root: 'B' },
  'Bm7': { rh: ['D4', 'F#4', 'A4'], root: 'B' },
  'Dm7': { rh: ['C4', 'F4', 'A4'], root: 'D' },
  'Em7': { rh: ['B3', 'D4', 'G4'], root: 'E' },
};
const ROOT_OCT = { C: 3, 'C#': 3, D: 3, 'D#': 3, E: 3, F: 3, 'F#': 3, G: 2, 'G#': 2, A: 2, Bb: 2, 'A#': 2, B: 2 };
function chordStep(name, mark) {
  const v = VOICE[name]; if (!v) throw new Error('no voicing for ' + name);
  const lh = parseNote(v.root.replace('Bb', 'A#') + ROOT_OCT[v.root]);
  const s = { rh: v.rh.map(parseNote), lh: [lh], label: name };
  if (mark) s.mark = mark;
  return s;
}
// A progression string: bars separated by spaces, "|" ignored, [Verse] sets a section mark.
function prog(str) {
  const out = []; let mark = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '|') continue;
    const m = /^\[(.+)\]$/.exec(tok); if (m) { mark = m[1]; continue; }
    out.push(chordStep(tok, mark)); mark = null;
  }
  return out;
}
const COHEN = [
  { title: 'Hallelujah', key: 'Same key as the record (C).', bars: '[Verse] C Am C Am F G C G [Fourth,fifth…] F G Am F G E7 Am [Chorus] F Am F C G C' },
  { title: 'Suzanne', key: 'Record is in E; this is the same shape in C.', bars: '[Verse] C Dm C Dm C Dm C Dm [Lift] Em F C Dm C Dm C' },
  { title: 'So long, Marianne', key: 'Record is in A; this is C.', bars: '[Verse] C Dm F C Bb F Am G [Chorus] C Am G G C Am G G' },
  { title: 'Bird on the wire', key: 'Record is in A; this is C.', bars: '[Verse] C G C F C G C C [Chorus] F C Dm C F C Dm G' },
  { title: 'Famous blue raincoat', key: 'Same key as the record (A minor).', bars: '[Verse] Am F Dm7 Em7 Am F Dm7 Em7 Am Bm7 Am Bm7 Am G Am G [Chorus] C G Am Bm7 G F Em7' },
  { title: "I'm your man", key: 'Record is in B minor; this is A minor.', bars: '[Verse] Dm Am F E Am G C Dm Am [Turn] Dm C Am F E Am' },
  { title: 'Everybody knows', key: 'Record is a major third higher (C# minor); this is A minor.', bars: '[Verse] Am E Am Dm E G Am Bb E [Chorus] C G Am G F C' },
  { title: 'First we take Manhattan', key: 'Record is a half-step higher; this is A minor.', bars: '[Verse] Am Em Am Em Am Em D C B7 [Chorus] G G D C D C B7 Em' },
];
LESSONS.push({
  id: 'cohen',
  num: 9,
  title: 'Play along: Leonard Cohen',
  blurb: 'The chords under Hallelujah, Suzanne, Famous Blue Raincoat and five more. Right hand chord, left hand root.',
  letters: true, staff: true, hands: 'both',
  guide: [
    'These are the chord changes, one column per bar. Right hand plays the three notes shown; left hand plays the root underneath. Strike again at each bar.',
    'New shapes: the minor chords (Am, Dm, Em) and a trick for sevenths — play the chord a third up with the right hand and let the left hand supply the root. E7 is G# B D over an E.',
    'Nobody sings here (the songs are copyrighted, so there are no melodies or words in the app). Put the record on and play along; the label says whether the lesson is in the record’s key.',
    'Go as slowly as you like. Cohen did.',
  ],
  rounds: [
    () => ({ steps: prog('Am Am Dm Dm Em Em Am Am'), say: 'The three minor chords: Am, Dm, Em. Left hand root, right hand shape.' }),
    () => ({ steps: prog('C Am F G C Am F G'), say: 'The four-chord loop under half of pop music: C Am F G.' }),
    () => ({ steps: prog('E7 Am Bm7 Am Dm7 Em7 Am Am'), say: 'Sevenths: right hand plays the triad a third up, left hand plays the root.' }),
    ...COHEN.map((s) => () => ({ steps: prog(s.bars), say: `${s.title} — ${s.key}` })),
  ],
});

window.HR = { LESSONS, VOICE, COHEN, SONG_LIB, CHORD_SONGS, CHORDS, TYPING_MAP, RH_HOME, LH_HOME, RH_OCT, LH_OCT, noteName, fullName, isBlack, octaveOf, fingerFor, rng, parseNote };

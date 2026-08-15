/* Home Row — a typing tutor for the piano. Vanilla JS, no build step. */
(() => {
  const H = window.HR;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'html') n.innerHTML = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
    for (const c of [].concat(kids)) if (c != null) n.append(c);
    return n;
  };
  const sv = (tag, attrs = {}) => { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  // ---------------- persistence ----------------
  const LS = 'homerow.v1';
  const store = Object.assign({
    settings: { letters: true, keyLabels: 'home', sound: 'auto', tempo: 60 },
    progress: {},   // lessonId -> { rounds: {idx: {acc, npm, best}}, done: n }
    weights: {},    // midi -> miss weight
    misses: {},     // "wanted>got" -> count
    seen: false,
  }, JSON.parse(localStorage.getItem(LS) || '{}'));
  const save = () => localStorage.setItem(LS, JSON.stringify(store));

  // ---------------- audio ----------------
  let ac = null;
  const audio = {
    ctx() { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; },
    voices: new Map(),
    note(midi, vel = 0.5, when = 0, dur = null) {
      const c = this.ctx(); const t = when || c.currentTime;
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel * 0.5, t + 0.006); g.gain.exponentialRampToValueAtTime(vel * 0.18, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; const g2 = c.createGain(); g2.gain.value = 0.25;
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(c.destination); o1.start(t); o2.start(t);
      const stop = (at) => { g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(g.gain.value, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12); o1.stop(at + 0.15); o2.stop(at + 0.15); };
      if (dur) stop(t + dur); else this.voices.set(midi, stop);
      setTimeout(() => { if (!dur && this.voices.get(midi) === stop) this.voices.delete(midi); }, 3000);
    },
    off(midi) { const s = this.voices.get(midi); if (s) { s(this.ctx().currentTime); this.voices.delete(midi); } },
    click(when, accent) {
      const c = this.ctx(); const o = c.createOscillator(); const g = c.createGain();
      o.type = 'square'; o.frequency.value = accent ? 1760 : 1175;
      g.gain.setValueAtTime(accent ? 0.25 : 0.15, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      o.connect(g); g.connect(c.destination); o.start(when); o.stop(when + 0.06);
    },
  };

  // ---------------- input ----------------
  const input = {
    midi: null, device: null, held: new Set(), listeners: [],
    on(fn) { this.listeners.push(fn); },
    emit(type, midi, src) { for (const fn of this.listeners) fn(type, midi, src); },
    noteOn(midi, src) { if (this.held.has(midi)) return; this.held.add(midi); if (src !== 'midi' && store.settings.sound !== 'off') audio.note(midi, 0.6); this.emit('on', midi, src); },
    noteOff(midi, src) { if (!this.held.has(midi)) return; this.held.delete(midi); if (src !== 'midi') audio.off(midi); this.emit('off', midi, src); },
    async initMidi() {
      if (!navigator.requestMIDIAccess) { this.status = 'nomidi'; ui.status(); return; }
      try {
        this.midi = await navigator.requestMIDIAccess({ sysex: false });
        const wire = () => {
          this.device = null;
          this.midi.inputs.forEach((inp) => {
            inp.onmidimessage = (e) => {
              const [st, d1, d2] = e.data; const cmd = st & 0xf0;
              if (cmd === 0x90 && d2 > 0) this.noteOn(d1, 'midi');
              else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.noteOff(d1, 'midi');
            };
            if (inp.state === 'connected') this.device = inp.name || 'MIDI device';
          });
          this.status = this.device ? 'connected' : 'nodevice';
          ui.status();
        };
        this.midi.onstatechange = wire; wire();
      } catch (e) { this.status = 'denied'; ui.status(); }
    },
    initTyping() {
      window.addEventListener('keydown', (e) => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
        const m = H.TYPING_MAP[e.key.toLowerCase()];
        if (m != null) { e.preventDefault(); this.noteOn(m, 'typing'); }
      });
      window.addEventListener('keyup', (e) => { const m = H.TYPING_MAP[e.key.toLowerCase()]; if (m != null) this.noteOff(m, 'typing'); });
      window.addEventListener('blur', () => { for (const m of Array.from(this.held)) this.noteOff(m, 'typing'); });
    },
  };

  // ---------------- engine ----------------
  const eng = {
    lesson: null, roundIdx: 0, round: null, steps: [], cursor: 0, satisfied: new Set(),
    correct: 0, wrong: 0, streak: 0, bestStreak: 0, startedAt: null, finished: false, running: false,
    timed: null, // { beatMs, t0, timer, offsets: [] }
    listening: false,
    startLesson(lesson, roundIdx = 0) {
      this.lesson = lesson; this.roundIdx = roundIdx; this.startRound();
    },
    startRound() {
      this.stopTimed(); this.stopListen();
      const gen = this.lesson.rounds[this.roundIdx];
      const seed = (Date.now() / 1000 | 0) + this.roundIdx * 7919;
      this.round = gen(H.rng(seed), store.weights);
      this.steps = this.round.steps; this.cursor = 0; this.satisfied = new Set();
      this.correct = 0; this.wrong = 0; this.streak = 0; this.bestStreak = 0; this.startedAt = null; this.finished = false; this.running = true;
      this.missedSteps = new Set(); this.wrongSteps = new Set(); this.offsets = [];
      ui.showLesson(); ui.renderDrill(true); ui.renderScore(); ui.renderPiano();
      if (this.lesson.timed) this.startTimed();
    },
    expected() { const s = this.steps[this.cursor]; return s ? new Set([...s.rh, ...s.lh]) : new Set(); },
    hear(type, midi) {
      if (type !== 'on' || !this.running || this.finished || this.listening) return;
      if (!this.startedAt) this.startedAt = performance.now();
      const exp = this.expected();
      if (exp.has(midi)) {
        this.satisfied.add(midi);
        if ([...exp].every((n) => this.satisfied.has(n))) this.completeStep();
        else ui.renderDrill();
      } else {
        this.wrong++; this.streak = 0; this.wrongSteps.add(this.cursor);
        for (const n of exp) { store.weights[n] = (store.weights[n] || 0) + 1; const k = n + '>' + midi; store.misses[k] = (store.misses[k] || 0) + 1; }
        ui.flashWrong(midi); ui.renderScore();
      }
    },
    completeStep() {
      const exp = this.expected();
      this.correct += exp.size;
      if (!this.wrongSteps.has(this.cursor) && !this.missedSteps.has(this.cursor)) { this.streak++; this.bestStreak = Math.max(this.bestStreak, this.streak); }
      for (const n of exp) if (store.weights[n]) store.weights[n] = Math.max(0, store.weights[n] - 0.5);
      if (this.timed) { const off = performance.now() - this.beatTime(this.cursor); this.offsets[this.cursor] = off; }
      this.cursor++; this.satisfied = new Set();
      ui.renderScore(); ui.renderDrill(); ui.renderPiano();
      if (this.cursor >= this.steps.length) this.finish();
    },
    finish() {
      this.finished = true; this.running = false; this.stopTimed();
      const acc = this.correct + this.wrong ? this.correct / (this.correct + this.wrong) : 1;
      const mins = Math.max((performance.now() - (this.startedAt || performance.now())) / 60000, 1 / 60);
      const npm = this.timed ? null : Math.round(this.steps.length / mins);
      const p = store.progress[this.lesson.id] || (store.progress[this.lesson.id] = { rounds: {} });
      const prev = p.rounds[this.roundIdx] || {};
      const passAcc = this.lesson.passAccuracy != null ? this.lesson.passAccuracy : 0.9;
      const passed = acc >= passAcc && (!this.timed || this.missedSteps.size <= Math.ceil(this.steps.length * 0.15));
      p.rounds[this.roundIdx] = { acc: Math.max(prev.acc || 0, acc), npm: Math.max(prev.npm || 0, npm || 0), passed: prev.passed || passed, tries: (prev.tries || 0) + 1 };
      p.done = Object.values(p.rounds).filter((r) => r.passed).length;
      save();
      ui.showResults({ acc, npm, passed, mins });
    },
    // ---- timed mode ----
    startTimed() {
      const tempo = this.round.tempo || store.settings.tempo || 60;
      const beatMs = 60000 / tempo;
      const c = audio.ctx();
      const t0 = performance.now() + 600; // first count-in click
      this.timed = { beatMs, t0, tempo, count: 4, nextBeat: 0, timer: null };
      const startAC = c.currentTime + 0.6;
      // schedule clicks with lookahead
      const total = 4 + this.steps.length;
      let i = 0;
      const sched = () => {
        while (i < total && (t0 + i * beatMs) - performance.now() < 200) {
          audio.click(startAC + i * beatMs / 1000, i % 4 === 0);
          i++;
        }
      };
      sched();
      this.timed.timer = setInterval(() => {
        if (!this.timed) return;
        sched();
        // count-in display
        const now = performance.now();
        const beat = Math.floor((now - t0) / beatMs + 0.5);
        if (beat < 4) ui.countIn(4 - beat);
        else ui.countIn(0);
        // window end for the current step
        const wEnd = this.beatTime(this.cursor) + beatMs / 2;
        if (!this.finished && this.cursor < this.steps.length && now >= wEnd) {
          this.missedSteps.add(this.cursor); this.wrong++; this.streak = 0;
          for (const n of this.expected()) store.weights[n] = (store.weights[n] || 0) + 1;
          this.cursor++; this.satisfied = new Set();
          ui.renderScore(); ui.renderDrill(); ui.renderPiano();
          if (this.cursor >= this.steps.length) this.finish();
        }
      }, 25);
    },
    beatTime(step) { return this.timed ? this.timed.t0 + (4 + step) * this.timed.beatMs : 0; },
    stopTimed() { if (this.timed) { clearInterval(this.timed.timer); this.timed = null; ui.countIn(0); } },
    // ---- listen (demo) ----
    listen() {
      if (this.listening) { this.stopListen(); return; }
      this.stopTimed(); this.listening = true; ui.listenState(true);
      const c = audio.ctx(); const gap = 0.5; const t = c.currentTime + 0.2;
      this.steps.forEach((s, i) => { for (const n of [...s.rh, ...s.lh]) audio.note(n, 0.5, t + i * gap, gap * 0.9); });
      let i = 0; const saveCursor = this.cursor;
      this.listenTimer = setInterval(() => {
        if (i >= this.steps.length) { this.stopListen(); return; }
        ui.renderDrill(false, i); ui.renderPiano(new Set([...this.steps[i].rh, ...this.steps[i].lh])); i++;
      }, gap * 1000);
      this._restore = () => { this.cursor = saveCursor; ui.renderDrill(); ui.renderPiano(); if (this.lesson.timed && !this.finished) this.startTimed(); };
    },
    stopListen() { if (!this.listening) return; clearInterval(this.listenTimer); this.listening = false; ui.listenState(false); if (this._restore) { const r = this._restore; this._restore = null; r(); } },
  };
  input.on((t, m) => { eng.hear(t, m); ui.renderPiano(); ui.freePlay(); });

  // ---------------- staff geometry ----------------
  const LETTER_IDX = { 0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6 };
  const stepOf = (m) => (Math.floor(m / 12) - 1) * 7 + LETTER_IDX[m % 12];
  const TREBLE_BOTTOM_STEP = 30; // E4
  const BASS_BOTTOM_STEP = 18;   // G2

  // ---------------- UI ----------------
  const ui = {
    screen: 'home',
    init() {
      this.app = $('#app');
      this.buildShell();
      this.status();
      this.showHome();
      this.renderPiano();
      window.addEventListener('resize', () => { this.renderPiano(); if (this.screen === 'lesson') this.renderDrill(true); });
    },
    buildShell() {
      this.app.innerHTML = '';
      this.header = el('header', { class: 'top' }, [
        el('div', { class: 'brand', onclick: () => this.showHome() }, [el('span', { class: 'brand-mark' }, 'HOME ROW'), el('span', { class: 'brand-sub' }, 'a typing tutor for the piano')]),
        el('nav', { class: 'nav' }, [
          el('button', { class: 'navbtn', 'data-nav': 'home', onclick: () => this.showHome() }, 'Lessons'),
          el('button', { class: 'navbtn', 'data-nav': 'free', onclick: () => this.showFree() }, 'Free play'),
          el('button', { class: 'navbtn', 'data-nav': 'setup', onclick: () => this.showSetup() }, 'Setup'),
        ]),
        el('div', { class: 'status', id: 'status' }),
      ]);
      this.main = el('main', { id: 'main' });
      this.pianoWrap = el('div', { class: 'piano-wrap' }, [el('div', { class: 'piano-scroll', id: 'piano' })]);
      this.app.append(this.header, this.main, this.pianoWrap);
    },
    setNav(name) { $$('.navbtn').forEach((b) => b.classList.toggle('on', b.dataset.nav === name)); },
    status() {
      const s = $('#status'); if (!s) return;
      const st = input.status;
      let cls = 'st-off', txt = 'Looking for piano…';
      if (st === 'connected') { cls = 'st-on'; txt = input.device; }
      else if (st === 'nodevice') { cls = 'st-off'; txt = 'No piano plugged in — typing keys work'; }
      else if (st === 'nomidi') { cls = 'st-warn'; txt = 'This browser can’t see MIDI — typing keys and taps only'; }
      else if (st === 'denied') { cls = 'st-warn'; txt = 'MIDI blocked — allow it in the browser and reload'; }
      s.className = 'status ' + cls; s.textContent = txt;
    },

    // ---- HOME ----
    showHome() {
      eng.stopTimed(); eng.stopListen(); eng.running = false; this.screen = 'home'; this.setNav('home');
      const rec = H.LESSONS.find((L) => (store.progress[L.id]?.done || 0) < L.rounds.length) || H.LESSONS[0];
      const list = el('div', { class: 'lessons' });
      H.LESSONS.forEach((L) => {
        const p = store.progress[L.id] || { rounds: {}, done: 0 };
        const done = p.done || 0, tot = L.rounds.length;
        const bestAcc = Math.max(0, ...Object.values(p.rounds).map((r) => r.acc || 0));
        const bestNpm = Math.max(0, ...Object.values(p.rounds).map((r) => r.npm || 0));
        const card = el('button', { class: 'lesson' + (L === rec ? ' rec' : '') + (done >= tot ? ' complete' : ''), onclick: () => this.openLesson(L) }, [
          el('div', { class: 'l-num' }, String(L.num)),
          el('div', { class: 'l-body' }, [
            el('div', { class: 'l-title' }, L.title),
            el('div', { class: 'l-blurb' }, L.blurb),
            el('div', { class: 'l-meta' }, [
              el('span', { class: 'pips' }, Array.from({ length: tot }, (_, i) => el('i', { class: p.rounds[i]?.passed ? 'pip on' : (p.rounds[i] ? 'pip half' : 'pip') }))),
              el('span', {}, `${done}/${tot} rounds`),
              bestAcc ? el('span', {}, `best ${Math.round(bestAcc * 100)}% accuracy`) : null,
              bestNpm ? el('span', {}, `${bestNpm} notes/min`) : null,
            ]),
          ]),
          el('div', { class: 'l-go' }, L === rec ? 'Next up' : (done >= tot ? 'Done' : 'Open')),
        ]);
        list.append(card);
      });
      const trouble = this.troubleList();
      this.main.innerHTML = '';
      this.main.append(
        el('section', { class: 'home' }, [
          el('div', { class: 'home-head' }, [
            el('h1', {}, ['Nine lessons. ', el('span', { class: 'red' }, 'Middle C to a song with chords.')]),
            el('p', { class: 'lede' }, 'It works like a typing tutor: home position first, then drills that score you on accuracy and speed, then reading, then songs. Plug in the piano and the app hears every key you press.'),
          ]),
          list,
          trouble,
        ])
      );
      this.renderPiano();
    },
    troubleList() {
      const entries = Object.entries(store.misses).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (!entries.length) return el('div');
      return el('div', { class: 'trouble' }, [
        el('h3', {}, 'Where you slip'),
        el('ul', {}, entries.map(([k, n]) => { const [w, g] = k.split('>').map(Number); return el('li', {}, [el('b', {}, H.fullName(w)), ` wanted, `, el('b', {}, H.fullName(g)), ` pressed — ${n}×`]); })),
        el('button', { class: 'ghost small', onclick: () => { store.misses = {}; store.weights = {}; save(); this.showHome(); } }, 'Clear'),
      ]);
    },
    openLesson(L) {
      const p = store.progress[L.id] || { rounds: {} };
      let idx = 0; while (idx < L.rounds.length && p.rounds[idx]?.passed) idx++;
      if (idx >= L.rounds.length) idx = 0;
      this.showGuide(L, idx);
    },
    showGuide(L, idx) {
      this.screen = 'guide'; this.setNav('home');
      this.main.innerHTML = '';
      this.main.append(el('section', { class: 'guide' }, [
        el('div', { class: 'g-num' }, 'Lesson ' + L.num),
        el('h1', {}, L.title),
        el('ol', { class: 'g-steps' }, L.guide.map((g) => el('li', {}, g))),
        el('div', { class: 'g-actions' }, [
          el('button', { class: 'primary big', onclick: () => { audio.ctx(); eng.startLesson(L, idx); } }, idx > 0 ? `Continue at round ${idx + 1} of ${L.rounds.length}` : 'Start'),
          idx > 0 ? el('button', { class: 'ghost', onclick: () => { audio.ctx(); eng.startLesson(L, 0); } }, 'Start from round 1') : null,
          el('label', { class: 'rounds-pick' }, ['Round ', el('select', { onchange: (e) => { audio.ctx(); eng.startLesson(L, +e.target.value); } }, [el('option', { value: '' }, '…'), ...L.rounds.map((_, i) => el('option', { value: i }, String(i + 1)))])]),
        ]),
        L.id === 'find' ? this.middleCFigure() : null,
      ]));
    },
    middleCFigure() {
      // Two octaves around middle C, with the two-black-key group and middle C marked.
      const w = 44, keys = []; const wrap = sv('svg', { viewBox: `0 0 ${w * 14} 150`, class: 'midc' });
      let x = 0; const whites = [];
      for (let m = 53; m <= 76; m++) { if (!H.isBlack(m)) { wrap.append(sv('rect', { x, y: 0, width: w - 2, height: 140, class: 'wk' + (m === 60 ? ' target' : '') })); whites.push([m, x]); x += w; } }
      x = 0; for (let m = 53; m <= 76; m++) { if (!H.isBlack(m)) x += w; else wrap.append(sv('rect', { x: x - 14, y: 0, width: 26, height: 88, class: 'bk' })); }
      const cx = whites.find(([m]) => m === 60)[1] + (w - 2) / 2;
      const t = sv('text', { x: cx, y: 128, class: 'midc-label', 'text-anchor': 'middle' }); t.textContent = 'middle C'; wrap.append(t);
      const t2 = sv('text', { x: cx + w + 6, y: 105, class: 'midc-note', 'text-anchor': 'middle' }); t2.textContent = '↑ two black keys'; wrap.append(t2);
      return el('div', { class: 'midc-wrap' }, [wrap]);
    },

    // ---- LESSON ----
    showLesson() {
      this.screen = 'lesson'; this.setNav('home');
      const L = eng.lesson;
      this.main.innerHTML = '';
      const lettersOn = L.letters === true || (L.letters === 'first' && !(store.progress[L.id]?.rounds?.[eng.roundIdx]?.tries)) || (!L.letters && store.settings.letters && L.staff);
      this.lettersOn = L.letters === true ? true : (L.letters === 'first' ? lettersOn : store.settings.letters);
      this.main.append(el('section', { class: 'lesson-screen' }, [
        el('div', { class: 'ls-head' }, [
          el('div', { class: 'ls-title' }, [el('span', { class: 'ls-num' }, `Lesson ${L.num} · round ${eng.roundIdx + 1} of ${L.rounds.length}`), el('h2', {}, eng.round.say || L.title)]),
          el('div', { class: 'ls-tools' }, [
            L.staff ? el('button', { class: 'toggle' + (this.lettersOn ? ' on' : ''), id: 'lettersBtn', onclick: (e) => { this.lettersOn = !this.lettersOn; e.currentTarget.classList.toggle('on', this.lettersOn); this.renderDrill(true); } }, 'Letters') : null,
            el('button', { class: 'ghost', id: 'listenBtn', onclick: () => eng.listen() }, 'Listen'),
            el('button', { class: 'ghost', onclick: () => eng.startRound() }, 'Restart'),
            el('button', { class: 'ghost', onclick: () => this.showHome() }, 'Quit'),
          ]),
        ]),
        el('div', { class: 'drill-wrap' }, [el('div', { class: 'countin', id: 'countin' }), el('div', { class: 'drill', id: 'drill' })]),
        el('div', { class: 'score', id: 'score' }),
      ]));
    },
    listenState(on) { const b = $('#listenBtn'); if (b) { b.textContent = on ? 'Stop' : 'Listen'; b.classList.toggle('on', on); } },
    countIn(n) { const c = $('#countin'); if (!c) return; if (n > 0) { c.textContent = String(n); c.classList.add('show'); } else { c.classList.remove('show'); } },
    renderScore() {
      const s = $('#score'); if (!s) return;
      const total = eng.correct + eng.wrong; const acc = total ? Math.round(100 * eng.correct / total) : 100;
      const mins = eng.startedAt ? (performance.now() - eng.startedAt) / 60000 : 0;
      const npm = mins > 0.05 ? Math.round(eng.cursor / mins) : null;
      const cells = [
        ['Accuracy', acc + '%'],
        eng.timed ? ['Tempo', eng.timed.tempo + ' bpm'] : ['Speed', npm != null ? npm + ' n/min' : '—'],
        ['Streak', String(eng.streak)],
        ['Misses', String(eng.wrong)],
        ['Progress', `${eng.cursor}/${eng.steps.length}`],
      ];
      s.innerHTML = '';
      for (const [k, v] of cells) s.append(el('div', { class: 'sc' }, [el('div', { class: 'sc-v' }, v), el('div', { class: 'sc-k' }, k)]));
      const bar = el('div', { class: 'bar' }, [el('i', { style: `width:${100 * eng.cursor / eng.steps.length}%` })]);
      s.append(bar);
    },
    // Draw the whole round as one grand-staff strip; slide it so the cursor sits at a fixed x.
    renderDrill(rebuild = false, highlightIdx = null) {
      const d = $('#drill'); if (!d) return;
      const L = eng.lesson; const steps = eng.steps;
      const cur = highlightIdx != null ? highlightIdx : eng.cursor;
      const colW = 76;
      const W = d.clientWidth || 800; const Hh = d.clientHeight || 300;
      const showStaff = !!L.staff; const showLetters = !!this.lettersOn;
      const anchorX = Math.round(W * 0.28);
      const totalW = steps.length * colW + W;
      // vertical layout
      const SP = Math.max(12, Math.min(24, Hh / 17)); const HS = SP / 2;
      let trebleTop, bassTop;
      if (showStaff) { trebleTop = Math.round((Hh - 13.5 * SP) / 2 + 0.5 * SP); bassTop = trebleTop + 4 * SP + 5.5 * SP; }
      else {
        // letters mode: centre the lanes; a one-hand lesson gets one centred lane
        const usesRh = steps.some((s) => s.rh.length), usesLh = steps.some((s) => s.lh.length);
        const rhC = usesRh && usesLh ? Hh * 0.3 : Hh * 0.46, lhC = usesRh && usesLh ? Hh * 0.72 : Hh * 0.46;
        trebleTop = Math.round(rhC - 2 * SP); bassTop = Math.round(lhC - 2 * SP);
      }
      const trebleBottom = trebleTop + 4 * SP;                 // y of E4 line
      const bassBottom = bassTop + 4 * SP;                     // y of G2 line
      const yTreble = (step) => trebleBottom - (step - TREBLE_BOTTOM_STEP) * HS;
      const yBass = (step) => bassBottom - (step - BASS_BOTTOM_STEP) * HS;
      if (rebuild || !this.drillSvg) {
        d.innerHTML = '';
        const svg = sv('svg', { width: '100%', height: '100%', viewBox: `0 0 ${W} ${Hh}`, preserveAspectRatio: 'none' });
        // static staff lines
        if (showStaff) {
          for (let i = 0; i < 5; i++) { svg.append(sv('line', { x1: 0, x2: W, y1: trebleTop + i * SP, y2: trebleTop + i * SP, class: 'staffline' })); svg.append(sv('line', { x1: 0, x2: W, y1: bassTop + i * SP, y2: bassTop + i * SP, class: 'staffline' })); }
        }
        // cursor column
        svg.append(sv('rect', { x: anchorX - colW / 2, y: 0, width: colW, height: Hh, class: 'cursor-col' }));
        const g = sv('g', { class: 'strip' });
        svg.append(g);
        // lane labels sit on top of the strip, with a white backing so done columns slide under them
        const usesRh = steps.some((s) => s.rh.length), usesLh = steps.some((s) => s.lh.length);
        const laneLabel = (txt, y) => { const bg = sv('rect', { x: 0, y: y - 18, width: 12 + txt.length * 11, height: 26, class: 'lane-bg' }); const t = sv('text', { x: 10, y, class: 'lane-label' }); t.textContent = txt; svg.append(bg, t); };
        const yR = showStaff ? trebleTop - 8 : trebleTop + 2 * SP + 6, yL = showStaff ? bassTop - 8 : bassTop + 2 * SP + 6;
        if (showStaff) { laneLabel('RIGHT HAND', yR); laneLabel('LEFT HAND', yL); }
        else if (usesRh && usesLh) { laneLabel('RIGHT', yR); laneLabel('LEFT', yL); }
        else if (usesRh) laneLabel('RIGHT', yR); else laneLabel('LEFT', yL);
        d.append(svg);
        this.drillSvg = svg; this.strip = g; this.cols = [];
        steps.forEach((s, i) => {
          const x = i * colW + colW / 2;
          const col = sv('g', { class: 'col', 'data-i': i });
          const drawNote = (m, hand) => {
            const step = stepOf(m); const y = hand === 'rh' ? yTreble(step) : yBass(step);
            if (showStaff) {
              // ledger lines
              const bottom = hand === 'rh' ? TREBLE_BOTTOM_STEP : BASS_BOTTOM_STEP; const top = bottom + 8;
              for (let st = bottom - 2; st >= step; st -= 2) col.append(sv('line', { x1: x - 13, x2: x + 13, y1: hand === 'rh' ? yTreble(st) : yBass(st), y2: hand === 'rh' ? yTreble(st) : yBass(st), class: 'ledger' }));
              for (let st = top + 2; st <= step; st += 2) col.append(sv('line', { x1: x - 13, x2: x + 13, y1: hand === 'rh' ? yTreble(st) : yBass(st), y2: hand === 'rh' ? yTreble(st) : yBass(st), class: 'ledger' }));
              col.append(sv('ellipse', { cx: x, cy: y, rx: SP * 0.58, ry: SP * 0.44, class: 'head', transform: `rotate(-18 ${x} ${y})` }));
              if (H.isBlack(m)) { const a = sv('text', { x: x - 20, y: y + 5, class: 'acc' }); a.textContent = '♯'; col.append(a); }
            } else {
              const cy = hand === 'rh' ? trebleTop + 2 * SP : bassTop + 2 * SP;
              const t = sv('text', { x, y: cy + 24, class: 'big-letter', 'text-anchor': 'middle' }); t.textContent = H.noteName(m); col.append(t);
              const f = H.fingerFor(m, hand);
              if (f) { const ft = sv('text', { x, y: cy + 50, class: 'finger', 'text-anchor': 'middle' }); ft.textContent = f; col.append(ft); }
            }
          };
          // stack chords slightly so they don't overlap when letters mode
          if (!showStaff && s.lh.length > 1) {
            const cy = bassTop + 2 * SP; s.lh.forEach((m, k) => { const t = sv('text', { x, y: cy + 34 - (s.lh.length - 1 - k) * 27, class: 'big-letter small', 'text-anchor': 'middle' }); t.textContent = H.noteName(m); col.append(t); });
          } else s.lh.forEach((m) => drawNote(m, 'lh'));
          s.rh.forEach((m) => drawNote(m, 'rh'));
          if (showStaff && showLetters) {
            const hint = (notes, y) => { if (!notes.length) return; const t = sv('text', { x, y, class: 'hint' + (notes.length > 1 ? ' chord' : ''), 'text-anchor': 'middle' }); t.textContent = notes.map(H.noteName).join(' '); col.append(t); };
            hint(s.rh, trebleTop - 10); hint(s.lh, bassBottom + 24);
          }
          g.append(col); this.cols.push(col);
        });
      }
      // state classes
      this.cols.forEach((col, i) => {
        col.classList.toggle('done', i < eng.cursor);
        col.classList.toggle('current', i === cur);
        col.classList.toggle('missed', eng.missedSteps && eng.missedSteps.has(i));
        col.classList.toggle('slipped', eng.wrongSteps && eng.wrongSteps.has(i) && i < eng.cursor);
      });
      // partial-satisfied heads
      const cc = this.cols[eng.cursor];
      if (cc) { const s = steps[eng.cursor]; const heads = cc.querySelectorAll('.head, .big-letter'); heads.forEach((h) => h.classList.remove('sat')); }
      this.strip.setAttribute('transform', `translate(${anchorX - (cur * colW + colW / 2)} 0)`);
    },
    flashWrong(midi) {
      const cc = this.cols && this.cols[eng.cursor]; if (cc) { cc.classList.remove('shake'); void cc.getBBox && cc.getBoundingClientRect(); cc.classList.add('shake'); setTimeout(() => cc.classList.remove('shake'), 350); }
      this.wrongKey = midi; this.renderPiano(); setTimeout(() => { if (this.wrongKey === midi) { this.wrongKey = null; this.renderPiano(); } }, 350);
    },
    showResults({ acc, npm, passed, mins }) {
      const L = eng.lesson; const last = eng.roundIdx >= L.rounds.length - 1;
      const pct = Math.round(acc * 100);
      let verdict = passed ? (pct === 100 ? 'Clean.' : 'Passed.') : 'Not yet.';
      const timing = eng.lesson.timed ? (() => { const offs = eng.offsets.filter((o) => o != null); if (!offs.length) return null; const mean = offs.reduce((a, b) => a + b, 0) / offs.length; const spread = Math.sqrt(offs.reduce((a, b) => a + (b - mean) ** 2, 0) / offs.length); return `On average you played ${Math.abs(Math.round(mean))} ms ${mean > 0 ? 'late' : 'early'}, wobbling ±${Math.round(spread)} ms. ${eng.missedSteps.size} click${eng.missedSteps.size === 1 ? '' : 's'} missed.`; })() : null;
      const ov = el('div', { class: 'overlay' }, [el('div', { class: 'results' + (passed ? ' pass' : ' fail') }, [
        el('div', { class: 'r-verdict' }, verdict),
        el('div', { class: 'r-grid' }, [
          el('div', {}, [el('b', {}, pct + '%'), el('span', {}, 'accuracy')]),
          npm != null ? el('div', {}, [el('b', {}, String(npm)), el('span', {}, 'notes/min')]) : el('div', {}, [el('b', {}, eng.timed ? '' : '—'), el('span', {}, '')]),
          el('div', {}, [el('b', {}, String(eng.bestStreak)), el('span', {}, 'best streak')]),
          el('div', {}, [el('b', {}, String(eng.wrong)), el('span', {}, 'misses')]),
        ]),
        timing ? el('p', { class: 'r-note' }, timing) : null,
        !passed ? el('p', { class: 'r-note' }, 'A round passes at 90% accuracy. Do it again — the notes you missed will come up more often.') : null,
        el('div', { class: 'r-actions' }, [
          passed && !last ? el('button', { class: 'primary big', onclick: () => { ov.remove(); eng.roundIdx++; eng.startRound(); } }, 'Next round') : null,
          passed && last ? el('button', { class: 'primary big', onclick: () => { ov.remove(); this.showHome(); } }, 'Lesson done — back to lessons') : null,
          el('button', { class: passed ? 'ghost' : 'primary big', onclick: () => { ov.remove(); eng.startRound(); } }, 'Again'),
          el('button', { class: 'ghost', onclick: () => { ov.remove(); this.showHome(); } }, 'Lessons'),
        ]),
      ])]);
      this.main.append(ov);
    },

    // ---- PIANO RIBBON ----
    renderPiano(forceTargets = null) {
      const p = $('#piano'); if (!p) return;
      const targets = forceTargets || (this.screen === 'lesson' && eng.running && !eng.listening ? eng.expected() : new Set());
      const held = input.held;
      const first = 21, last = 108; // A0..C8
      const wW = 100, wH = 420, bW = 60, bH = 260;
      const nWhite = 52;
      if (!this.pianoSvg) {
        const svg = sv('svg', { viewBox: `0 0 ${nWhite * wW} ${wH}`, preserveAspectRatio: 'none', class: 'piano' });
        this.keyEls = {}; let x = 0;
        for (let m = first; m <= last; m++) if (!H.isBlack(m)) { const r = sv('rect', { x, y: 0, width: wW - 3, height: wH, class: 'wkey', 'data-m': m }); svg.append(r); this.keyEls[m] = { el: r, x, w: wW - 3 }; x += wW; }
        x = 0; for (let m = first; m <= last; m++) { if (!H.isBlack(m)) { x += wW; continue; } const r = sv('rect', { x: x - bW / 2, y: 0, width: bW, height: bH, class: 'bkey', 'data-m': m }); svg.append(r); this.keyEls[m] = { el: r, x: x - bW / 2, w: bW }; }
        // labels
        this.labelEls = {};
        for (let m = first; m <= last; m++) if (!H.isBlack(m)) { const k = this.keyEls[m]; const t = sv('text', { x: k.x + k.w / 2, y: wH - 34, class: 'klabel', 'text-anchor': 'middle' }); t.textContent = H.noteName(m); svg.append(t); this.labelEls[m] = t; }
        // middle C dot
        const kc = this.keyEls[60]; svg.append(sv('circle', { cx: kc.x + kc.w / 2, cy: wH - 90, r: 9, class: 'midc-dot' }));
        // touch
        const at = (ev) => { const t = ev.target; return t && t.dataset && t.dataset.m ? +t.dataset.m : null; };
        const ptrs = new Map();
        svg.addEventListener('pointerdown', (ev) => { audio.ctx(); const m = at(ev); if (m == null) return; ev.preventDefault(); svg.setPointerCapture && svg.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, m); input.noteOn(m, 'touch'); });
        const up = (ev) => { const m = ptrs.get(ev.pointerId); if (m != null) { input.noteOff(m, 'touch'); ptrs.delete(ev.pointerId); } };
        svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', up);
        p.append(svg); this.pianoSvg = svg;
        // scroll to centre on middle C
        requestAnimationFrame(() => { p.scrollLeft = Math.max(0, p.scrollWidth * (kc.x / (nWhite * wW)) - p.clientWidth / 2 + 40); });
      }
      const mode = store.settings.keyLabels;
      for (let m = first; m <= last; m++) {
        const k = this.keyEls[m]; if (!k) continue;
        const cls = [H.isBlack(m) ? 'bkey' : 'wkey'];
        if (targets.has(m)) cls.push('target');
        if (held.has(m)) cls.push(targets.size && !targets.has(m) ? 'held wrongish' : 'held');
        if (this.wrongKey === m) cls.push('wrong');
        k.el.setAttribute('class', cls.join(' '));
        const lab = this.labelEls[m];
        if (lab) { const show = mode === 'all' || (mode === 'home' && m >= 48 && m <= 72) || m === 60; lab.setAttribute('class', 'klabel' + (show ? '' : ' hide') + (m === 60 ? ' c4' : '')); }
      }
    },

    // ---- FREE PLAY ----
    showFree() {
      eng.stopTimed(); eng.stopListen(); eng.running = false; this.screen = 'free'; this.setNav('free');
      this.main.innerHTML = '';
      this.main.append(el('section', { class: 'free' }, [
        el('div', { class: 'free-now', id: 'freeNow' }, '—'),
        el('div', { class: 'free-chord', id: 'freeChord' }, ''),
        el('div', { class: 'free-log', id: 'freeLog' }),
        el('p', { class: 'hint-text' }, 'Play anything. Every key you press is named here, and three-note chords are identified. On a computer, the letter keys A–K are the white keys from middle C; W E T Y U are the black ones; Z X C V B N M are the octave below.'),
      ]));
      this.freeHist = [];
      this.freePlay();
    },
    freePlay() {
      if (this.screen !== 'free') return;
      const now = $('#freeNow'); const ch = $('#freeChord'); const log = $('#freeLog'); if (!now) return;
      const held = [...input.held].sort((a, b) => a - b);
      now.textContent = held.length ? held.map(H.fullName).join('  ') : '—';
      ch.textContent = held.length >= 3 ? (chordName(held) || '') : '';
      if (held.length && this._lastHeldSig !== held.join(',')) { this.freeHist.unshift(held.map(H.noteName).join('+')); this.freeHist = this.freeHist.slice(0, 40); }
      this._lastHeldSig = held.join(',');
      log.textContent = this.freeHist.join('  ·  ');
    },

    // ---- SETUP ----
    showSetup() {
      eng.stopTimed(); eng.stopListen(); eng.running = false; this.screen = 'setup'; this.setNav('setup');
      const S = store.settings;
      const sel = (id, opts, val, on) => el('select', { id, onchange: (e) => { on(e.target.value); save(); this.renderPiano(); } }, opts.map(([v, t]) => { const o = el('option', { value: v }, t); if (String(v) === String(val)) o.selected = true; return o; }));
      this.main.innerHTML = '';
      this.main.append(el('section', { class: 'setup' }, [
        el('h1', {}, 'Plugging in'),
        el('div', { class: 'setup-cols' }, [
          el('div', {}, [
            el('h3', {}, 'The cable'),
            el('p', {}, 'The Donner DDP-80 sends MIDI through its square USB-B port (the printer-cable shape, on the back). You need one cable: USB-B on the piano end, USB-C on the tablet end. Turn the piano on first, then plug in.'),
            el('h3', {}, 'Which device'),
            el('p', {}, [el('b', {}, 'Android tablet, in Chrome: '), 'works. Open this page, plug in, and when Chrome asks whether the page may use MIDI devices, allow it. The status in the top right turns black and names the piano.']),
            el('p', {}, [el('b', {}, 'iPad: '), 'Safari, and every browser on iPad, cannot see MIDI devices. Use the Android tablet or a laptop.']),
            el('p', {}, [el('b', {}, 'Mac or PC, in Chrome or Edge: '), 'works, with a USB-B to USB-A or USB-C cable.']),
            el('h3', {}, 'No piano handy?'),
            el('p', {}, 'The letter keys on a computer keyboard play notes (A–K white, W E T Y U black, Z–M an octave down), and you can tap the keyboard at the bottom of the screen. Both work for every lesson, but the drills are meant for the real keys.'),
          ]),
          el('div', {}, [
            el('h3', {}, 'Settings'),
            el('label', { class: 'row' }, ['Letter labels on the piano ', sel('kl', [['home', 'around middle C'], ['all', 'every key'], ['none', 'middle C only']], S.keyLabels, (v) => (S.keyLabels = v))]),
            el('label', { class: 'row' }, ['Letter hints when reading the staff ', sel('lh', [['true', 'on'], ['false', 'off']], S.letters, (v) => (S.letters = v === 'true'))]),
            el('label', { class: 'row' }, ['Tablet sound for typed/tapped notes ', sel('snd', [['auto', 'on'], ['off', 'off']], S.sound, (v) => (S.sound = v))]),
            el('label', { class: 'row' }, ['Metronome tempo (Keeping time) ', sel('tp', [[48, '48 bpm'], [60, '60 bpm'], [72, '72 bpm'], [88, '88 bpm']], S.tempo, (v) => (S.tempo = +v))]),
            el('p', { class: 'muted' }, 'The piano keeps making its own sound; the tablet stays quiet when notes come in over the cable.'),
            el('h3', {}, 'Progress'),
            el('p', {}, 'Saved on this device only, in the browser. Nothing is sent anywhere.'),
            el('button', { class: 'ghost', onclick: () => { if (confirm('Erase all lesson progress on this device?')) { store.progress = {}; store.weights = {}; store.misses = {}; save(); this.showSetup(); } } }, 'Erase progress'),
            el('h3', {}, 'About'),
            el('p', {}, ['The lesson order follows the standard beginner method-book path: middle C position, then the left hand, hands together, reaching past five fingers, rhythm, staff reading, tunes, chords. Songs are traditional melodies in the public domain. Scoring borrows from typing tutors: accuracy is correct presses over all presses, speed is notes per minute, and a round passes at 90%. Built by Josh Greenman with Claude. Source: ', el('a', { href: 'https://github.com/joshgreenman1973/home-row' }, 'github.com/joshgreenman1973/home-row'), '.']),
          ]),
        ]),
      ]));
    },
  };

  function chordName(held) {
    const pcs = [...new Set(held.map((m) => m % 12))];
    if (pcs.length !== 3) return null;
    for (const root of pcs) {
      const iv = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b).join(',');
      if (iv === '0,4,7') return H.noteName(root) + ' major';
      if (iv === '0,3,7') return H.noteName(root) + ' minor';
      if (iv === '0,3,6') return H.noteName(root) + ' diminished';
      if (iv === '0,4,8') return H.noteName(root) + ' augmented';
    }
    return null;
  }

  // ---------------- boot ----------------
  ui.init();
  input.initTyping();
  input.initMidi();
  document.addEventListener('pointerdown', () => audio.ctx(), { once: true });
})();

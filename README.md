# Home Row — a typing tutor for the piano

A browser app that teaches an absolute beginner to play a digital piano the way typing tutors teach typing: home position first, then drills scored on accuracy and speed, then reading the staff, then songs and chords. The piano is plugged into a tablet or laptop over USB, and the app hears every key through Web MIDI.

Live: https://joshgreenman1973.github.io/home-row/

## Hardware

- Piano: Donner DDP-80 (USB-B MIDI port on the back; no Bluetooth on the base model).
- Cable: USB-B (piano) to USB-C (tablet). Power the piano on before plugging in.
- Runs in Chrome on Android, or Chrome/Edge on a Mac or PC. Safari on iPad cannot see MIDI devices, so the iPad is out.
- No piano? Computer keys A–K play the white keys from middle C, W E T Y U the black keys, Z–M the octave below. The on-screen keyboard is tappable.

## Curriculum

| # | Lesson | What it drills |
|---|--------|----------------|
| 0 | Find middle C | Locate middle C from the two-black-key group; walk C D E F G |
| 1 | Right hand, home position | C4–G4 under fingers 1–5; neighbor moves, then random |
| 2 | Left hand, home position | C3–G3 under fingers 5–1 |
| 3 | Both hands | Alternating hands, parallel motion, then different notes together |
| 4 | Reaching out | The full octave in each hand (A, B, next C) |
| 5 | Keeping time | Metronome; one note per click, timing offset reported |
| 6 | Reading the staff | Same drills, letters off, grand staff on (letters toggle available) |
| 7 | Songs | Mary Had a Little Lamb, Twinkle, Ode to Joy, Frère Jacques, Row Your Boat, Jingle Bells, Happy Birthday; two left-hand versions |
| 8 | Chords under the tune | C / F / G triads in the left hand, then three songs with chords |

Random drills are seeded per round and weighted toward the keys the player has been missing (`weights` in localStorage). A round passes at 90% accuracy (timed rounds also need ≤15% missed clicks). Accuracy = correct presses / all presses. Speed = notes per minute from first press to last.

## Files

- `index.html` — shell
- `lessons.js` — curriculum, songs, typing map
- `app.js` — MIDI/typing/touch input, drill engine, staff renderer, piano ribbon, screens
- `style.css` — white keys, black keys, red felt

No build step, no dependencies beyond two Google Fonts. Progress lives in `localStorage` only.

## Method notes

Lesson order follows the standard beginner method-book path (middle C position → left hand → hands together → extended position → rhythm → reading → repertoire → chords). Finger numbers use the universal 1 = thumb … 5 = pinky. Chord voicings keep the left hand in C position: C = C3 E3 G3, F = C3 F3 A3, G = B2 D3 G3. All songs are traditional melodies in the public domain; melodies only, no lyrics.

Built by Josh Greenman with Claude, August 2026.

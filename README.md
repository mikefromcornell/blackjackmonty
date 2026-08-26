# Blackjack Bankroll Monte Carlo · Gambler's Ruin

Browser-only educational simulator for bankroll variance and the classic
**gambler's ruin** coin-flip duel between two players with different bankrolls.

- **Session simulator** — Monte Carlo blackjack sessions (final-bankroll
  histogram, path percentiles, ruin risk, optimal-stop table).
- **My outcome percentile** — rank your real session against thousands of
  matching simulated sessions.
- **Gambler's ruin** — two players flip a coin, loser pays the stake, the first
  to run out of money loses. Shows the Monte Carlo outcome distribution and the
  exact probability that **either player reaches any specific bankroll before
  the other player is at $0**.

The mathematics and the simulation live in the app. `gamblers_ruin.py` is a
standalone command-line version of the same formulas and Monte Carlo for
reproducibility.

---

## The gambler's ruin model

Alice starts with `a` units, Bob with `b` units, and the total pot is
`s = a + b`. On every flip Alice wins one unit with probability `p` and Bob
wins one unit with probability `q = 1 - p`. The game ends when one player's
bankroll reaches `0`.

Alice's bankroll is a symmetric random walk on `{0, 1, …, s}` absorbed at `0`
(Bob wins) and `s` (Alice wins).

### Fair coin (p = q = 1/2)

The bankroll is a martingale, so the ruin probabilities are exactly the starting
bankroll shares:

```
P(Alice ruins Bob) = a / (a + b)
P(Bob   ruins Alice) = b / (a + b)
E[flips until ruin]  = a · b
```

Example: Alice $70 vs Bob $30, $1 stakes → 70 vs 30 units → Alice wins 70% of
the time, Bob wins 30%, and the game lasts 2100 flips on average. At $10 stakes
the units are 7 vs 3 and the game lasts 21 flips on average — same odds, shorter
game.

### Biased coin (p ≠ q)

```
P(Alice ruins Bob) = (1 - (q/p)^a) / (1 - (q/p)^(a+b))
```

A small edge compounds with the game length, which is why a nearly-fair coin
can still favor the richer player enormously.

### Probability of reaching a specific value before the other hits $0

For Alice,
- if target `x > a`:  P(Alice reaches x before Bob's $0) =
  `(1 - (q/p)^a) / (1 - (q/p)^x)`
- if target `x < a`:  the mirror formula with the upper barrier at `s`

At `x = a + b` this is just P(Alice ruins Bob). Bob's targets are the mirror:
Bob reaching bankroll `y` is Alice reaching `s - y`.

The browser tab draws the exact reach-probability curve for **every** bankroll
level and overlays it with the Monte Carlo estimate (dashed) — the two lines are
supposed to agree to within sampling noise.

---

## What the Monte Carlo tab shows

When you run a gambler's-ruin simulation, it produces:

1. **Who ruins whom** — Monte Carlo vs exact ruin probability (Alice or Bob
   reaches $0).
2. **Target table** — Monte Carlo vs exact probability Alice reaches a chosen
   bankroll before Bob's $0, and Bob reaches a chosen bankroll before Alice's $0.
3. **Time-to-ruin distribution** — histogram of flips until the first player
   goes broke, with mean and median (theory mean is `a·b` for a fair coin).
4. **Reach-probability chart** — for every Alice bankroll level, the exact and
   Monte Carlo probability that Alice or Bob ever reaches that bankroll before
   the other is at $0.

---

## Run locally

Open `index.html` in a browser (or serve the folder):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

The standalone Python version of the mathematics and simulation:

```bash
python3 gamblers_ruin.py 70 30 --fair --sims 50000
```

```
P(Alice ruins Bob)  = 0.7006 (exact 0.7000)
P(Bob ruins Alice)  = 0.2994 (exact 0.3000)
Mean flips to ruin  = 2092.14  (exact 2100.00)
```

Run the exact-formula check (no extra dependencies):

```bash
python3 -m unittest discover -s tests -v
node --check app.js
```

---

## Files

- `index.html` — the single-page app (all tabs, styles, and controls).
- `app.js` — simulation engine, exact gambler's-ruin formulas, canvas charts.
- `gamblers_ruin.py` — standalone Python reproduction of the exact math plus an
  optional Monte Carlo run.
- `tests/test_gamblers_ruin.py` — `unittest` coverage of the formulas and MC.
- `.github/workflows/blank.yml` — existing placeholder workflow, unchanged.

Educational/entertainment use only. Not gambling advice.

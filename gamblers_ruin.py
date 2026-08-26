#!/usr/bin/env python3
"""Gambler's ruin: exact mathematics plus an optional Monte Carlo check.

Two players, Alice and Bob, flip a coin. The loser pays the winner one unit
of stake. The game ends when a player reaches a bankroll of $0.

This module is a standalone Python companion to the Gambler's ruin tab in the
web app. It provides the exact absorption probabilities, the probability that
either player reaches an arbitrary target bankroll before the other is at $0,
and a Monte Carlo simulator that should reproduce those numbers.

Example
-------
    python3 gamblers_ruin.py 70 30 --stake 1 --sims 50000
    python3 gamblers_ruin.py 70 30 --p 0.55 --target-a 90 --target-b 45
"""

from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass


@dataclass(frozen=True)
class Scenario:
    alice_units: int
    bob_units: int
    p_alice: float
    target_alice: int | None = None  # Alice's bankroll target (in units)
    target_bob: int | None = None    # Bob's bankroll target (in units)


def alice_win_prob(a: int, s: int, p: float) -> float:
    """P(Alice reaches the total pot s before 0)."""
    if s <= 0 or a <= 0:
        return 0.0
    if a >= s:
        return 1.0
    q = 1.0 - p
    if abs(p - q) < 1e-15:
        return a / s
    if p <= 0 or q <= 0:
        return 1.0 if p > 0 else 0.0
    r = q / p
    n, d = 1.0 - r**a, 1.0 - r**s
    return a / s if abs(d) < 1e-15 else n / d


def alice_reach_prob(a: int, s: int, x: int, p: float) -> float:
    """P(Alice's bankroll ever reaches level x before Alice's bankroll hits s).

    `0 <= x <= s`. Bob's $0 is Alice hitting s; Alice's $0 is Bob's win.
    """
    q = 1.0 - p
    if x <= 0:
        return 1.0 - alice_win_prob(a, s, p)
    if x >= s:
        return alice_win_prob(a, s, p)
    if abs(p - q) < 1e-15:
        return a / x if x > a else (s - a) / (s - x)
    r = q / p
    if x > a:
        # Reach an upper target x before hitting the lower boundary 0.
        den = 1.0 - r**x
        return a / x if abs(den) < 1e-15 else (1.0 - r**a) / den
    # Hit a lower target x before hitting the upper boundary s.
    den = 1.0 - r ** (s - x)
    if abs(den) < 1e-15:
        return (s - a) / (s - x)
    return (r ** (a - x) - r ** (s - x)) / den


def bob_reach_prob(alice_units: int, total_units: int, y: int, p: float) -> float:
    """P(Bob's bankroll ever reaches level y before Alice's bankroll hits 0)."""
    if y <= 0:
        # Bob is at $0 only when Alice has already taken the whole pot.
        return alice_win_prob(alice_units, total_units, p)
    if y >= total_units:
        # Bob takes all = Alice is at $0.
        return 1.0 - alice_win_prob(alice_units, total_units, p)
    return alice_reach_prob(alice_units, total_units, total_units - y, p)


def expected_flips(a: int, s: int, p: float) -> float:
    """Expected number of flips until absorption at 0 or s."""
    q = 1.0 - p
    if abs(p - q) < 1e-15:
        return float(a * (s - a))
    d, r = q - p, q / p
    if abs(d) < 1e-15:
        return float(a * (s - a))
    den = 1.0 - r**s
    if abs(den) < 1e-15:
        return float(a * (s - a))
    return a / d - (s / d) * (1.0 - r**a) / den


def run_monte_carlo(scenario: Scenario, sims: int, seed: int | None = None) -> dict:
    a, s = scenario.alice_units, scenario.alice_units + scenario.bob_units
    p = scenario.p_alice
    t_a = scenario.target_alice
    t_b = scenario.target_bob
    rng = random.Random(seed) if seed is not None else random.Random()

    alice_wins = 0
    hit_a, hit_b = 0, 0
    durations: list[int] = []
    max_a: list[int] = []
    min_a: list[int] = []

    for _ in range(sims):
        bank = a
        flips = 0
        mx, mn = a, a
        ra = rb = False
        while 0 < bank < s:
            bank += 1 if rng.random() < p else -1
            flips += 1
            mx, mn = max(mx, bank), min(mn, bank)
            if not ra:
                ra = bank == 0 if t_a == 0 else bank >= t_a if t_a is not None else False
            if not rb:
                rb = bank == s if t_b == 0 else bank <= s - t_b if t_b is not None else False

        alice_wins += int(bank >= s)
        hit_a += int(ra)
        hit_b += int(rb)
        durations.append(flips)
        max_a.append(mx)
        min_a.append(mn)

    return {
        "alice_wins": alice_wins,
        "alice_win_p": alice_wins / sims,
        "bob_win_p": 1 - alice_wins / sims,
        "hit_a": hit_a,
        "hit_a_p": hit_a / sims,
        "hit_b": hit_b,
        "hit_b_p": hit_b / sims,
        "mean_duration": sum(durations) / len(durations),
        "median_duration": sorted(durations)[len(durations) // 2],
        "p95_duration": sorted(durations)[int(len(durations) * 0.95)],
        "max_a": max_a,
        "min_a": min_a,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("alice", type=float, help="Alice's starting bankroll (dollars)")
    ap.add_argument("bob", type=float, help="Bob's starting bankroll (dollars)")
    ap.add_argument("--stake", type=float, default=1.0, help="Dollars won/lost per flip (default 1)")
    ap.add_argument("--p", type=float, default=0.5, help="P(Alice wins one flip), 0..1 (default 0.5)")
    ap.add_argument("--fair", action="store_true", help="Force a fair coin (p = 0.5)")
    ap.add_argument("--target-a", type=float, default=None, help="Alice's target bankroll before Bob's $0")
    ap.add_argument("--target-b", type=float, default=None, help="Bob's target bankroll before Alice's $0")
    ap.add_argument("--sims", type=int, default=5000, help="Monte Carlo games (default 5000)")
    ap.add_argument("--seed", type=int, default=None, help="Optional RNG seed")
    args = ap.parse_args()

    stake = max(1.0, float(args.stake))
    ua = max(1, round(args.alice / stake))
    ub = max(1, round(args.bob / stake))
    s = ua + ub
    p = 0.5 if args.fair else min(0.999999, max(0.000001, args.p))

    ta = (
        max(0, min(s, round(args.target_a / stake)))
        if args.target_a is not None
        else None
    )
    tb = (
        max(0, min(s, round(args.target_b / stake)))
        if args.target_b is not None
        else None
    )

    scenario = Scenario(alice_units=ua, bob_units=ub, p_alice=p, target_alice=ta, target_bob=tb)
    n = args.sims
    mc = run_monte_carlo(scenario, n, args.seed)

    fair = "fair" if abs(p - 0.5) < 1e-9 else "biased"
    print(f"Scenario: Alice ${ua*stake:,.0f} ({ua} units) vs Bob ${ub*stake:,.0f} ({ub} units), "
          f"stake ${stake:,.0f}, {fair} coin (p={p:.3f})")
    print(f"Total pot: {s} units ($ {s*stake:,.0f})")
    print()
    print("Exact probabilities")
    print(f"  P(Alice ruins Bob)        = {alice_win_prob(ua, s, p):.6f}")
    print(f"  P(Bob   ruins Alice)      = {1 - alice_win_prob(ua, s, p):.6f}")
    print(f"  E[flips until ruin]       = {expected_flips(ua, s, p):.3f}")
    if ta is not None:
        print(f"  P(Alice reaches {ta})        = {alice_reach_prob(ua, s, ta, p):.6f}")
    if tb is not None:
        print(f"  P(Bob   reaches {tb})        = {bob_reach_prob(ua, s, tb, p):.6f}")
    print()
    print(f"Monte Carlo ({n:,} games)")
    print(f"  P(Alice ruins Bob)        = {mc['alice_win_p']:.6f}")
    print(f"  P(Bob   ruins Alice)      = {mc['bob_win_p']:.6f}")
    print(f"  Mean flips to ruin        = {mc['mean_duration']:.3f}")
    print(f"  Median / 95th flips       = {mc['median_duration']} / {mc['p95_duration']}")
    if ta is not None:
        print(f"  MC P(Alice reaches {ta})   = {mc['hit_a_p']:.6f}")
    if tb is not None:
        print(f"  MC P(Bob   reaches {tb})   = {mc['hit_b_p']:.6f}")


if __name__ == "__main__":
    main()

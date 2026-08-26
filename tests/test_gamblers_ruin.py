"""Tests for the exact gambler's ruin formulas in gamblers_ruin.py.

Run with:  python3 -m unittest discover -s tests
"""

import unittest

from gamblers_ruin import (
    alice_reach_prob,
    alice_win_prob,
    bob_reach_prob,
    expected_flips,
    run_monte_carlo,
    Scenario,
)


class GamblerRuinTests(unittest.TestCase):
    def assertClose(self, a, b, tol=1e-9):
        self.assertAlmostEqual(a, b, delta=tol)

    def test_fair_coin_ruin_probabilities(self):
        self.assertClose(alice_win_prob(7, 10, 0.5), 0.7)
        self.assertClose(alice_win_prob(3, 10, 0.5), 0.3)
        self.assertClose(expected_flips(7, 10, 0.5), 21.0)

    def test_symmetric_walk(self):
        self.assertClose(alice_win_prob(50, 100, 0.5), 0.5)
        self.assertClose(alice_reach_prob(50, 100, 50, 0.5), 1.0)

    def test_reach_above_and_below_start(self):
        self.assertClose(alice_reach_prob(7, 10, 9, 0.5), 7 / 9)
        self.assertClose(alice_reach_prob(7, 10, 4, 0.5), (10 - 7) / (10 - 4))

    def test_bob_reach_is_mirror(self):
        self.assertClose(bob_reach_prob(7, 10, 7, 0.5),
                         alice_reach_prob(7, 10, 3, 0.5))
        self.assertClose(bob_reach_prob(7, 10, 10, 0.5), 0.3)
        self.assertClose(bob_reach_prob(7, 10, 0, 0.5), 0.7)

    def test_biased_coin_matches_fair_limit(self):
        p = 0.5 + 1e-10
        self.assertClose(alice_win_prob(7, 10, p), 0.7, tol=1e-6)

    def test_monte_carlo_matches_exact(self):
        scenario = Scenario(alice_units=7, bob_units=3, p_alice=0.5)
        mc = run_monte_carlo(scenario, sims=40000, seed=1)
        self.assertClose(mc["alice_win_p"], 0.7, tol=0.01)
        self.assertClose(mc["mean_duration"], 21.0, tol=0.7)

    def test_formulas_are_probabilities(self):
        for x in range(0, 11):
            v = alice_reach_prob(7, 10, x, 0.5)
            self.assertGreaterEqual(v, 0)
            self.assertLessEqual(v, 1 + 1e-12)
        for y in range(0, 11):
            v = bob_reach_prob(7, 10, y, 0.5)
            self.assertGreaterEqual(v, 0)
            self.assertLessEqual(v, 1 + 1e-12)


if __name__ == "__main__":
    unittest.main()

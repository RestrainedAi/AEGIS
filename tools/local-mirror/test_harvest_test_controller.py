import unittest
from harvest_test_controller import launch_allowed, terminal


class FiniteHarvestTest(unittest.TestCase):
    def test_pending_dispatch_never_retried(self):
        self.assertFalse(launch_allowed({'executions': [], 'dispatch_pending': {'id': 'x'}}, [], 99999)[0])

    def test_running_nightly_blocks_launch(self):
        self.assertFalse(launch_allowed({'executions': []}, [{'conditions': [{'type': 'Completed', 'state': 'CONDITION_PENDING'}]}], 99999)[0])

    def test_cooldown_and_limit(self):
        state = {'executions': [{'dispatched_at': 100}]}
        self.assertFalse(launch_allowed(state, [], 21699)[0])
        self.assertTrue(launch_allowed(state, [], 21700)[0])
        state['executions'] *= 6
        self.assertFalse(launch_allowed(state, [], 999999)[0])

    def test_failed_cancelled_is_terminal(self):
        self.assertTrue(terminal({'conditions': [{'type': 'Completed', 'state': 'CONDITION_FAILED'}]}))
        self.assertTrue(terminal({'completionTime': 'x'}))


if __name__ == '__main__':
    unittest.main()

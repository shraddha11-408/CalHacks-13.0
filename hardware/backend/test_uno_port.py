"""Run: python3 -m unittest test_uno_port   (from hardware/backend)"""
import unittest

from uno_port import find_port


class FindPortTest(unittest.TestCase):
    def test_env_var_wins_over_detection(self):
        self.assertEqual(find_port({"UNO_PORT": "COM5"}, globber=lambda p: ["/dev/cu.usbmodem1"]), "COM5")

    def test_macos_device_is_found(self):
        fake = lambda p: ["/dev/cu.usbmodem638911932"] if "cu.usbmodem" in p else []
        self.assertEqual(find_port({}, globber=fake), "/dev/cu.usbmodem638911932")

    def test_linux_device_is_found(self):
        fake = lambda p: ["/dev/ttyACM0"] if "ttyACM" in p else []
        self.assertEqual(find_port({}, globber=fake), "/dev/ttyACM0")

    def test_first_of_several_is_chosen_in_sorted_order(self):
        self.assertEqual(find_port({}, globber=lambda p: ["/dev/ttyACM1", "/dev/ttyACM0"] if "ACM" in p else []), "/dev/ttyACM0")

    def test_none_when_nothing_is_plugged_in(self):
        self.assertIsNone(find_port({}, globber=lambda p: []))


if __name__ == "__main__":
    unittest.main()

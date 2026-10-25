"""Pack pictures for the Uno Q LED matrix and print them as C arrays for wrist_node.ino.

The Uno Q matrix is 13 columns x 8 rows (NOT the Uno R4's 12x8). Arduino_LED_Matrix::loadFrame
takes uint32_t[4]: 104 pixels packed row-major, first pixel in the most significant bit of word 0.

  python3 matrix_frames.py        # print the C arrays and an ASCII preview of each frame
  python3 -m unittest matrix_frames
"""
import unittest

COLS, ROWS = 13, 8

FONT = {  # 5 wide x 7 tall
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
}


def two_letters(a: str, b: str):
    """Grid with two 5x7 letters, one blank column on each side and between them."""
    g = [[0] * COLS for _ in range(ROWS)]
    for r in range(7):
        for c in range(5):
            g[r][1 + c] = int(FONT[a][r][c])
            g[r][7 + c] = int(FONT[b][r][c])
    return g


def border():
    g = [[0] * COLS for _ in range(ROWS)]
    for r in range(ROWS):
        for c in range(COLS):
            g[r][c] = int(r in (0, ROWS - 1) or c in (0, COLS - 1))
    return g


CHECK = [  # "note sent" (serial command NOTE): a check mark, centered
    ".............",
    "..........#..",
    ".........##..",
    "..#.....##...",
    "..##...##....",
    "...##.##.....",
    "....###......",
    ".....#.......",
]


def check():
    return [[int(ch == "#") for ch in row] for row in CHECK]


def solid():
    return [[1] * COLS for _ in range(ROWS)]


def pack(grid):
    bits = "".join(str(grid[r][c]) for r in range(ROWS) for c in range(COLS)).ljust(128, "0")
    return [int(bits[i:i + 32], 2) for i in range(0, 128, 32)]


def unpack(words):
    bits = "".join(f"{w:032b}" for w in words)
    return [[int(bits[r * COLS + c]) for c in range(COLS)] for r in range(ROWS)]


def c_array(name, grid):
    art = "\n".join("//   " + "".join("#" if v else "." for v in row) for row in grid)
    w = ", ".join(f"0x{x:08x}" for x in pack(grid))
    return f"{art}\nconst uint32_t {name}[] = {{ {w} }};"


class FrameTest(unittest.TestCase):
    def test_pack_unpack_roundtrip(self):
        for g in (two_letters("C", "A"), two_letters("L", "L"), border(), solid(), check()):
            self.assertEqual(unpack(pack(g)), g)

    def test_first_pixel_is_msb_of_word_zero(self):
        g = [[0] * COLS for _ in range(ROWS)]
        g[0][0] = 1
        self.assertEqual(pack(g), [0x80000000, 0, 0, 0])

    def test_pixel_32_starts_word_one(self):
        g = [[0] * COLS for _ in range(ROWS)]
        g[2][6] = 1  # index 2*13+6 = 32
        self.assertEqual(pack(g), [0, 0x80000000, 0, 0])

    def test_last_pixel_is_bit_24_of_word_three(self):
        g = [[0] * COLS for _ in range(ROWS)]
        g[7][12] = 1  # index 103 -> word 3, bit position 7 from MSB
        self.assertEqual(pack(g), [0, 0, 0, 0x01000000])

    def test_check_is_13x8(self):
        self.assertEqual((len(CHECK), {len(r) for r in CHECK}), (ROWS, {COLS}))

    def test_letters_fit_without_touching_the_edges(self):
        for g in (two_letters("C", "A"), two_letters("L", "L")):
            self.assertTrue(all(row[0] == 0 and row[COLS - 1] == 0 for row in g))
            self.assertTrue(all(v == 0 for v in g[ROWS - 1]))


if __name__ == "__main__":
    print(c_array("CALL_CA", two_letters("C", "A")))
    print(c_array("CALL_LL", two_letters("L", "L")))
    print(c_array("TEST_BORDER", border()))
    print(c_array("ALL_ON", solid()))
    print(c_array("NOTE_CHECK", check()))

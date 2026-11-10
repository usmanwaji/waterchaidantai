"""Text cleanup utilities for Thai extracted from PDFs / web / LINE pastes."""
import re
import unicodedata

# Zero-width and invisible junk that PDF extraction / web paste leaves behind.
_ZERO_WIDTH = {
    "​",  # ZERO WIDTH SPACE
    "‌",  # ZERO WIDTH NON-JOINER
    "‍",  # ZERO WIDTH JOINER
    "﻿",  # ZERO WIDTH NO-BREAK SPACE / BOM
    "­",  # SOFT HYPHEN
    "⁠",  # WORD JOINER
}
_ZERO_WIDTH_RE = re.compile("[" + "".join(_ZERO_WIDTH) + "]")

# Thai Unicode block helpers
_THAI_RANGE = (0x0E00, 0x0E7F)
# Above/below vowels and tone marks that combine onto a base consonant.
_THAI_UPPER_VOWELS = set("ัิีึื็")  # mai han-akat, i, ii, ue, uee, maitaikhu
_THAI_LOWER_VOWELS = set("ฺุู")                     # u, uu, phinthu
_THAI_TONES = set("่้๊๋์")               # ek tho tri chattawa thanthakhat


def _is_thai(ch):
    return _THAI_RANGE[0] <= ord(ch) <= _THAI_RANGE[1]


def _reorder_tone_vowel(text):
    """Fix tone-mark-before-vowel ordering produced by bad OCR/extraction.

    Correct Thai order on a base consonant is: base, (upper/lower vowel), tone.
    Some sources emit base, tone, vowel — which renders wrong. Swap any
    adjacent (tone, vowel) pair into (vowel, tone).
    """
    chars = list(text)
    i = 0
    while i < len(chars) - 1:
        a, b = chars[i], chars[i + 1]
        if a in _THAI_TONES and (b in _THAI_UPPER_VOWELS or b in _THAI_LOWER_VOWELS):
            chars[i], chars[i + 1] = b, a
            # step back so a newly-formed pair can also be checked
            if i > 0:
                i -= 1
                continue
        i += 1
    return "".join(chars)


def _strip_fake_spaces(text):
    """Remove spaces that sit *between two Thai characters*.

    PDF copy often inserts a space between every glyph. We drop a space only
    when both neighbours are Thai, so spaces around English/ASCII numbers
    survive. Also collapses a run of spaces that is entirely surrounded by Thai.

    Note: the Thai Unicode block includes Thai numerals (๐-๙), so a space
    between two Thai digits — or between a Thai digit and a Thai letter — is
    treated as a fake glyph-gap and removed. This is intentional for the PDF
    copy-paste use case (where digits are glyph-spaced like everything else);
    pass digit-bearing text through before any digit-grouping if you need to
    keep such spaces.
    """
    out = []
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if ch == " ":
            # find the run of spaces
            j = i
            while j < n and text[j] == " ":
                j += 1
            prev = out[-1] if out else ""
            nxt = text[j] if j < n else ""
            if prev and nxt and _is_thai(prev) and _is_thai(nxt):
                # fake space(s) between Thai glyphs -> drop entirely
                i = j
                continue
            else:
                out.append(" ")
                i = j
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def clean_pdf_thai(text):
    """Clean Thai text extracted from PDFs, the web, or LINE.

    Steps (in order):
      1. NFC normalize (recompose decomposed sequences).
      2. Normalize NBSP -> ordinary space, strip zero-width / soft-hyphen junk.
      3. Reorder any tone-before-vowel sequences.
      4. Remove fake spaces inserted *between* Thai glyphs.

    English words, numbers and URLs are preserved untouched.
    """
    if not text:
        return text
    # 1) NFC
    text = unicodedata.normalize("NFC", text)
    # 2a) NBSP / narrow NBSP -> normal space, then drop zero-width junk
    text = text.replace(" ", " ").replace(" ", " ")
    text = _ZERO_WIDTH_RE.sub("", text)
    # 3) tone/vowel ordering
    text = _reorder_tone_vowel(text)
    # 4) fake spaces between Thai
    text = _strip_fake_spaces(text)
    return text


_ARABIC_TO_THAI = {ord(str(d)): "๐๑๒๓๔๕๖๗๘๙"[d] for d in range(10)}


def to_thai_digits(text):
    """Convert ASCII digits 0-9 to Thai numerals ๐-๙ (leaves everything else)."""
    if not text:
        return text
    return text.translate(_ARABIC_TO_THAI)

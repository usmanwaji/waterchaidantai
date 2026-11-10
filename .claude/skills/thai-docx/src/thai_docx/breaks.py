"""insert_thai_breaks: add U+200B (ZWSP) at Thai word boundaries via pythainlp.

Word/LibreOffice wrap Thai lines poorly because Thai has no spaces between
words. Inserting a zero-width space at word boundaries lets the line breaker
wrap nicely without showing any visible character. Numbers, ASCII words and
URLs are left untouched (no ZWSP injected inside them).

Requires ``pythainlp``. Without it, ``insert_thai_breaks`` warns and is a no-op
so the rest of the pipeline keeps working.
"""
import re
import warnings

ZWSP = "​"

try:  # pragma: no cover - import guard
    from pythainlp import word_tokenize

    HAS_PYTHAINLP = True
except Exception:  # pragma: no cover
    word_tokenize = None
    HAS_PYTHAINLP = False

_THAI_CHAR = re.compile(r"[฀-๿]")
# split text into "Thai chunks" vs "non-Thai chunks" (ascii words, numbers, urls)
_THAI_CHUNK = re.compile(r"[฀-๿]+")


def _break_thai_segment(segment):
    """Tokenize a pure-Thai segment and join tokens with ZWSP."""
    tokens = word_tokenize(segment, engine="newmm", keep_whitespace=False)
    tokens = [t for t in tokens if t]
    return ZWSP.join(tokens)


def insert_thai_breaks_text(text):
    """Return ``text`` with ZWSP inserted at Thai word boundaries only."""
    if not HAS_PYTHAINLP:
        warnings.warn("pythainlp not installed; insert_thai_breaks skipped", RuntimeWarning)
        return text
    if not text:
        return text
    out = []
    last = 0
    for m in _THAI_CHUNK.finditer(text):
        out.append(text[last:m.start()])          # non-Thai part, untouched
        out.append(_break_thai_segment(m.group()))  # Thai part, broken
        last = m.end()
    out.append(text[last:])
    return "".join(out)


def insert_thai_breaks(doc):
    """Insert ZWSP at Thai word boundaries in every run's text, in-place."""
    if not HAS_PYTHAINLP:
        warnings.warn("pythainlp not installed; insert_thai_breaks skipped", RuntimeWarning)
        return doc
    from ._runs import iter_runs, blob_part_roots, flush_blob_part
    from docx.oxml.ns import qn

    def _break_runs(runs):
        for r in runs:
            for t in r.findall(qn("w:t")):
                if t.text and _THAI_CHAR.search(t.text):
                    t.text = insert_thai_breaks_text(t.text)

    # iter_runs covers live parts (and yields blob runs too, but those edits are
    # thrown away); re-process footnotes/endnotes on a tree we write back.
    _break_runs(iter_runs(doc))
    for part, root in blob_part_roots(doc):
        _break_runs(root.iter(qn("w:r")))
        flush_blob_part(part, root)
    return doc

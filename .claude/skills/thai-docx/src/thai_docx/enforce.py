"""enforce_thai: fill complex-script properties so Thai renders correctly in Word.

Core principle
--------------
Word resolves a font for each run *per script slot*. Thai uses the **complex
script** slot. python-docx writes only the Latin slot (``w:ascii``/``w:hAnsi``)
and ``w:sz``. The result in Microsoft Word: Thai falls back to a default face,
tone marks/vowels float, the glyphs shrink, and ``bold``/``italic`` don't apply
because Word looks at ``w:bCs``/``w:iCs`` for complex scripts.

This module sets, on three levels:
  * **docDefaults** (``w:rPrDefault``)  -> a cs font + szCs, so runs that inherit
    their size from the style chain do NOT shrink.
  * **styles**                          -> a cs font on every style's rPr.
  * **every run**                       -> cs font, ``w:lang w:bidi='th-TH'``,
    and — only when the run already carries an explicit ``w:sz``/``w:b``/``w:i`` —
    the mirrored ``w:szCs``/``w:bCs``/``w:iCs``.

The run-level rule about *only mirroring what's explicitly there* is what keeps
headings from shrinking: a heading run inherits its 18pt from the style, so it
has no ``w:sz``; we must not invent a ``w:szCs`` (that would override the style
with the default 22 half-points). The docDefaults szCs covers the inherited case.

``force=False`` (default) only fills empty slots — an intentional cs font is kept.
``force=True`` overwrites. The operation is **idempotent**.
"""
from docx.oxml.ns import qn

from ._xml import get_or_add, rfonts, set_attr, get_attr
from ._runs import iter_runs, blob_part_roots, flush_blob_part

DEFAULT_THAI_FONT = "TH Sarabun New"
THAI_BIDI = "th-TH"


def enforce_thai(
    doc,
    *,
    force=False,
    thai_font=DEFAULT_THAI_FONT,
    bidi=THAI_BIDI,
    thai_digits=False,
    insert_breaks=False,
):
    """Enforce complex-script properties across the whole document.

    Parameters
    ----------
    force : bool          overwrite existing cs font/lang when True.
    thai_font : str       font name for the complex-script slot.
    bidi : str            value for ``w:lang w:bidi`` (default ``th-TH``).
    thai_digits : bool    also convert ASCII digits in run text to Thai numerals.
    insert_breaks : bool  also run ZWSP word-break (requires pythainlp).
    """
    _enforce_docdefaults(doc, thai_font, bidi, force)
    _enforce_styles(doc, thai_font, force)

    # Live-element parts (body, tables, header/footer, numbering, comments,
    # text boxes) — mutated in place; persisted automatically on save.
    for r in iter_runs(doc):
        _enforce_run(r, thai_font, bidi, force)

    if thai_digits:
        from .text import to_thai_digits
        for r in iter_runs(doc):
            for t in r.findall(qn("w:t")):
                if t.text:
                    t.text = to_thai_digits(t.text)

    # Footnotes/endnotes live in blob-only parts: parse, enforce (+ optional
    # digit conversion), and write the bytes back so the edits survive
    # doc.save. iter_runs above mutated a throwaway copy of these; here we do it
    # on the tree we actually persist.
    for part, root in blob_part_roots(doc):
        for r in root.iter(qn("w:r")):
            _enforce_run(r, thai_font, bidi, force)
            if thai_digits:
                from .text import to_thai_digits
                for t in r.findall(qn("w:t")):
                    if t.text:
                        t.text = to_thai_digits(t.text)
        flush_blob_part(part, root)

    if insert_breaks:
        from .breaks import insert_thai_breaks
        insert_thai_breaks(doc)

    return doc


def _enforce_run(r, thai_font, bidi, force):
    rpr = r.find(qn("w:rPr"))
    if rpr is None:
        # run with no rPr but with text still needs a cs font + bidi
        rpr = r.makeelement(qn("w:rPr"), {})
        r.insert(0, rpr)

    # 1) cs font
    rf = rfonts(rpr)
    if force or not get_attr(rf, "w:cs"):
        set_attr(rf, "w:cs", thai_font)

    # 2) bidi language
    lang = get_or_add(rpr, "w:lang")
    if force or not get_attr(lang, "w:bidi"):
        set_attr(lang, "w:bidi", bidi)

    # 3) mirror ONLY what is explicitly present on this run.
    sz = rpr.find(qn("w:sz"))
    if sz is not None:
        szcs = get_or_add(rpr, "w:szCs")
        if force or not get_attr(szcs, "w:val"):
            set_attr(szcs, "w:val", sz.get(qn("w:val")))

    b = rpr.find(qn("w:b"))
    if b is not None:
        bcs = get_or_add(rpr, "w:bCs")
        if force or get_attr(bcs, "w:val") is None:
            _mirror_bool(b, bcs)

    i = rpr.find(qn("w:i"))
    if i is not None:
        ics = get_or_add(rpr, "w:iCs")
        if force or get_attr(ics, "w:val") is None:
            _mirror_bool(i, ics)


def _mirror_bool(src, dst):
    val = src.get(qn("w:val"))
    if val is None:
        # <w:b/> with no val means "true"
        set_attr(dst, "w:val", "1")
    else:
        set_attr(dst, "w:val", val)


def _enforce_docdefaults(doc, thai_font, bidi, force):
    """Ensure rPrDefault has a cs font + szCs (mirrors default sz) + bidi lang."""
    styles_el = doc.styles.element
    docdef = get_or_add(styles_el, "w:docDefaults")
    rprdef = get_or_add(docdef, "w:rPrDefault")
    rpr = get_or_add(rprdef, "w:rPr")

    rf = rfonts(rpr)
    if force or not get_attr(rf, "w:cs"):
        set_attr(rf, "w:cs", thai_font)

    # szCs mirrors default sz (or a sane 16pt=32 fallback) so inherited runs
    # keep their intended size for the complex slot instead of defaulting.
    sz = rpr.find(qn("w:sz"))
    szcs = get_or_add(rpr, "w:szCs")
    default_val = sz.get(qn("w:val")) if sz is not None else None
    if force or not get_attr(szcs, "w:val"):
        set_attr(szcs, "w:val", default_val or "22")

    lang = get_or_add(rpr, "w:lang")
    if force or not get_attr(lang, "w:bidi") or get_attr(lang, "w:bidi") == "ar-SA":
        set_attr(lang, "w:bidi", bidi)


def _enforce_styles(doc, thai_font, force):
    """Put a cs font on every style's rPr.

    We deliberately do NOT add szCs to styles that define an explicit sz —
    the style's own sz/szCs relationship is left intact; we only ensure a cs
    font exists so inherited runs land on the right face. If a style sets sz
    but no szCs, mirror it so its size carries to the complex slot.
    """
    styles_el = doc.styles.element
    for style in styles_el.findall(qn("w:style")):
        rpr = style.find(qn("w:rPr"))
        if rpr is None:
            # Only styles that already define run properties are touched, so we
            # never have to guess where w:rPr belongs in CT_Style's child order.
            continue
        rf = rfonts(rpr)
        if force or not get_attr(rf, "w:cs"):
            set_attr(rf, "w:cs", thai_font)
        # if the style fixes a Latin size but no complex size, mirror it
        sz = rpr.find(qn("w:sz"))
        if sz is not None:
            szcs = rpr.find(qn("w:szCs"))
            if szcs is None:
                szcs = get_or_add(rpr, "w:szCs")
                set_attr(szcs, "w:val", sz.get(qn("w:val")))

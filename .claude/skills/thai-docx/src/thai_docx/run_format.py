"""set_thai_run: control Thai (complex-script) vs Latin font/size in one run."""
from docx.shared import Length

from ._xml import get_rpr, rfonts, get_or_add, set_attr


def _to_half_points(size):
    """Accept an EMU Length (Pt(...)) or an int half-point value."""
    if size is None:
        return None
    if isinstance(size, Length):
        return str(int(round(size.pt * 2)))
    return str(int(size))


def set_thai_run(
    run,
    thai_font="TH Sarabun New",
    latin_font=None,
    thai_size=None,
    latin_size=None,
    bold=None,
    italic=None,
):
    """Split font/size between the Thai (cs) and Latin (ascii/hAnsi) slots.

    Word renders Thai glyphs with the *complex-script* font slot. python-docx
    only sets the Latin slot, so Thai falls back to a default and tone marks
    float / the font shrinks. This sets both slots explicitly in one run.

    Parameters
    ----------
    thai_font : str          font for the cs (Thai) slot.
    latin_font : str | None  font for ascii/hAnsi (Latin) slot; untouched if None.
    thai_size / latin_size : Pt(...) or int half-points; set szCs / sz.
    bold / italic : bool | None  set both the Latin and cs flags together.
    """
    rpr = get_rpr(run._element)
    rf = rfonts(rpr)

    if thai_font is not None:
        set_attr(rf, "w:cs", thai_font)
    if latin_font is not None:
        set_attr(rf, "w:ascii", latin_font)
        set_attr(rf, "w:hAnsi", latin_font)

    hp_thai = _to_half_points(thai_size)
    if hp_thai is not None:
        set_attr(get_or_add(rpr, "w:szCs"), "w:val", hp_thai)
    hp_latin = _to_half_points(latin_size)
    if hp_latin is not None:
        set_attr(get_or_add(rpr, "w:sz"), "w:val", hp_latin)

    if bold is not None:
        _set_bool(rpr, "w:b", bold)
        _set_bool(rpr, "w:bCs", bold)
    if italic is not None:
        _set_bool(rpr, "w:i", italic)
        _set_bool(rpr, "w:iCs", italic)

    return run


def _set_bool(rpr, tag, value):
    el = get_or_add(rpr, tag)
    set_attr(el, "w:val", "1" if value else "0")

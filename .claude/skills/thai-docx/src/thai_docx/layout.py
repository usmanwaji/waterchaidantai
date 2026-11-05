"""Paragraph/page layout fixes for Thai documents.

* ``fix_line_spacing`` — rewrite **Exactly** line spacing to **At least** so
  tall Thai stacks (upper vowel + tone mark) are never clipped, while leaving
  proportional (1.5x/2x) spacing the user chose on purpose untouched.
* ``apply_thai_gov_layout`` — A4 page, standard Thai-government margins, and
  TH Sarabun New at 16pt on the Normal style. (Crest/letterhead is left as a
  TODO — see SKILL.md — because it needs an image asset.)
"""
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, Length

from ._xml import get_or_add, set_attr, rfonts  # noqa: F401 (get_or_add used for rPr)
from .enforce import DEFAULT_THAI_FONT


def _half_points(size):
    if isinstance(size, Length):
        return int(round(size.pt * 2))
    return int(size)


def fix_line_spacing(doc, min_pt=Pt(0)):
    """Convert clipping 'exact' line spacing to 'atLeast' (tone-mark safe).

    Clipping of Thai upper vowels / tone marks comes **only** from lineRule
    ``'exact'`` (a fixed line height Word will not grow). So we rewrite:

      * ``'exact'``      -> ``'atLeast'`` (keeps the height as a floor, but lets
                            a tall Thai stack grow instead of being cropped).
      * no spacing set   -> ``'atLeast'`` at ``min_pt`` (only when ``min_pt`` > 0).

    Proportional spacing (lineRule ``'auto'`` — e.g. the user's intentional 1.5x
    line spacing) is **left untouched**: it already grows with line height and
    never clips, so overriding it to a fixed ``atLeast`` would silently break
    the user's chosen layout. ``'atLeast'`` paragraphs are likewise kept (and
    only raised to ``min_pt`` if a floor is requested).

    ``min_pt`` is the floor height (in Pt) applied when we do set ``atLeast`` —
    if a paragraph already requests a larger line, that larger value is kept.
    """
    # 'w:line' is measured in twentieths of a point.
    floor = int(round(min_pt.pt * 20)) if isinstance(min_pt, Length) else int(min_pt) * 20
    for para in doc.paragraphs:
        _set_at_least(para._p, floor)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    _set_at_least(para._p, floor)
    return doc


def _set_at_least(p_el, floor_twentieths):
    pPr = p_el.get_or_add_pPr()
    spacing = pPr.find(qn("w:spacing"))
    rule = spacing.get(qn("w:lineRule")) if spacing is not None else None

    # Leave proportional spacing ('auto', the user's deliberate 1.5x/2x line
    # spacing) alone — it grows with the line and never clips Thai stacks.
    if rule == "auto":
        return

    # Only 'exact' clips. 'atLeast' is already safe. A paragraph with no
    # spacing inherits the style's rule (often proportional) — only impose a
    # floor when the caller explicitly asked for one.
    if rule != "exact" and floor_twentieths == 0:
        return

    if spacing is None:
        # CT_PPr.get_or_add_spacing() inserts <w:spacing> at the schema-correct
        # position (after pStyle/numPr, before ind). The generic _xml.get_or_add
        # only knows CT_RPr ordering and would mis-place it inside a styled /
        # numbered / indented pPr, making Word flag the file as unreadable.
        spacing = pPr.get_or_add_spacing()
    current = spacing.get(qn("w:line"))
    if current:
        line_val = max(int(current), floor_twentieths) if floor_twentieths else int(current)
    else:
        line_val = floor_twentieths
    if line_val:
        set_attr(spacing, "w:line", str(line_val))
    set_attr(spacing, "w:lineRule", "atLeast")


# Note: <w:spacing> is created via CT_PPr.get_or_add_spacing() (above), which
# places it in the OOXML-mandated CT_PPr order (pStyle … numPr … spacing … ind).
# We must NOT route pPr children through _xml.get_or_add — that helper only knows
# the CT_RPr ordering and would corrupt a styled/numbered/indented paragraph.


def apply_thai_gov_layout(
    doc,
    *,
    thai_font=DEFAULT_THAI_FONT,
    size_pt=16,
    top_mm=25,
    bottom_mm=20,
    left_mm=30,
    right_mm=20,
):
    """Apply A4 page + standard Thai-government margins + TH Sarabun 16pt.

    Margins follow the common ระเบียบสารบรรณ convention (ขอบบน 2.5 ซม.,
    ขอบล่าง 2 ซม., ขอบซ้าย 3 ซม., ขอบขวา 2 ซม.). Adjust per your office.

    TODO (scaffold): national crest (ครุฑ) / letterhead image and the precise
    block layout of หนังสือราชการ are NOT applied — they require an image asset
    and a chosen document class (บันทึกข้อความ vs หนังสือภายนอก).
    """
    for section in doc.sections:
        section.page_width = Mm(210)
        section.page_height = Mm(297)
        section.top_margin = Mm(top_mm)
        section.bottom_margin = Mm(bottom_mm)
        section.left_margin = Mm(left_mm)
        section.right_margin = Mm(right_mm)

    # Normal style -> TH Sarabun New at the requested size (both slots)
    normal = doc.styles["Normal"]
    rpr = normal.element.get_or_add_rPr()
    rf = rfonts(rpr)
    set_attr(rf, "w:ascii", thai_font)
    set_attr(rf, "w:hAnsi", thai_font)
    set_attr(rf, "w:cs", thai_font)
    hp = str(_half_points(Pt(size_pt)))
    set_attr(get_or_add(rpr, "w:sz"), "w:val", hp)
    set_attr(get_or_add(rpr, "w:szCs"), "w:val", hp)
    return doc

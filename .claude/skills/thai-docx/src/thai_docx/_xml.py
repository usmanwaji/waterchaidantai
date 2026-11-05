"""Low-level OOXML helpers for the Thai complex-script fix.

Word picks a font per *script slot* on every run:
  * ascii / hAnsi  -> Latin text
  * eastAsia       -> CJK
  * cs (complex)   -> Thai, Arabic, Hebrew, Devanagari, ...

python-docx only ever sets ``w:rFonts w:ascii``/``w:hAnsi`` and ``w:sz``.
For Thai you must also fill the *cs* siblings: ``w:rFonts w:cs``, ``w:szCs``,
``w:bCs``, ``w:iCs`` and ``w:lang w:bidi``. These helpers create/read those
elements in the OOXML-mandated child order without clobbering anything else.
"""
from docx.oxml.ns import qn

# rPr child order per the OOXML schema (CT_RPr). We only need the subset that
# the enforcer touches, but order matters or Word rejects the file.
_RPR_ORDER = [
    "w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs",
    "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline",
    "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid",
    "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern",
    "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect",
    "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs",
    "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath",
]
_ORDER_INDEX = {name: i for i, name in enumerate(_RPR_ORDER)}


def _insert_in_order(rpr, child):
    """Insert ``child`` into ``rpr`` respecting CT_RPr element order."""
    tag = child.tag
    # derive 'w:xxx' key from the fully-qualified tag
    local = tag.split("}", 1)[1]
    key = "w:" + local
    my_idx = _ORDER_INDEX.get(key, len(_RPR_ORDER))
    for existing in rpr:
        ex_local = existing.tag.split("}", 1)[1]
        ex_idx = _ORDER_INDEX.get("w:" + ex_local, len(_RPR_ORDER))
        if ex_idx > my_idx:
            existing.addprevious(child)
            return
    rpr.append(child)


def get_or_add(rpr, tag):
    """Return existing child ``tag`` (e.g. 'w:szCs') or create it in order."""
    el = rpr.find(qn(tag))
    if el is None:
        el = rpr.makeelement(qn(tag), {})
        _insert_in_order(rpr, el)
    return el


def get_rpr(element):
    """Return the run/style rPr, creating it if needed (for run elements)."""
    if hasattr(element, "get_or_add_rPr"):
        return element.get_or_add_rPr()
    rpr = element.find(qn("w:rPr"))
    if rpr is None:
        rpr = element.makeelement(qn("w:rPr"), {})
        element.insert(0, rpr)
    return rpr


def rfonts(rpr):
    return get_or_add(rpr, "w:rFonts")


def set_attr(el, attr, value):
    el.set(qn(attr), value)


def get_attr(el, attr):
    return el.get(qn(attr))

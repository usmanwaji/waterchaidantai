"""embed_fonts: embed TrueType fonts into a .docx so it renders the same anywhere.

Why: even with the correct ``w:cs`` font name, a machine without *TH Sarabun
New* installed will substitute another face and Thai may break again. Embedding
the font travels the rendering with the file.

How (OOXML font embedding):
  * ``settings.xml`` gets ``<w:embedTrueTypeFonts/>``.
  * ``fontTable.xml`` gets a ``<w:font>`` entry per family with
    ``<w:embedRegular>``/``<w:embedBold>``/… r:id relationships.
  * The TTF bytes are stored **obfuscated**: Word XORs the first 32 bytes with
    a per-font 16-byte GUID (we generate one with ``uuid.uuid4()`` and record
    it in the ``w:fontKey`` attribute) applied twice.

⚠️ Licensing: only embed fonts whose license permits embedding/redistribution.
TH Sarabun New (SIPA / National Font project) is freely redistributable, but
you are responsible for verifying the license of any font you pass in.

If no font files are supplied, this function warns and is a no-op — it never
hardcodes a font path.
"""
import os
import uuid
import warnings

from lxml import etree

from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.oxml.ns import qn

_FONT_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.obfuscatedFont"
_FONT_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"
)


def _obfuscate(data, guid):
    """Apply Word's font obfuscation: XOR first 32 bytes with the GUID twice."""
    key = _guid_to_key(guid)
    out = bytearray(data)
    for i in range(min(32, len(out))):
        out[i] ^= key[i % 16]
    return bytes(out)


def _guid_to_key(guid):
    """Turn a GUID string into the 16-byte XOR key Word expects."""
    hexstr = guid.replace("urn:uuid:", "").replace("{", "").replace("}", "").replace("-", "")
    raw = bytes.fromhex(hexstr)
    # Word reads the GUID right-to-left for the key.
    return raw[::-1]


def embed_fonts(doc, font_paths):
    """Embed the given TrueType fonts into ``doc``.

    Parameters
    ----------
    font_paths : dict
        ``{family_name: path}`` for regular only, or
        ``{family_name: {"regular": p, "bold": p, "italic": p, "boldItalic": p}}``.

    Returns the number of font *families* embedded.
    """
    if not font_paths:
        warnings.warn(
            "embed_fonts: no font files supplied; skipping embed (fonts will "
            "rely on the target machine having them installed).",
            RuntimeWarning,
        )
        return 0

    # 1) settings.xml -> <w:embedTrueTypeFonts/>
    _enable_embedding(doc)

    # 2) ensure a fontTable part exists, then add entries
    font_table_part, font_table_el = _get_font_table(doc)

    count = 0
    for family, spec in font_paths.items():
        slots = spec if isinstance(spec, dict) else {"regular": spec}
        _embed_family(font_table_part, font_table_el, family, slots)
        count += 1

    # fontTable is a generic Part (no live element); persist our edits to its blob.
    font_table_part._blob = etree.tostring(
        font_table_el, xml_declaration=True, encoding="UTF-8", standalone=True
    )
    return count


def _enable_embedding(doc):
    settings_el = doc.settings.element
    if settings_el.find(qn("w:embedTrueTypeFonts")) is None:
        el = settings_el.makeelement(qn("w:embedTrueTypeFonts"), {})
        settings_el.insert(0, el)


def _get_font_table(doc):
    """Return (fontTable_part, parsed_root_element).

    python-docx exposes fontTable as a generic Part with a ``blob``, not a live
    XML element, so we parse the blob here and write it back after editing.
    """
    main = doc.part
    for rel in main.rels.values():
        if rel.reltype == RT.FONT_TABLE and not rel.is_external:
            part = rel.target_part
            el = parse_xml(part.blob)
            return part, el
    raise RuntimeError("document has no fontTable part")


def _embed_family(font_table_part, font_table_el, family, slots):
    # find or create the <w:font w:name="family"> element
    font_el = None
    for fe in font_table_el.findall(qn("w:font")):
        if fe.get(qn("w:name")) == family:
            font_el = fe
            break
    if font_el is None:
        font_el = font_table_el.makeelement(qn("w:font"), {qn("w:name"): family})
        font_table_el.append(font_el)

    tag_for = {
        "regular": "w:embedRegular",
        "bold": "w:embedBold",
        "italic": "w:embedItalic",
        "boldItalic": "w:embedBoldItalic",
    }
    for slot, path in slots.items():
        tag = tag_for.get(slot)
        if tag is None or not path or not os.path.exists(path):
            if path and not os.path.exists(path):
                warnings.warn(f"embed_fonts: missing font file {path!r}; skipped", RuntimeWarning)
            continue
        rid, guid = _add_obfuscated_font_part(font_table_part, path)
        embed_el = font_el.makeelement(qn(tag), {})
        embed_el.set(qn("r:id"), rid)
        # fontKey GUID attribute (the same GUID used to obfuscate)
        embed_el.set(qn("w:fontKey"), guid)
        font_el.append(embed_el)


def _add_obfuscated_font_part(font_table_part, ttf_path):
    """Add one obfuscated font part and return ``(rid, guid)``.

    The GUID is returned (rather than stashed in a module global) so the caller
    pairs the matching ``w:fontKey`` with the right embed element — safe even if
    embedding is ever parallelised.
    """
    package = font_table_part.package
    guid = "{%s}" % str(uuid.uuid4()).upper()

    with open(ttf_path, "rb") as fh:
        data = fh.read()
    blob = _obfuscate(data, guid)

    idx = _next_font_index(package)
    partname = PackURI(f"/word/fonts/font{idx}.odttf")
    part = Part(partname, _FONT_CONTENT_TYPE, blob, package)
    # Relating from fontTable makes the part reachable from the package root, so
    # the writer serializes it and registers its content type automatically.
    rid = font_table_part.relate_to(part, _FONT_REL_TYPE)
    return rid, guid


def _next_font_index(package):
    existing = [p.partname for p in package.iter_parts()
                if str(p.partname).startswith("/word/fonts/font")]
    return len(existing) + 1

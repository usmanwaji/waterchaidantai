"""Iterate over *every* run element in a document, across all parts.

Word stores runs (``w:r``) not only in ``document.xml`` body but also inside
tables, headers/footers, footnotes/endnotes, text boxes (``w:txbxContent``)
and even numbering definitions. A Thai fix that only walks ``doc.paragraphs``
silently misses half of them — so we walk the raw XML of every relevant part.

Footnotes/endnotes are special: python-docx maps ``footnotes.xml`` and
``endnotes.xml`` to a *generic* ``Part`` that exposes only ``.blob`` (raw
bytes), not a live ``.element`` tree. Iterating ``getattr(part, "element")``
therefore silently skips them, so Thai runs inside footnotes never get their
``w:cs`` slot — a real bug for legal documents where footnotes carry citations.

We handle that here: :func:`blob_part_roots` parses those blobs with lxml so
the **scanner** can read their runs, and :func:`flush_blob_part` writes a
mutated tree back to ``part._blob`` (same pattern ``fonts.py`` uses for the
fontTable) so **enforce_thai** persists its edits into the saved file.
"""
from docx.oxml.ns import qn
from lxml import etree

_R = qn("w:r")

# Generic (blob-only) parts whose runs we must still fix. Footnotes/endnotes
# are the load-bearing case; the rest already arrive as live-element parts.
_BLOB_PART_KEYS = ("footnotes", "endnotes")


def _iter_part_elements(doc):
    """Yield the root XML element of every live-element part whose runs we fix.

    Blob-only parts (footnotes/endnotes) are intentionally NOT yielded here —
    see :func:`blob_part_roots`, which parses their bytes separately so callers
    can choose to write the result back.
    """
    main = doc.part
    yield main.element  # document.xml

    seen = set()
    yield_parts = []

    def add(part):
        if part is None:
            return
        pid = id(part)
        if pid in seen:
            return
        seen.add(pid)
        el = getattr(part, "element", None)
        if el is not None:
            yield_parts.append(el)

    # headers / footers
    for section in doc.sections:
        for hf in (
            section.header, section.first_page_header, section.even_page_header,
            section.footer, section.first_page_footer, section.even_page_footer,
        ):
            try:
                add(hf.part)
            except Exception:
                pass

    # related live-element parts: numbering, comments (footnotes/endnotes are
    # blob-only and handled by blob_part_roots).
    try:
        rels = main.rels
    except Exception:
        rels = {}
    for rel in list(rels.values()):
        if rel.is_external:
            continue
        target = rel.target_part
        partname = str(getattr(target, "partname", ""))
        if any(k in partname for k in ("numbering", "comments")):
            el = getattr(target, "element", None)
            if el is not None and id(el) not in {id(e) for e in yield_parts}:
                yield_parts.append(el)

    for el in yield_parts:
        yield el


def blob_part_roots(doc):
    """Yield ``(part, parsed_root)`` for footnotes/endnotes blob-only parts.

    python-docx hands these back as a generic ``Part`` (no ``.element``), so we
    parse ``part.blob`` into a fresh lxml tree. Mutating that tree does NOT
    persist on its own — call :func:`flush_blob_part` afterwards to write the
    bytes back into ``part._blob``.
    """
    main = doc.part
    try:
        rels = main.rels
    except Exception:
        return
    seen = set()
    for rel in list(rels.values()):
        if rel.is_external:
            continue
        target = rel.target_part
        partname = str(getattr(target, "partname", ""))
        if not any(k in partname for k in _BLOB_PART_KEYS):
            continue
        # only generic blob parts (a live-element part is already covered)
        if getattr(target, "element", None) is not None:
            continue
        pid = id(target)
        if pid in seen:
            continue
        seen.add(pid)
        try:
            root = etree.fromstring(target.blob)
        except Exception:
            continue
        yield target, root


def flush_blob_part(part, root):
    """Serialize ``root`` back into ``part._blob`` (persists on ``doc.save``)."""
    part._blob = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True
    )


def iter_runs(doc):
    """Yield every ``w:r`` element in the document, across all parts.

    Text-box runs live inside ``w:txbxContent`` within the body/header XML, so
    a recursive ``iter`` over each part's root naturally includes them.

    Footnotes/endnotes runs come from blobs parsed on the fly: yielding them
    lets the read-only scanner inspect them. Code that **mutates** these runs
    must instead use :func:`blob_part_roots` + :func:`flush_blob_part` so the
    edits are written back to the package (see ``enforce_thai``).
    """
    seen_roots = []
    for root in _iter_part_elements(doc):
        if any(root is r for r in seen_roots):
            continue
        seen_roots.append(root)
        for r in root.iter(_R):
            yield r

    for _part, root in blob_part_roots(doc):
        for r in root.iter(_R):
            yield r

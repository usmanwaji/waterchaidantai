"""fill_template: replace {{key}} placeholders while preserving run formatting.

A naive ``run.text = run.text.replace(...)`` works only when a placeholder sits
inside a single run. Word frequently splits ``{{name}}`` across several runs.
This merges the runs of each paragraph (keeping the first run's rPr, which is
where the Thai cs font lives) before substituting, so the filled text keeps the
intended Thai font/size.
"""
import re

from docx.oxml.ns import qn

_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def fill_template(doc, mapping, *, missing="keep"):
    """Replace ``{{key}}`` in every paragraph with ``mapping[key]``.

    Parameters
    ----------
    mapping : dict[str, str]   placeholder -> replacement.
    missing : 'keep' | 'blank' what to do with unknown keys ('keep' leaves the
                               literal ``{{key}}``, 'blank' deletes it).
    """
    def replace(match):
        key = match.group(1)
        if key in mapping:
            return str(mapping[key])
        return "" if missing == "blank" else match.group(0)

    for para in _iter_all_paragraphs(doc):
        _fill_paragraph(para, replace)
    return doc


def _fill_paragraph(para, replace):
    runs = para.runs
    if not runs:
        return
    full = "".join(r.text for r in runs)
    if "{{" not in full:
        return
    new_text = _PLACEHOLDER.sub(replace, full)
    if new_text == full:
        return
    # Put all text in the first run (preserves its rPr / Thai cs font), clear rest.
    runs[0].text = new_text
    for r in runs[1:]:
        r.text = ""


def _iter_all_paragraphs(doc):
    for p in doc.paragraphs:
        yield p
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    yield p
    for section in doc.sections:
        for hf in (section.header, section.footer):
            for p in hf.paragraphs:
                yield p

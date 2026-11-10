"""verify_thai_docx — CLI scanner that flags runs missing complex-script props.

Walks every run in every part (body, tables, headers/footers, footnotes,
endnotes, text boxes, numbering) and reports any run whose text contains Thai
characters but lacks a ``w:cs`` font, ``w:szCs`` (when it has a Latin ``w:sz``),
or a ``w:lang w:bidi`` setting.

Exit code 0 = clean. Non-zero = at least one problem (CI gate friendly).
Accepts a single .docx or a folder (scanned recursively).
"""
import os
import re
import sys
from dataclasses import dataclass

from docx import Document
from docx.oxml.ns import qn

from ._runs import iter_runs

_THAI = re.compile(r"[฀-๿]")


@dataclass
class Problem:
    file: str
    run_index: int
    text: str
    reason: str


def _run_text(r):
    return "".join(t.text or "" for t in r.findall(qn("w:t")))


def scan_docx(path):
    """Return a list of Problem for one .docx file."""
    doc = Document(path)
    problems = []
    for idx, r in enumerate(iter_runs(doc)):
        text = _run_text(r)
        if not text or not _THAI.search(text):
            continue
        rpr = r.find(qn("w:rPr"))
        reasons = []
        rfonts = rpr.find(qn("w:rFonts")) if rpr is not None else None
        if rfonts is None or not rfonts.get(qn("w:cs")):
            reasons.append("missing w:rFonts w:cs (Thai font slot)")
        # szCs only required when the run pins a Latin size. We flag a MISSING
        # complex size, not a *different* one: set_thai_run deliberately allows
        # szCs != sz (a distinct Thai size), so an unequal value is valid, not
        # broken. Only "has w:sz but no w:szCs at all" leaves Thai unsized.
        sz = rpr.find(qn("w:sz")) if rpr is not None else None
        if sz is not None:
            szcs = rpr.find(qn("w:szCs")) if rpr is not None else None
            if szcs is None:
                reasons.append("w:sz without any w:szCs (Thai size unset)")
        lang = rpr.find(qn("w:lang")) if rpr is not None else None
        if lang is None or not lang.get(qn("w:bidi")):
            reasons.append("missing w:lang w:bidi")
        if reasons:
            snippet = text[:30].replace("\n", " ")
            problems.append(
                Problem(path, idx, snippet, "; ".join(reasons))
            )
    return problems


def _iter_docx(target):
    if os.path.isdir(target):
        for root, _dirs, files in os.walk(target):
            for f in files:
                if f.lower().endswith(".docx") and not f.startswith("~$"):
                    yield os.path.join(root, f)
    else:
        yield target


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print("usage: verify-thai-docx <file.docx | folder> [...]", file=sys.stderr)
        return 2

    total = 0
    files_scanned = 0
    for target in argv:
        for path in _iter_docx(target):
            files_scanned += 1
            try:
                problems = scan_docx(path)
            except Exception as exc:  # pragma: no cover
                print(f"ERROR  {path}: {exc}", file=sys.stderr)
                total += 1
                continue
            if problems:
                print(f"FAIL   {path}  ({len(problems)} run(s) need fixing)")
                for p in problems:
                    print(f"   run#{p.run_index}  {p.reason}\n        text: {p.text!r}")
                total += len(problems)
            else:
                print(f"OK     {path}")

    if files_scanned == 0:
        print("no .docx files found", file=sys.stderr)
        return 2
    if total:
        print(f"\n{total} problem(s) across scanned files.")
        return 1
    print(f"\nAll {files_scanned} file(s) clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

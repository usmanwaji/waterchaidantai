---
name: thai-docx
description: Use when generating or fixing Thai-language .docx files where Thai text renders wrong in Microsoft Word — floating/misplaced tone marks (วรรณยุกต์ลอย), shrunken Thai font, bold or italic not applying to Thai, wrong font fallback, or clipped tone marks/vowels. Also for cleaning Thai text copied from PDFs/web/LINE before putting it in a document.
---

# thai-docx

## Overview

**Core principle:** Microsoft Word resolves a font for each run *per script
slot* — `ascii`/`hAnsi` for Latin, `eastAsia` for CJK, and **`cs` (complex
script)** for Thai/Arabic/Hebrew. python-docx only ever writes the Latin slot
(`w:rFonts w:ascii`/`w:hAnsi`) and `w:sz`. So in Word, Thai text:

- falls back to a default face (wrong font / shrunken size),
- floats its tone marks and vowels (วรรณยุกต์ลอย),
- ignores **bold/italic**, because Word reads `w:bCs`/`w:iCs` for complex
  scripts, not `w:b`/`w:i`.

The fix is to fill the complex-script siblings on **every run**, plus at the
**style** and **docDefaults (`w:rPrDefault`)** levels so runs that inherit their
size don't shrink: `w:rFonts w:cs`, `w:szCs`, `w:bCs`, `w:iCs`,
`w:lang w:bidi="th-TH"`.

> ⚠️ Do **not** trust a LibreOffice or web preview — LibreOffice applies its own
> Thai shaping and will look fine even when the file is broken for real Word.
> Always verify in Microsoft Word, or with the bundled `verify-thai-docx`
> scanner which inspects the raw OOXML.

## When to Use

- Thai tone marks float above the wrong spot or detach (วรรณยุกต์ลอย, tone marks).
- Thai font is much smaller than the Latin text in the same line (shrunken Thai).
- **Bold not working** / italic not applying to Thai while it works on English.
- Wrong Thai font even though you set `run.font.name`.
- A client's existing .docx renders Thai wrong and you need to repair it.
- Thai text copied from a PDF/web/LINE has invisible junk, reversed tone/vowel
  order, or fake spaces between every character.

## Quick Reference

| API | Purpose |
|---|---|
| `enforce_thai(doc, *, force=False, thai_font, thai_digits=False, insert_breaks=False)` | Fill `w:cs`/`w:szCs`/`w:bCs`/`w:iCs`/`w:lang w:bidi` on every run + style + docDefaults. Idempotent. **Call once before save.** |
| `set_thai_run(run, thai_font, latin_font=None, thai_size=None, latin_size=None, bold=None, italic=None)` | Split font/size between the Thai (`cs`) and Latin (`ascii`/`hAnsi`) slots in one run. |
| `enforce_thai_file(in_path, out_path, ...)` | Open any existing .docx and enforce Thai, write a copy. |
| `clean_pdf_thai(text)` | NFC + strip zero-width/soft-hyphen + reorder tone/vowel + drop fake Thai spaces. Keeps English/numbers/URLs. |
| `to_thai_digits(text)` | `0-9` → `๐-๙`. |
| `insert_thai_breaks(doc)` | Insert U+200B at Thai word boundaries (needs `pythainlp`; skips numbers/English/URL). |
| `fix_line_spacing(doc, min_pt=Pt(...))` | Switch line rule to **At least** so tall Thai stacks aren't clipped. |
| `apply_thai_gov_layout(doc)` | A4 + ระเบียบสารบรรณ margins + TH Sarabun New 16pt on Normal. |
| `fill_template(doc, mapping)` | Replace `{{key}}` placeholders, preserving the Thai font of the run. |
| `embed_fonts(doc, {family: path})` | Embed (obfuscated) TrueType fonts so the file renders the same on machines without TH Sarabun. |
| `verify-thai-docx <file|folder>` (CLI) | Scan every run across all parts; exit ≠ 0 if any Thai run lacks `cs`/`szCs`/`bidi`. CI gate. |

## Implementation

The 90% case is one line before `save`:

```python
from docx import Document
from thai_docx import enforce_thai

doc = Document()
doc.add_paragraph("สวัสดีครับ ราคา 500 บาท")
enforce_thai(doc)            # <-- fixes cs font / szCs / bCs / iCs / bidi
doc.save("out.docx")
```

Mixed Thai + Latin with different fonts/sizes in one run:

```python
from docx.shared import Pt
from thai_docx import set_thai_run

run = p.add_run("Invoice ใบแจ้งหนี้")
set_thai_run(run, thai_font="TH Sarabun New", latin_font="Calibri",
             thai_size=Pt(16), latin_size=Pt(11), bold=True)
```

Repair an existing file, then prove it:

```python
from thai_docx import enforce_thai_file
enforce_thai_file("client.docx", "client_fixed.docx")
# verify-thai-docx client_fixed.docx   -> exit 0 means clean
```

## Common Mistakes

- **Trusting the preview.** LibreOffice and web/Google viewers shape Thai
  themselves and hide the bug — verify in real Word or with `verify-thai-docx`.
- **Setting only `run.font.name`.** That sets the Latin slot; Thai still falls
  back. You need the `cs` slot (`enforce_thai`/`set_thai_run`).
- **Forcing `szCs` onto inheriting runs.** A heading inherits its size from the
  style; injecting a hard `szCs` shrinks it. `enforce_thai` only mirrors a size
  the run *explicitly* sets, and relies on docDefaults for inherited runs.
- **Using line rule "Exactly".** Clips Thai tone marks. Use `fix_line_spacing`
  (At least).
- **Assuming embedding is automatic.** Without `embed_fonts`, a machine lacking
  TH Sarabun New will still substitute a face. Check the font license first.

## Status of features

- **Full + tested:** `enforce_thai`, `set_thai_run`, `clean_pdf_thai`,
  `to_thai_digits`, `insert_thai_breaks`, `verify-thai-docx`, `embed_fonts`,
  `enforce_thai_file`, `fix_line_spacing`, `apply_thai_gov_layout` (page/margins/
  font), `fill_template`, full run coverage (tables, header/footer, footnotes,
  endnotes, text boxes, numbering).
- **Scaffold / TODO:** national crest (ครุฑ) & letterhead block in
  `apply_thai_gov_layout` (needs an image asset and a chosen document class);
  PDF-render verification (would need Word/LibreOffice headless — and
  LibreOffice "lies" about Thai, so it can't be the source of truth).

Keywords: w:cs, w:szCs, w:bCs, w:iCs, w:lang w:bidi, complex script, TH Sarabun
New, วรรณยุกต์ลอย, tone marks, bold not working, font fallback, OOXML, rFonts.

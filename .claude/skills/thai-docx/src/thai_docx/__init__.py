"""thai-docx — make Thai render correctly in Word (.docx) files.

Word picks a font per complex-script slot; python-docx only sets the Latin
slot. This package fills the complex-script properties (``w:cs``, ``w:szCs``,
``w:bCs``, ``w:iCs``, ``w:lang w:bidi``) so Thai stops floating/shrinking and
bold/italic apply — plus text cleanup, word-break, font embedding and a CLI
scanner.

Typical use::

    from docx import Document
    from thai_docx import enforce_thai

    doc = Document()
    doc.add_paragraph("สวัสดีครับ")
    enforce_thai(doc)          # one line before save
    doc.save("out.docx")
"""
from .enforce import enforce_thai, DEFAULT_THAI_FONT
from .run_format import set_thai_run
from .text import clean_pdf_thai, to_thai_digits
from .breaks import insert_thai_breaks, insert_thai_breaks_text
from .file_ops import enforce_thai_file
from .layout import fix_line_spacing, apply_thai_gov_layout
from .template import fill_template
from .fonts import embed_fonts

__version__ = "0.1.0"

__all__ = [
    "enforce_thai",
    "enforce_thai_file",
    "set_thai_run",
    "clean_pdf_thai",
    "to_thai_digits",
    "insert_thai_breaks",
    "insert_thai_breaks_text",
    "fix_line_spacing",
    "apply_thai_gov_layout",
    "fill_template",
    "embed_fonts",
    "DEFAULT_THAI_FONT",
]

"""
Build PRD.pdf from PRD.md and append the 20 sample invoice PDFs at the end.

- Custom lightweight Markdown -> reportlab renderer.
  Handles: headings h1-h4, paragraphs, bullet lists, numbered lists,
  fenced code blocks (```), inline code (`code`), bold (**bold**),
  italics (*italic*), horizontal rules (---), and tables (github-flavour).
- After the PRD body pages, appends INV-0001.pdf through INV-0020.pdf verbatim.

Output: D:\\codezzz\\Claude\\invoice-management-case-study\\PRD.pdf
"""

from __future__ import annotations
import re
from pathlib import Path
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Preformatted, Table, TableStyle, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfWriter, PdfReader

ROOT = Path(r"D:\codezzz\Claude\invoice-management-case-study")
MD_PATH = ROOT / "PRD.md"
BODY_PDF = ROOT / "PRD_body.pdf"
FINAL_PDF = ROOT / "PRD.pdf"
INV_DIR = ROOT / "sample-invoices"


# ---------- Styles ----------

styles = getSampleStyleSheet()

BASE = "Helvetica"
BOLD = "Helvetica-Bold"
ITAL = "Helvetica-Oblique"
MONO = "Courier"
MONO_BOLD = "Courier-Bold"

# Override / add
def _add(name, **kwargs):
    if name in styles.byName:
        # override existing
        for k, v in kwargs.items():
            setattr(styles[name], k, v)
    else:
        styles.add(ParagraphStyle(name=name, **kwargs))

_add("H1", parent=styles["Heading1"], fontName=BOLD, fontSize=20, leading=24, spaceAfter=10, spaceBefore=18, textColor=colors.HexColor("#111827"))
_add("H2", parent=styles["Heading2"], fontName=BOLD, fontSize=16, leading=20, spaceAfter=8, spaceBefore=14, textColor=colors.HexColor("#111827"))
_add("H3", parent=styles["Heading3"], fontName=BOLD, fontSize=13, leading=16, spaceAfter=6, spaceBefore=10, textColor=colors.HexColor("#111827"))
_add("H4", parent=styles["Heading4"], fontName=BOLD, fontSize=11, leading=14, spaceAfter=4, spaceBefore=8, textColor=colors.HexColor("#111827"))
_add("Body", parent=styles["BodyText"], fontName=BASE, fontSize=9.5, leading=13, spaceAfter=6)
_add("MdBullet", parent=styles["BodyText"], fontName=BASE, fontSize=9.5, leading=13, leftIndent=14, bulletIndent=2, spaceAfter=2)
_add("MdNumbered", parent=styles["BodyText"], fontName=BASE, fontSize=9.5, leading=13, leftIndent=18, bulletIndent=2, spaceAfter=2)
_add("MdCode", parent=styles["Code"], fontName=MONO, fontSize=7.4, leading=9, leftIndent=6, rightIndent=6, spaceAfter=8, spaceBefore=4, backColor=colors.HexColor("#f4f4f5"), borderPadding=4)
_add("TableCell", parent=styles["BodyText"], fontName=BASE, fontSize=8.2, leading=10)
_add("TableCellBold", parent=styles["BodyText"], fontName=BOLD, fontSize=8.2, leading=10)
_add("MdBlockquote", parent=styles["BodyText"], fontName=ITAL, fontSize=9.5, leading=13, leftIndent=16, rightIndent=16, spaceAfter=6, textColor=colors.HexColor("#374151"))


# ---------- Inline formatting ----------

def inline(text: str) -> str:
    # escape reportlab-sensitive chars
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # code
    text = re.sub(r"`([^`]+)`", r'<font name="Courier" size="8.5">\1</font>', text)
    # bold **x**
    text = re.sub(r"\*\*([^\*]+)\*\*", r"<b>\1</b>", text)
    # italic *x* (avoid matching within words; simple heuristic: bounded by space or start)
    text = re.sub(r"(?<![\*\w])\*([^\*\n]+)\*(?!\w)", r"<i>\1</i>", text)
    return text


# ---------- Table parsing ----------

def parse_table(lines: list[str], i: int) -> tuple[list[list[str]], int]:
    # returns rows, new_index
    rows = []
    while i < len(lines) and lines[i].lstrip().startswith("|"):
        rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
        i += 1
    # rows[1] is the separator "|---|---|"; drop it
    if len(rows) >= 2 and all(re.match(r"^:?-+:?$", c.replace(" ", "")) for c in rows[1]):
        header = rows[0]
        body = rows[2:]
    else:
        header, body = rows[0], rows[1:]
    return [header] + body, i


def render_table(rows: list[list[str]]) -> Table:
    styled_rows = []
    for r_idx, row in enumerate(rows):
        cells = []
        for c in row:
            style = styles["TableCellBold"] if r_idx == 0 else styles["TableCell"]
            cells.append(Paragraph(inline(c), style))
        styled_rows.append(cells)
    # column widths: auto by content, capped to page width
    n_cols = max(len(r) for r in rows)
    total_w = 175*mm
    col_w = total_w / n_cols
    t = Table(styled_rows, colWidths=[col_w]*n_cols, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#f3f4f6")),
        ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#9ca3af")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING", (0,0), (-1,-1), 4),
        ("TOPPADDING", (0,0), (-1,-1), 3),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ]))
    return t


# ---------- Main MD parser (line-driven) ----------

def render(md_text: str):
    flow = []
    lines = md_text.split("\n")
    i = 0
    in_code = False
    code_buf: list[str] = []
    while i < len(lines):
        line = lines[i]

        # fenced code block
        if line.lstrip().startswith("```"):
            if not in_code:
                in_code = True
                code_buf = []
            else:
                in_code = False
                block = "\n".join(code_buf)
                # keep block on one page if possible, else let it break
                pre = Preformatted(block, styles["MdCode"])
                flow.append(pre)
                flow.append(Spacer(1, 4))
            i += 1
            continue
        if in_code:
            code_buf.append(line)
            i += 1
            continue

        # horizontal rule
        if re.match(r"^\s*-{3,}\s*$", line):
            flow.append(Spacer(1, 6))
            # a thin line via a 1-row table
            hr = Table([[""]], colWidths=[175*mm], rowHeights=[0.4])
            hr.setStyle(TableStyle([("LINEABOVE", (0,0), (-1,-1), 0.4, colors.HexColor("#9ca3af"))]))
            flow.append(hr)
            flow.append(Spacer(1, 6))
            i += 1
            continue

        # headings
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            text = m.group(2)
            key = {1:"H1", 2:"H2", 3:"H3", 4:"H4"}[level]
            flow.append(Paragraph(inline(text), styles[key]))
            i += 1
            continue

        # table
        if line.lstrip().startswith("|") and (i+1 < len(lines) and re.search(r"\|", lines[i+1])):
            rows, i = parse_table(lines, i)
            flow.append(render_table(rows))
            flow.append(Spacer(1, 6))
            continue

        # bullet list
        if re.match(r"^\s*[-*]\s+", line):
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                text = re.sub(r"^\s*[-*]\s+", "", lines[i])
                flow.append(Paragraph(inline(text), styles["MdBullet"], bulletText="\u2022"))
                i += 1
            continue

        # numbered list
        if re.match(r"^\s*\d+\.\s+", line):
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                m2 = re.match(r"^\s*(\d+)\.\s+(.*)$", lines[i])
                num, text = m2.group(1), m2.group(2)
                flow.append(Paragraph(inline(text), styles["MdNumbered"], bulletText=f"{num}."))
                i += 1
            continue

        # blockquote
        if line.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i][1:].lstrip())
                i += 1
            flow.append(Paragraph(inline(" ".join(buf)), styles["MdBlockquote"]))
            continue

        # blank
        if line.strip() == "":
            i += 1
            continue

        # paragraph (may span multiple lines until blank)
        buf = [line]
        i += 1
        while i < len(lines) and lines[i].strip() != "" and not re.match(r"^(#{1,4}\s|\||```|\s*[-*]\s|\s*\d+\.\s|>)", lines[i]) and not re.match(r"^\s*-{3,}\s*$", lines[i]):
            buf.append(lines[i])
            i += 1
        flow.append(Paragraph(inline(" ".join(buf)), styles["Body"]))

    return flow


def build_body_pdf(md_text: str, out_path: Path):
    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=18*mm, rightMargin=18*mm,
        topMargin=18*mm, bottomMargin=18*mm,
        title="Invoice Management Case Study PRD",
        author="Asmit Dash",
    )
    flow = render(md_text)
    doc.build(flow)


def merge_with_invoices(body_pdf: Path, invoice_dir: Path, final_pdf: Path):
    writer = PdfWriter()
    # body
    body_reader = PdfReader(str(body_pdf))
    for page in body_reader.pages:
        writer.add_page(page)
    # 20 invoices
    for n in range(1, 21):
        inv = invoice_dir / f"INV-{n:04d}.pdf"
        r = PdfReader(str(inv))
        for page in r.pages:
            writer.add_page(page)
    with open(final_pdf, "wb") as f:
        writer.write(f)


def main():
    md_text = MD_PATH.read_text(encoding="utf-8")
    build_body_pdf(md_text, BODY_PDF)
    print(f"[ok] body pages -> {BODY_PDF}")
    merge_with_invoices(BODY_PDF, INV_DIR, FINAL_PDF)
    print(f"[ok] merged final -> {FINAL_PDF}")


if __name__ == "__main__":
    main()

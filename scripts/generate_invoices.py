"""
Generate 20 varied sample invoice PDFs for the Zamp ASA case study.
Each PDF has a distinct layout template so the extraction pipeline
is exercised across realistic vendor formats.

Output: D:\\codezzz\\Claude\\zamp-asa\\sample-invoices\\INV-XXXX.pdf
Also writes po_master.xlsx with matching PO rows.
"""

from __future__ import annotations
import os
from decimal import Decimal, ROUND_HALF_UP
from datetime import date, timedelta
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle, Paragraph, SimpleDocTemplate, Spacer
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

OUT_DIR = Path(r"D:\codezzz\Claude\zamp-asa\sample-invoices")
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ---------- Data model for the 20 invoices ----------
# Each entry drives BOTH the PDF and the matching PO row.

INVOICES = [
    # (num, vendor, vendor_id, po_number, po_date, invoice_date, layout, line_items, tax_style, currency, po_ref_style)
    (1, "Bharat Auto Spares", "GST-27AABCB1234M1Z5", "PO-1001", date(2026, 7, 15), date(2026, 7, 22), "left", [("Brake pad set", 20, 450), ("Air filter", 10, 320), ("Oil seal", 15, 180)], "single", "INR", "PO#"),
    (2, "Kumar Traders", "PAN-AAAPK1234C",       "PO-1002", date(2026, 7, 10), date(2026, 7, 18), "right", [("Consulting hours - Q3", 40, 2500)], "embedded", "INR", "Purchase Order:"),
    (3, "Volkswagen Components India", "GST-06AAACV5566H1ZP", "PO-1003", date(2026, 7, 5), date(2026, 7, 20), "center", [("Wiring harness", 50, 890), ("Fuse box", 25, 1240), ("Sensor A", 30, 560), ("Sensor B", 20, 620), ("Clip assembly", 100, 45)], "single", "INR", "Ref:"),
    (4, "Deloitte Consulting Pvt Ltd", "GST-27AAACD5567G1Z8", "PO-1004", date(2026, 6, 28), date(2026, 7, 12), "twocol", [("AI advisory engagement", 1, 450000), ("Travel reimbursement", 1, 32000)], "none", "INR", "PO#"),
    (5, "Skyline Logistics", "VID-SL-9982", "PO-1005", date(2026, 6, 20), date(2026, 7, 8), "boxed", [("Freight - Mumbai to Delhi", 5, 8500), ("Insurance", 5, 950), ("Handling", 5, 400), ("Fuel surcharge", 5, 620), ("Documentation", 5, 200), ("Storage", 3, 1200), ("Loading", 5, 300), ("Unloading", 5, 300)], "embedded", "INR", "quoted"),
    (6, "GlobalTech Systems", "TAX-US-83-2044119", "PO-1006", date(2026, 6, 25), date(2026, 7, 15), "left", [(f"Enterprise license seat {i+1}", 1, 199) for i in range(12)], "single", "USD", "PO#"),
    (7, "Chennai Metal Works", "GST-33AAACC1122E1Z7", "PO-1007", date(2026, 7, 1), date(2026, 7, 14), "right", [("MS Rod 10mm", 200, 65), ("MS Rod 12mm", 150, 78), ("Welding rod pack", 40, 420)], "embedded", "INR", "Purchase Order:"),
    (8, "Prime Stationers", "GST-27AABCP7788K1ZM", "PO-1008", date(2026, 7, 20), date(2026, 7, 25), "center", [("Assorted office supplies (as per attachment)", 1, 18500)], "none", "INR", "Ref:"),
    (9, "Mahindra Suppliers Co", "VID-MSC-4471", "PO-1009", date(2026, 6, 15), date(2026, 7, 5), "twocol", [("Hydraulic pump", 4, 12500), ("Gasket kit", 40, 220), ("O-ring set", 50, 85), ("Bearing 6203", 30, 340), ("Grease tube", 20, 210)], "single", "INR", "PO#"),
    (10, "EuroParts GmbH", "VAT-DE-278-9944-11", "PO-1010", date(2026, 6, 30), date(2026, 7, 16), "boxed", [("Precision cog set", 25, 88.50), ("Torsion spring", 25, 12.20)], "embedded", "EUR", "Purchase Order:"),
    (11, "ABC Enterprises", "GST-27AABCA9988D1ZQ", "PO-1011", date(2026, 6, 22), date(2026, 7, 10), "left", [("Consumable - Item A", 100, 45), ("Consumable - Item B", 80, 55), ("Consumable - Item C", 60, 70), ("Consumable - Item D", 40, 90), ("Consumable - Item E", 30, 120), ("Cleaning agent 5L", 10, 380), ("Rags pack", 20, 60), ("Gloves box", 15, 240)], "single", "INR", "quoted"),
    (12, "Reliance Distributors", "GST-27AAACR0055F1Z2", "PO-1012", date(2026, 7, 2), date(2026, 7, 19), "right", [("Copper coil 50m", 8, 3400), ("PVC pipe 20mm x 10m", 25, 220), ("Fittings pack", 30, 145)], "none", "INR", "PO#"),
    (13, "HMT Machine Tools", "GST-29AAACH2211L1ZK", "PO-1013", date(2026, 6, 10), date(2026, 7, 3), "center", [(f"Tool bit type {chr(65+i)}", 5, 320+i*15) for i in range(12)], "embedded", "INR", "Ref:"),
    (14, "Hyderabad Auto Parts", "GST-36AABCH3344J1Z9", "PO-1014", date(2026, 7, 8), date(2026, 7, 21), "twocol", [("Alternator", 2, 9800), ("Starter motor", 2, 7400)], "single", "INR", "PO#"),
    (15, "Continental Bearings", "GST-27AAACC8877M1Z3", "PO-1015", date(2026, 7, 12), date(2026, 7, 24), "boxed", [("Roller bearing 22213", 50, 890)], "none", "INR", "Purchase Order:"),
    (16, "US Freight Corp", "TAX-US-46-1188322", "PO-1016", date(2026, 6, 18), date(2026, 7, 6), "left", [("Ocean freight - Container 40ft", 2, 3200), ("BAF surcharge", 2, 240), ("Terminal handling", 2, 180), ("Documentation", 1, 120), ("Insurance", 1, 450)], "single", "USD", "PO#"),
    (17, "Bosch Sensors India", "GST-29AAACB5566E1ZL", "PO-1017", date(2026, 6, 27), date(2026, 7, 13), "right", [("Pressure sensor P-100", 30, 1250), ("Temperature sensor T-200", 25, 980), ("Sensor mounting bracket", 55, 145)], "embedded", "INR", "quoted"),
    (18, "Munich Fasteners", "VAT-DE-336-2211-98", "PO-1018", date(2026, 6, 30), date(2026, 7, 17), "center", [(f"Bolt M{6+i} x 40mm (pack of 100)", 10, 22.50+i*2) for i in range(8)], "single", "EUR", "PO#"),
    (19, "Local Cartons Co", "GST-27AABLC2233N1ZY", "PO-1019", date(2026, 7, 14), date(2026, 7, 23), "twocol", [("Corrugated carton 30x20x15 (bundle of 50)", 20, 780)], "none", "INR", "Purchase Order:"),
    (20, "Tata Precision", "GST-27AAACT0011K1Z6", "PO-1020", date(2026, 6, 25), date(2026, 7, 11), "boxed", [("CNC insert grade K10", 100, 220), ("Insert holder", 10, 1450), ("Coolant nozzle", 20, 340)], "embedded", "INR", "Ref:"),
]


def money(amount, currency):
    q = Decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    symbols = {"INR": "Rs. ", "USD": "$ ", "EUR": "EUR "}
    return f"{symbols.get(currency, '')}{q:,.2f}"


def compute_totals(line_items, tax_style):
    subtotal = sum(Decimal(str(q)) * Decimal(str(r)) for _, q, r in line_items)
    if tax_style == "embedded":
        # 18% GST embedded in unit rates - shown as info line only
        tax = subtotal * Decimal("0.18") / Decimal("1.18")
        total = subtotal
    elif tax_style == "single":
        tax = subtotal * Decimal("0.18")
        total = subtotal + tax
    else:  # none
        tax = Decimal("0")
        total = subtotal
    return subtotal, tax, total


def draw_left_header(c, inv, styles):
    W, H = A4
    num, vendor, vid, po, po_date, inv_date, _, items, tax_style, cur, po_ref = inv
    subtotal, tax, total = compute_totals(items, tax_style)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20*mm, H-25*mm, vendor)
    c.setFont("Helvetica", 9)
    c.drawString(20*mm, H-32*mm, f"Vendor ID: {vid}")
    c.drawString(20*mm, H-37*mm, "123 Industrial Estate, Sector 7")
    c.drawString(20*mm, H-42*mm, "Contact: accounts@example.com | +91-22-5555-1200")
    c.setStrokeColor(colors.HexColor("#333333"))
    c.line(20*mm, H-46*mm, W-20*mm, H-46*mm)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(20*mm, H-56*mm, "TAX INVOICE")
    c.setFont("Helvetica", 10)
    c.drawString(20*mm, H-64*mm, f"Invoice No: INV-{num:04d}")
    c.drawString(20*mm, H-70*mm, f"Invoice Date: {inv_date.strftime('%d %b %Y')}")
    c.drawString(120*mm, H-64*mm, f"{po_ref} {po}")
    c.drawString(120*mm, H-70*mm, f"PO Date: {po_date.strftime('%d %b %Y')}")

    y = H-85*mm
    data = [["#", "Description", "Qty", "Rate", "Amount"]]
    for i, (desc, qty, rate) in enumerate(items, 1):
        amt = Decimal(str(qty)) * Decimal(str(rate))
        data.append([str(i), desc, str(qty), money(rate, cur), money(amt, cur)])
    t = Table(data, colWidths=[10*mm, 90*mm, 15*mm, 30*mm, 30*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#eeeeee")),
        ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("ALIGN", (2,1), (4,-1), "RIGHT"),
    ]))
    w, h = t.wrapOn(c, W, H)
    t.drawOn(c, 20*mm, y - h)
    y = y - h - 8*mm
    c.setFont("Helvetica", 10)
    c.drawRightString(W-20*mm, y, f"Subtotal: {money(subtotal, cur)}")
    y -= 5*mm
    if tax_style == "single":
        c.drawRightString(W-20*mm, y, f"GST @ 18%: {money(tax, cur)}")
        y -= 5*mm
    elif tax_style == "embedded":
        c.drawRightString(W-20*mm, y, f"(includes GST @ 18%: {money(tax, cur)})")
        y -= 5*mm
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(W-20*mm, y, f"Total: {money(total, cur)}")
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(20*mm, 20*mm, "Payment terms: Net 30. All amounts in " + cur + ".")


def draw_right_header(c, inv, styles):
    W, H = A4
    num, vendor, vid, po, po_date, inv_date, _, items, tax_style, cur, po_ref = inv
    subtotal, tax, total = compute_totals(items, tax_style)
    c.setFont("Helvetica-Bold", 22)
    c.drawRightString(W-20*mm, H-25*mm, vendor)
    c.setFont("Helvetica", 9)
    c.drawRightString(W-20*mm, H-32*mm, f"Vendor ID: {vid}")
    c.drawRightString(W-20*mm, H-37*mm, "Registered Office, Bangalore 560001")
    c.drawRightString(W-20*mm, H-42*mm, "billing@example.com")
    c.setStrokeColor(colors.HexColor("#0055aa"))
    c.setLineWidth(2)
    c.line(20*mm, H-46*mm, W-20*mm, H-46*mm)
    c.setLineWidth(1)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20*mm, H-56*mm, "INVOICE")
    c.setFont("Helvetica", 10)
    c.drawString(20*mm, H-64*mm, f"{po_ref} {po}")
    c.drawString(20*mm, H-70*mm, f"PO Date: {po_date.strftime('%Y-%m-%d')}")
    c.drawRightString(W-20*mm, H-64*mm, f"Invoice #: INV-{num:04d}")
    c.drawRightString(W-20*mm, H-70*mm, f"Date: {inv_date.strftime('%Y-%m-%d')}")

    y = H-85*mm
    data = [["Description", "Qty", "Unit Rate", "Line Total"]]
    for desc, qty, rate in items:
        amt = Decimal(str(qty)) * Decimal(str(rate))
        if tax_style == "embedded":
            desc_disp = f"{desc} (incl. 18% GST)"
        else:
            desc_disp = desc
        data.append([desc_disp, str(qty), money(rate, cur), money(amt, cur)])
    t = Table(data, colWidths=[100*mm, 20*mm, 25*mm, 30*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#0055aa")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("ALIGN", (1,1), (3,-1), "RIGHT"),
    ]))
    w, h = t.wrapOn(c, W, H)
    t.drawOn(c, 20*mm, y - h)
    y = y - h - 8*mm
    c.setFont("Helvetica", 10)
    c.drawRightString(W-20*mm, y, f"Subtotal: {money(subtotal, cur)}")
    y -= 5*mm
    if tax_style == "single":
        c.drawRightString(W-20*mm, y, f"Tax @ 18%: {money(tax, cur)}")
        y -= 5*mm
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(W-20*mm, y, f"Grand Total: {money(total, cur)}")


def draw_center(c, inv, styles):
    W, H = A4
    num, vendor, vid, po, po_date, inv_date, _, items, tax_style, cur, po_ref = inv
    subtotal, tax, total = compute_totals(items, tax_style)
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(W/2, H-25*mm, vendor)
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, H-33*mm, f"Vendor ID: {vid}   |   Corporate HQ, Pune 411001")
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(W/2, H-48*mm, "COMMERCIAL INVOICE")
    c.setFont("Helvetica", 10)
    c.drawString(20*mm, H-60*mm, f"Invoice: INV-{num:04d}")
    c.drawString(20*mm, H-66*mm, f"Date: {inv_date.strftime('%d-%m-%Y')}")
    c.drawRightString(W-20*mm, H-60*mm, f"{po_ref} {po}")
    c.drawRightString(W-20*mm, H-66*mm, f"PO Date: {po_date.strftime('%d-%m-%Y')}")

    y = H-82*mm
    data = [["Sl", "Item", "Qty", "Rate", "Value"]]
    for i, (desc, qty, rate) in enumerate(items, 1):
        amt = Decimal(str(qty)) * Decimal(str(rate))
        data.append([str(i), desc, str(qty), money(rate, cur), money(amt, cur)])
    t = Table(data, colWidths=[10*mm, 90*mm, 15*mm, 30*mm, 30*mm])
    t.setStyle(TableStyle([
        ("LINEABOVE", (0,0), (-1,0), 1, colors.black),
        ("LINEBELOW", (0,0), (-1,0), 1, colors.black),
        ("LINEBELOW", (0,-1), (-1,-1), 1, colors.black),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("ALIGN", (2,1), (4,-1), "RIGHT"),
    ]))
    w, h = t.wrapOn(c, W, H)
    t.drawOn(c, 20*mm, y - h)
    y = y - h - 8*mm
    c.setFont("Helvetica", 10)
    c.drawRightString(W-20*mm, y, f"Subtotal: {money(subtotal, cur)}")
    y -= 5*mm
    if tax_style == "single":
        c.drawRightString(W-20*mm, y, f"GST @ 18%: {money(tax, cur)}")
        y -= 5*mm
    elif tax_style == "embedded":
        c.drawRightString(W-20*mm, y, f"(includes GST @ 18% of {money(tax, cur)})")
        y -= 5*mm
    c.setFont("Helvetica-Bold", 13)
    c.drawRightString(W-20*mm, y, f"TOTAL PAYABLE: {money(total, cur)}")


def draw_twocol(c, inv, styles):
    W, H = A4
    num, vendor, vid, po, po_date, inv_date, _, items, tax_style, cur, po_ref = inv
    subtotal, tax, total = compute_totals(items, tax_style)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(20*mm, H-25*mm, vendor)
    c.setFont("Helvetica", 9)
    c.drawString(20*mm, H-31*mm, vid)
    c.drawString(20*mm, H-36*mm, "Office: 5th Floor, Business Park, Gurgaon 122001")
    box_x = W-90*mm
    c.rect(box_x, H-45*mm, 70*mm, 25*mm, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(box_x+3*mm, H-30*mm, "INVOICE")
    c.setFont("Helvetica", 9)
    c.drawString(box_x+3*mm, H-36*mm, f"No: INV-{num:04d}")
    c.drawString(box_x+3*mm, H-41*mm, f"Date: {inv_date.strftime('%d %b %Y')}")
    c.drawString(box_x+35*mm, H-30*mm, "PURCHASE ORDER")
    c.drawString(box_x+35*mm, H-36*mm, f"No: {po}")
    c.drawString(box_x+35*mm, H-41*mm, f"Date: {po_date.strftime('%d %b %Y')}")
    c.setFont("Helvetica", 8)
    c.drawString(20*mm, H-52*mm, f"Reference style: {po_ref}")

    y = H-65*mm
    data = [["Description", "Qty", "Rate", "Amount"]]
    for desc, qty, rate in items:
        amt = Decimal(str(qty)) * Decimal(str(rate))
        data.append([desc, str(qty), money(rate, cur), money(amt, cur)])
    t = Table(data, colWidths=[110*mm, 15*mm, 25*mm, 25*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#f0f0f0")),
        ("BOX", (0,0), (-1,-1), 0.75, colors.black),
        ("INNERGRID", (0,0), (-1,-1), 0.25, colors.grey),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("ALIGN", (1,1), (3,-1), "RIGHT"),
    ]))
    w, h = t.wrapOn(c, W, H)
    t.drawOn(c, 20*mm, y - h)
    y = y - h - 8*mm
    c.setFont("Helvetica", 10)
    c.drawRightString(W-20*mm, y, f"Subtotal: {money(subtotal, cur)}")
    y -= 5*mm
    if tax_style == "single":
        c.drawRightString(W-20*mm, y, f"GST @ 18%: {money(tax, cur)}")
        y -= 5*mm
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(W-20*mm, y, f"Total Due: {money(total, cur)}")


def draw_boxed(c, inv, styles):
    W, H = A4
    num, vendor, vid, po, po_date, inv_date, _, items, tax_style, cur, po_ref = inv
    subtotal, tax, total = compute_totals(items, tax_style)
    c.setStrokeColor(colors.black)
    c.setLineWidth(1.5)
    c.rect(15*mm, 15*mm, W-30*mm, H-30*mm, stroke=1, fill=0)
    c.setLineWidth(0.5)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(22*mm, H-25*mm, vendor.upper())
    c.setFont("Helvetica", 9)
    c.drawString(22*mm, H-31*mm, f"ID: {vid}    Regd: Whitefield, Bangalore")
    c.line(22*mm, H-35*mm, W-22*mm, H-35*mm)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(22*mm, H-45*mm, "INVOICE")
    c.setFont("Helvetica", 10)
    # note: some invoices in "boxed" put PO ref in a quoted item, others in header
    if po_ref == "quoted":
        c.drawString(22*mm, H-53*mm, f"Invoice No: INV-{num:04d}   |   Date: {inv_date.strftime('%d %b %Y')}")
        c.drawString(22*mm, H-59*mm, "PO reference is quoted in line item description below.")
    else:
        c.drawString(22*mm, H-53*mm, f"Invoice No: INV-{num:04d}   |   Date: {inv_date.strftime('%d %b %Y')}")
        c.drawString(22*mm, H-59*mm, f"{po_ref} {po}   |   PO Date: {po_date.strftime('%d %b %Y')}")

    y = H-72*mm
    data = [["Description", "Qty", "Rate", "Amount"]]
    for desc, qty, rate in items:
        amt = Decimal(str(qty)) * Decimal(str(rate))
        if po_ref == "quoted":
            desc_disp = f"{desc} (against {po})"
        elif tax_style == "embedded":
            desc_disp = f"{desc} (18% GST incl.)"
        else:
            desc_disp = desc
        data.append([desc_disp, str(qty), money(rate, cur), money(amt, cur)])
    t = Table(data, colWidths=[110*mm, 15*mm, 25*mm, 25*mm])
    t.setStyle(TableStyle([
        ("BOX", (0,0), (-1,-1), 1, colors.black),
        ("INNERGRID", (0,0), (-1,-1), 0.25, colors.grey),
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#dddddd")),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("ALIGN", (1,1), (3,-1), "RIGHT"),
    ]))
    w, h = t.wrapOn(c, W, H)
    t.drawOn(c, 22*mm, y - h)
    y = y - h - 8*mm
    c.setFont("Helvetica", 10)
    c.drawRightString(W-22*mm, y, f"Subtotal: {money(subtotal, cur)}")
    y -= 5*mm
    if tax_style == "single":
        c.drawRightString(W-22*mm, y, f"Tax @ 18%: {money(tax, cur)}")
        y -= 5*mm
    elif tax_style == "embedded":
        c.drawRightString(W-22*mm, y, f"(includes GST @ 18%: {money(tax, cur)})")
        y -= 5*mm
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(W-22*mm, y, f"Payable: {money(total, cur)}")


LAYOUT_MAP = {
    "left":   draw_left_header,
    "right":  draw_right_header,
    "center": draw_center,
    "twocol": draw_twocol,
    "boxed":  draw_boxed,
}


def main():
    styles = getSampleStyleSheet()
    for inv in INVOICES:
        num = inv[0]
        layout = inv[6]
        path = OUT_DIR / f"INV-{num:04d}.pdf"
        c = canvas.Canvas(str(path), pagesize=A4)
        LAYOUT_MAP[layout](c, inv, styles)
        c.showPage()
        c.save()
        print(f"[ok] {path.name}")

    # write the PO master spreadsheet
    try:
        from openpyxl import Workbook
    except ImportError:
        os.system("pip install openpyxl > NUL 2>&1")
        from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "PO Master"
    ws.append(["po_number", "po_date", "vendor_name", "vendor_id", "po_amount", "currency", "line_item_summary"])
    for inv in INVOICES:
        num, vendor, vid, po, po_date, inv_date, _, items, tax_style, cur, po_ref = inv
        subtotal, tax, total = compute_totals(items, tax_style)
        summary = "; ".join(f"{q}x {d}" for d, q, _ in items[:3]) + (" ..." if len(items) > 3 else "")
        ws.append([po, po_date.isoformat(), vendor, vid, float(total), cur, summary])
    xlsx_path = OUT_DIR / "po_master.xlsx"
    wb.save(xlsx_path)
    print(f"[ok] {xlsx_path.name}")


if __name__ == "__main__":
    main()

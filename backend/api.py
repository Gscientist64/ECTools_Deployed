from flask import Blueprint, jsonify, request, current_app, send_file
from flask_login import login_user, logout_user, current_user, login_required
from extensions import db
from models import Users, Tool, ToolCategory, Request as RequestModel, RequestedTool, ToolUsage, Delivery, FacilityStock, DepartmentDistribution, PhysicalStockCount, StockReceipt, StockReceiptLine, FacilityTransfer, NotificationRead
from sqlalchemy.orm import joinedload
from sqlalchemy import func, and_, case, distinct, or_, not_
from werkzeug.utils import secure_filename
import pandas as pd
from io import BytesIO
import math
from datetime import datetime, timedelta
from calendar import monthrange
from io import BytesIO
from pathlib import Path
import os
print("RUNNING api.py FROM:", os.path.abspath(__file__))
import csv
import io
import json
import asyncio
import queue
import threading
from flask import Response, stream_with_context

# PDF Generation imports
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

active_connections = []
connection_queues = {}

# Optional deps (reports)
import pandas as pd

# Password hashing helper
from werkzeug.security import check_password_hash, generate_password_hash

api_bp = Blueprint("api", __name__)


# -----------------------
# Helpers
# -----------------------

def _looks_like_hash(s: str) -> bool:
    if not isinstance(s, str):
        return False
    s = s.strip()
    return s.startswith("pbkdf2:") or s.startswith("scrypt:") or s.startswith("$2") or len(s) > 30


def _verify_password(stored: str, password: str) -> bool:
    """Verify password against stored hash, handling scrypt compatibility."""
    if not stored or not password:
        return False
    try:
        return check_password_hash(stored, password)
    except ValueError:
        # werkzeug 3.x may fail on scrypt hashes — fall back to hashlib
        if stored.startswith("scrypt:"):
            try:
                import hashlib, base64
                # Format: scrypt:N:R:P$salt$hash
                rest = stored[len("scrypt:"):]
                params, _, rest2 = rest.partition("$")
                salt_b64, _, hash_b64 = rest2.partition("$")
                N, R, P = (int(x) for x in params.split(":"))
                salt = base64.b64decode(salt_b64)
                expected = base64.b64decode(hash_b64)
                result = hashlib.scrypt(
                    password.encode("utf-8"), salt=salt,
                    n=N, r=R, p=P, dklen=len(expected)
                )
                return result == expected
            except Exception:
                return False
        return False


def _hash_password(password: str) -> str:
    """Hash password using pbkdf2 (widely compatible)."""
    return generate_password_hash(password, method="pbkdf2:sha256")


def _user_role(user) -> str:
    return (getattr(user, "role", None) or getattr(user, "roles", None) or "user").lower()


def _is_admin_user(user) -> bool:
    if not user:
        return False

    for flag in ("is_admin", "isAdmin", "admin", "is_superuser", "isSuperuser"):
        if hasattr(user, flag):
            try:
                if bool(getattr(user, flag)):
                    return True
            except Exception:
                pass

    role = (getattr(user, "role", None) or getattr(user, "roles", None) or "").strip().lower()
    if role in ("admin", "administrator", "superadmin", "super_admin", "super-user", "superuser", "hq_admin", "hq admin"):
        return True

    return False


def _toolusage_cols():
    date_col = None
    for c in ("date_used", "created_at", "date", "timestamp"):
        if hasattr(ToolUsage, c):
            date_col = getattr(ToolUsage, c)
            break

    qty_col = None
    for c in ("quantity_used", "quantity", "qty", "amount"):
        if hasattr(ToolUsage, c):
            qty_col = getattr(ToolUsage, c)
            break

    return date_col, qty_col


def _cat_dict(c):
    return {"id": c.id, "name": c.name}


def _tool_dict(t):
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "quantity": t.quantity,
        "category_id": t.category_id,
        "category": t.category.name if getattr(t, "category", None) else None,
    }


def _make_toolusage(tool_id: int, user_id: int, qty: int):
    kwargs = {}

    if hasattr(ToolUsage, "tool_id"):
        kwargs["tool_id"] = tool_id
    if hasattr(ToolUsage, "user_id"):
        kwargs["user_id"] = user_id

    if hasattr(ToolUsage, "quantity_used"):
        kwargs["quantity_used"] = qty
    elif hasattr(ToolUsage, "quantity"):
        kwargs["quantity"] = qty
    elif hasattr(ToolUsage, "qty"):
        kwargs["qty"] = qty
    elif hasattr(ToolUsage, "amount"):
        kwargs["amount"] = qty

    now = datetime.utcnow()
    if hasattr(ToolUsage, "date_used"):
        kwargs["date_used"] = now
    elif hasattr(ToolUsage, "created_at"):
        kwargs["created_at"] = now
    elif hasattr(ToolUsage, "date"):
        kwargs["date"] = now
    elif hasattr(ToolUsage, "timestamp"):
        kwargs["timestamp"] = now

    return ToolUsage(**kwargs)


def _admin_required_json():
    return jsonify({"error": "Forbidden: admin only"}), 403


def _downloads_dir() -> Path:
    override = (os.environ.get("DOWNLOADS_DIR") or "").strip()
    if override:
        p = Path(override).expanduser()
        try:
            p.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return p

    home = Path.home()
    candidates = []

    userprofile = os.environ.get("USERPROFILE")
    if userprofile:
        candidates.append(Path(userprofile) / "Downloads")

    candidates += [
        home / "Downloads",
        home / "Download",
    ]

    for p in candidates:
        if p.exists():
            return p

    return home


def _save_report_bytes(filename: str, data: bytes) -> Path:
    dl = _downloads_dir()
    out_path = dl / filename

    if out_path.exists():
        stem = out_path.stem
        suffix = out_path.suffix
        for n in range(1, 5000):
            candidate = dl / f"{stem}_{n}{suffix}"
            if not candidate.exists():
                out_path = candidate
                break

    out_path.write_bytes(data)
    return out_path


def _json_body():
    return request.get_json(silent=True) or request.form.to_dict() or {}


def _iso(dt):
    return dt.isoformat() if dt else None


def _safe_int(x, default=0):
    try:
        return int(x)
    except Exception:
        return default


# -----------------------
# PDF Generation Helper
# -----------------------

def create_delivery_note_pdf(delivery, tool, requester, distributor, request_obj):
    """
    Generate PDF delivery note using ReportLab.
    Handles None values for optional parameters gracefully.
    """
    buffer = BytesIO()
    
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=72,
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a237e'),
        spaceAfter=30,
        alignment=1
    )
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#0d47a1'),
        spaceAfter=12,
        spaceBefore=20
    )
    normal_style = styles['Normal']
    
    # Safely compute display values with fallbacks for None
    tool_name = tool.name if tool else "Unknown Tool"
    req_first = requester.first_name if requester else "Unknown"
    req_other = getattr(requester, 'other_name', '') if requester else ""
    req_facility = requester.facility if requester else "N/A"
    req_email = requester.email if requester else "N/A"
    dist_first = distributor.first_name if distributor else "Admin"
    dist_other = getattr(distributor, 'other_name', '') if distributor else ""
    dist_role = (getattr(distributor, 'role', None) or getattr(distributor, 'roles', None) or "Admin") if distributor else "Admin"
    
    basic_unit_raw = getattr(delivery, 'basic_unit', None)
    basic_unit_display = "Unit"
    if basic_unit_raw:
        basic_unit_display = {
            'register': 'Register',
            'booklet': 'Booklet',
            'pack': 'Pack',
            'unit': 'Unit'
        }.get(basic_unit_raw, str(basic_unit_raw).capitalize())
    
    story = []
    
    story.append(Paragraph("DELIVERY NOTE", title_style))
    story.append(Spacer(1, 12))
    
    story.append(Paragraph(f"<b>Delivery Note #:</b> {delivery.id}", normal_style))
    story.append(Paragraph(f"<b>Date:</b> {datetime.now().strftime('%B %d, %Y')}", normal_style))
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("<b>DELIVER TO:</b>", heading_style))
    story.append(Paragraph(f"{req_first} {req_other}", normal_style))
    story.append(Paragraph(f"Facility: {req_facility or 'N/A'}", normal_style))
    story.append(Paragraph(f"Email: {req_email}", normal_style))
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("<b>ITEMS SUPPLIED:</b>", heading_style))
    
    table_data = [['Tool Name', 'Basic Unit', 'Quantity Supplied']]
    
    table_data.append([
        tool_name,
        basic_unit_display,
        str(delivery.quantity_supplied or 0)
    ])
    
    table = Table(table_data, colWidths=[250, 100, 100])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a237e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ('ALIGN', (2, 1), (2, -1), 'CENTER'),
    ]))
    
    story.append(table)
    story.append(Spacer(1, 30))
    
    story.append(Paragraph("<b>DELIVERY CONFIRMATION:</b>", heading_style))
    story.append(Spacer(1, 20))
    
    witnessed = getattr(delivery, 'witnessed_by', None) or '_________________'
    
    sig_data = [
        ['Distributed By:', 'Received By:', 'Witnessed By:'],
        ['', '', ''],
        ['', '', ''],
        [
            f"{dist_first} {dist_other}",
            f"{req_first} {req_other}",
            witnessed
        ],
        [
            f"({dist_role})",
            "(Recipient)",
            "(Witness)"
        ]
    ]
    
    sig_table = Table(sig_data, colWidths=[150, 150, 150])
    sig_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 1), (-1, 1), 1, colors.black),
        ('LINEBELOW', (0, 2), (-1, 2), 1, colors.black),
        ('TOPPADDING', (0, 3), (-1, 3), 20),
        ('FONTSIZE', (0, 3), (-1, 3), 9),
        ('FONTNAME', (0, 3), (-1, 3), 'Helvetica-Oblique'),
    ]))
    
    story.append(sig_table)
    story.append(Spacer(1, 40))
    
    story.append(Paragraph(
        "<i>This delivery note is system-generated and requires no signature if already confirmed electronically.</i>",
        styles['Italic']
    ))
    
    doc.build(story)
    buffer.seek(0)
    
    return buffer.getvalue()


# -----------------------
# Health
# -----------------------

@api_bp.route("/ping")
def ping():
    return jsonify({"ok": True}), 200


# -----------------------
# Auth
# -----------------------

@api_bp.route("/login", methods=["POST"])
def login():
    data = _json_body()
    identifier = (data.get("username") or data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not identifier or not password:
        return jsonify({"error": "username/email and password required"}), 400

    u = Users.query.filter(
        or_(
            func.lower(Users.email) == identifier,
            func.lower(Users.username) == identifier
        )
    ).first()

    if not u:
        return jsonify({"error": "Invalid credentials"}), 401

    stored = getattr(u, "password", "") or ""
    ok = _verify_password(stored, password) if _looks_like_hash(stored) else (stored == password)

    if not ok:
        return jsonify({"error": "Invalid credentials"}), 401

    login_user(u)
    return jsonify({"message": "ok"}), 200


@api_bp.route("/me")
@login_required
def me():
    u = current_user
    return jsonify({
        "id": u.id,
        "email": getattr(u, "email", None),
        "username": getattr(u, "username", None),
        "first_name": getattr(u, "first_name", None),
        "facility": getattr(u, "facility", None),
        "role": getattr(u, "role", getattr(u, "roles", None)),
    }), 200


# -----------------------
# HQ Admin Endpoints
# -----------------------

@api_bp.route("/admin/facilities", methods=["GET"])
@login_required
def list_facilities():
    """List all unique facilities"""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    rows = db.session.query(Users.facility).filter(Users.facility.isnot(None), Users.facility != "").distinct().order_by(Users.facility).all()
    return jsonify([r[0] for r in rows]), 200


# -----------------------
# My Inventory (Facility user)
# -----------------------

@api_bp.route("/inventory/my-stock/update-qty-received", methods=["POST"])
@login_required
def update_qty_received():
    """Manually update the qty_received for a tool at the user's facility"""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned to your account"}), 400

    data = _json_body()
    tool_id = _safe_int(data.get("tool_id"))
    qty_received = _safe_int(data.get("qty_received"))

    if not tool_id or qty_received < 0:
        return jsonify({"error": "tool_id and qty_received are required"}), 400

    stock = FacilityStock.query.filter_by(facility=facility, tool_id=tool_id).first()
    if not stock:
        stock = FacilityStock(
            facility=facility,
            tool_id=tool_id,
            quantity=0,
            opening_balance=0,
            qty_received=qty_received
        )
        db.session.add(stock)
    else:
        stock.qty_received = qty_received

    db.session.commit()

    return jsonify({"message": "Qty Received updated", "facility_stock_id": stock.id}), 200


@api_bp.route("/inventory/my-stock", methods=["GET"])
@login_required
def my_facility_stock():
    """Get current stock levels for the user's facility with computed columns"""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned to your account"}), 400

    stocks = FacilityStock.query.filter_by(facility=facility).all()
    stock_map = {s.tool_id: s for s in stocks}

    # Also show all tools, even if no stock row exists yet
    tools = Tool.query.order_by(Tool.name.asc()).all()
    result = []
    for t in tools:
        s = stock_map.get(t.id)

        # Qty Supplied: total quantity_supplied from Delivery records for this tool at this facility
        qty_supplied = db.session.query(func.coalesce(func.sum(Delivery.quantity_supplied), 0))\
            .filter(Delivery.tool_id == t.id)\
            .filter(Delivery.is_delivered == True)\
            .join(Users, Delivery.received_by == Users.id)\
            .filter(Users.facility == facility)\
            .scalar()

        qty_supplied = int(qty_supplied or 0)

        # Qty Utilized = opening_balance + total approved requests (for this tool at this facility)
        # Approved requests for this user's facility for this tool
        opening_bal = s.opening_balance if s else 0

        approved_qty = db.session.query(func.coalesce(func.sum(RequestedTool.quantity), 0))\
            .join(RequestModel, RequestedTool.request_id == RequestModel.id)\
            .join(Users, RequestModel.user_id == Users.id)\
            .filter(RequestedTool.tool_id == t.id)\
            .filter(RequestedTool.status == 'approved')\
            .filter(Users.facility == facility)\
            .scalar()

        approved_qty = int(approved_qty or 0)
        qty_utilized = opening_bal + approved_qty

        result.append({
            "tool_id": t.id,
            "tool_name": t.name,
            "category": t.category.name if t.category else "Uncategorized",
            "quantity": s.quantity if s else 0,
            "opening_balance": opening_bal,
            "qty_supplied": qty_supplied,
            "qty_received": s.qty_received if s else 0,
            "qty_utilized": qty_utilized,
            "facility_stock_id": s.id if s else None
        })

    return jsonify(result), 200


@api_bp.route("/inventory/distributions", methods=["GET"])
@login_required
def my_department_distributions():
    """Get department distributions for the user's facility"""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned to your account"}), 400

    dists = (
        DepartmentDistribution.query
        .filter_by(facility=facility)
        .order_by(DepartmentDistribution.date_distributed.desc())
        .all()
    )
    return jsonify([d.to_dict() for d in dists]), 200


@api_bp.route("/inventory/distribute", methods=["POST"])
@login_required
def distribute_to_department():
    """Distribute stock to a department within the user's facility"""
    data = _json_body()
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    tool_id = _safe_int(data.get("tool_id"))
    department = (data.get("department") or "").strip()
    quantity = _safe_int(data.get("quantity"))

    if not tool_id or not department or quantity <= 0:
        return jsonify({"error": "tool_id, department, and quantity are required"}), 400

    valid_depts = ["lab", "pharmacy", "triage", "community", "others"]
    if department.lower() not in valid_depts:
        return jsonify({"error": f"Invalid department. Must be one of: {', '.join(valid_depts)}"}), 400

    # Check available stock in facility
    stock = FacilityStock.query.filter_by(facility=facility, tool_id=tool_id).first()
    available = stock.quantity if stock else 0
    if available < quantity:
        return jsonify({"error": f"Insufficient stock. Available: {available}, requested: {quantity}"}), 400

    # Deduct from facility stock
    stock.quantity -= quantity

    # Record distribution
    dist = DepartmentDistribution(
        facility=facility,
        tool_id=tool_id,
        department=department.lower(),
        quantity=quantity,
        distributed_by=current_user.id,
        notes=data.get("notes", "")
    )
    db.session.add(dist)
    db.session.commit()

    return jsonify(dist.to_dict()), 201


@api_bp.route("/inventory/summary", methods=["GET"])
@login_required
def my_inventory_summary():
    """Get inventory summary for the user's facility"""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    # Total tools in stock (sum of all facility stock quantities)
    total_items = db.session.query(func.sum(FacilityStock.quantity)).filter_by(facility=facility).scalar() or 0

    # Total distinct tool types
    distinct_tools = FacilityStock.query.filter_by(facility=facility).count()

    # Department summary
    dept_rows = (
        db.session.query(
            DepartmentDistribution.department,
            func.sum(DepartmentDistribution.quantity).label("total")
        )
        .filter_by(facility=facility)
        .group_by(DepartmentDistribution.department)
        .all()
    )
    department_summary = [{"department": r[0], "total": int(r[1])} for r in dept_rows]

    # Recent distributions
    recent = (
        DepartmentDistribution.query
        .filter_by(facility=facility)
        .order_by(DepartmentDistribution.date_distributed.desc())
        .limit(10)
        .all()
    )

    return jsonify({
        "facility": facility,
        "total_items": int(total_items),
        "distinct_tools": distinct_tools,
        "department_summary": department_summary,
        "recent_distributions": [d.to_dict() for d in recent]
    }), 200


# -----------------------
# Longitudinal Stock Levels (Week / Month / Quarter)
# -----------------------

@api_bp.route("/inventory/my-stock/longitudinal", methods=["GET"])
@login_required
def my_stock_longitudinal():
    """Return longitudinal stock data grouped by week/month/quarter with
    rolling opening/closing balances per tool at the user's facility."""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned to your account"}), 400

    period = (request.args.get("period") or "week").strip().lower()
    if period not in ("week", "month", "quarter"):
        return jsonify({"error": "period must be week, month, or quarter"}), 400

    year_str = request.args.get("year")
    try:
        year = int(year_str) if year_str else datetime.utcnow().year
    except ValueError:
        return jsonify({"error": "Invalid year"}), 400

    # --- helper: determine period label and range for a given date ---
    def period_key(dt: datetime):
        """Return (sort_key, label, period_start, period_end) for a given datetime."""
        if period == "week":
            iso = dt.isocalendar()
            wk = iso[1]
            yr = iso[0]
            # Monday of that ISO week
            jan4 = datetime(yr, 1, 4)
            start_of_week1 = jan4 - timedelta(days=jan4.isocalendar()[2] - 1)
            period_start = start_of_week1 + timedelta(weeks=wk - 1)
            period_end = period_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
            label = f"{yr}-W{wk:02d}"
            sort_key = f"{yr}{wk:02d}"
        elif period == "month":
            yr = dt.year
            mo = dt.month
            period_start = datetime(yr, mo, 1)
            last_day = monthrange(yr, mo)[1]
            period_end = datetime(yr, mo, last_day, 23, 59, 59)
            label = f"{yr}-{mo:02d}"
            sort_key = f"{yr}{mo:02d}"
        else:  # quarter
            yr = dt.year
            q = (dt.month - 1) // 3 + 1
            q_start_month = (q - 1) * 3 + 1
            q_end_month = q * 3
            period_start = datetime(yr, q_start_month, 1)
            last_day = monthrange(yr, q_end_month)[1]
            period_end = datetime(yr, q_end_month, last_day, 23, 59, 59)
            label = f"{yr}-Q{q}"
            sort_key = f"{yr}{q:02d}"
        return sort_key, label, period_start, period_end

    # --- collect all events (supplies + utilization) ---
    # 1. Department distributions (utilization)
    distributions = (
        DepartmentDistribution.query
        .filter_by(facility=facility)
        .filter(DepartmentDistribution.date_distributed >= datetime(year, 1, 1))
        .filter(DepartmentDistribution.date_distributed < datetime(year + 1, 1, 1))
        .all()
    )

    # 2. Deliveries (supplies via approved requests)
    deliveries = (
        Delivery.query
        .filter(Delivery.is_delivered == True)
        .filter(Delivery.delivery_date >= datetime(year, 1, 1))
        .filter(Delivery.delivery_date < datetime(year + 1, 1, 1))
        .join(Users, Delivery.received_by == Users.id)
        .filter(Users.facility == facility)
        .all()
    )

    # 3. Stock receipts (supplies from suppliers) — filter by facility
    receipt_lines = (
        db.session.query(StockReceiptLine, StockReceipt)
        .join(StockReceipt, StockReceiptLine.receipt_id == StockReceipt.id)
        .join(Users, StockReceipt.received_by == Users.id)
        .filter(Users.facility == facility)
        .filter(StockReceipt.date_supplied >= datetime(year, 1, 1))
        .filter(StockReceipt.date_supplied < datetime(year + 1, 1, 1))
        .all()
    )

    # --- Build per-tool per-period aggregations ---
    # Structure: { tool_id: { period_sort_key: { opening, supplied, utilized } } }
    tool_periods = {}

    # Initialize from FacilityStock opening_balance
    stocks = FacilityStock.query.filter_by(facility=facility).all()
    stock_map = {s.tool_id: s for s in stocks}

    # Get all tools to ensure we show all of them
    tools = Tool.query.order_by(Tool.name.asc()).all()

    # Process distributions (utilization)
    for d in distributions:
        if not d.date_distributed:
            continue
        sk, label, p_start, p_end = period_key(d.date_distributed)
        tp = tool_periods.setdefault(d.tool_id, {})
        entry = tp.setdefault(sk, {"label": label, "period_start": p_start.isoformat(), "period_end": p_end.isoformat(), "supplied": 0, "utilized": 0})
        entry["utilized"] += d.quantity

    # Process deliveries (supplied)
    for d in deliveries:
        if not d.delivery_date:
            continue
        sk, label, p_start, p_end = period_key(d.delivery_date)
        tp = tool_periods.setdefault(d.tool_id, {})
        entry = tp.setdefault(sk, {"label": label, "period_start": p_start.isoformat(), "period_end": p_end.isoformat(), "supplied": 0, "utilized": 0})
        entry["supplied"] += d.quantity_supplied or 0

    # Process stock receipts (supplied)
    for line, receipt in receipt_lines:
        if not receipt.date_supplied:
            continue
        sk, label, p_start, p_end = period_key(receipt.date_supplied)
        tp = tool_periods.setdefault(line.tool_id, {})
        entry = tp.setdefault(sk, {"label": label, "period_start": p_start.isoformat(), "period_end": p_end.isoformat(), "supplied": 0, "utilized": 0})
        entry["supplied"] += line.quantity_received or 0

    # --- Build result with rolling balances ---
    result_tools = []
    for t in tools:
        s = stock_map.get(t.id)
        initial_opening = s.opening_balance if s else 0

        periods_dict = tool_periods.get(t.id, {})
        if not periods_dict:
            # No activity for this tool in this year
            if initial_opening == 0:
                continue  # skip tools with no activity and no opening balance
            # Still include if there's an opening balance
            result_tools.append({
                "tool_id": t.id,
                "tool_name": t.name,
                "category": t.category.name if t.category else "Uncategorized",
                "initial_opening": initial_opening,
                "periods": []
            })
            continue

        sorted_keys = sorted(periods_dict.keys())
        running_balance = initial_opening
        periods_list = []
        for sk in sorted_keys:
            entry = periods_dict[sk]
            opening = running_balance
            supplied = entry["supplied"]
            utilized = entry["utilized"]
            closing = opening + supplied - utilized
            periods_list.append({
                "label": entry["label"],
                "period_start": entry["period_start"],
                "period_end": entry["period_end"],
                "opening_balance": opening,
                "qty_supplied": supplied,
                "qty_utilized": utilized,
                "closing_balance": closing
            })
            running_balance = closing

        result_tools.append({
            "tool_id": t.id,
            "tool_name": t.name,
            "category": t.category.name if t.category else "Uncategorized",
            "initial_opening": initial_opening,
            "periods": periods_list
        })

    return jsonify({
        "facility": facility,
        "period_type": period,
        "year": year,
        "tools": result_tools
    }), 200


# -----------------------
# Physical Stock Count
# -----------------------

@api_bp.route("/inventory/physical-count", methods=["POST"])
@login_required
def record_physical_count():
    """Record physical stock count for a tool"""
    data = _json_body()
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    tool_id = _safe_int(data.get("tool_id"))
    physical_quantity = _safe_int(data.get("physical_quantity"))
    notes = (data.get("notes") or "").strip()

    if not tool_id:
        return jsonify({"error": "tool_id is required"}), 400
    if physical_quantity < 0:
        return jsonify({"error": "physical_quantity cannot be negative"}), 400

    # Compute true system quantity from all stock movements
    stock = FacilityStock.query.filter_by(facility=facility, tool_id=tool_id).first()
    opening = (stock.opening_balance + stock.qty_received) if stock else 0

    # Supplies from confirmed deliveries
    delivered = int(db.session.query(func.coalesce(func.sum(Delivery.quantity_supplied), 0))
        .filter(Delivery.tool_id == tool_id, Delivery.is_delivered == True)
        .join(Users, Delivery.received_by == Users.id)
        .filter(Users.facility == facility).scalar() or 0)

    # Supplies from stock receipts
    received = int(db.session.query(func.coalesce(func.sum(StockReceiptLine.quantity_received), 0))
        .join(StockReceipt, StockReceiptLine.receipt_id == StockReceipt.id)
        .join(Users, StockReceipt.received_by == Users.id)
        .filter(Users.facility == facility, StockReceiptLine.tool_id == tool_id).scalar() or 0)

    # Incoming accepted transfers
    transfers_in = int(db.session.query(func.coalesce(func.sum(FacilityTransfer.quantity), 0))
        .filter(FacilityTransfer.to_facility == facility, FacilityTransfer.tool_id == tool_id,
                FacilityTransfer.status == 'accepted').scalar() or 0)

    # Department distributions (outgoing)
    distributed = int(db.session.query(func.coalesce(func.sum(DepartmentDistribution.quantity), 0))
        .filter(DepartmentDistribution.facility == facility, DepartmentDistribution.tool_id == tool_id).scalar() or 0)

    # Outgoing transfers (pending + accepted)
    transfers_out = int(db.session.query(func.coalesce(func.sum(FacilityTransfer.quantity), 0))
        .filter(FacilityTransfer.from_facility == facility, FacilityTransfer.tool_id == tool_id,
                FacilityTransfer.status.in_(['pending', 'accepted'])).scalar() or 0)

    system_quantity = opening + delivered + received + transfers_in - distributed - transfers_out
    discrepancy = physical_quantity - system_quantity

    pc = PhysicalStockCount(
        facility=facility,
        tool_id=tool_id,
        system_quantity=system_quantity,
        physical_quantity=physical_quantity,
        discrepancy=discrepancy,
        counted_by=current_user.id,
        notes=notes
    )
    db.session.add(pc)
    db.session.commit()

    return jsonify(pc.to_dict()), 201


@api_bp.route("/inventory/physical-counts", methods=["GET"])
@login_required
def list_physical_counts():
    """List physical stock counts for the user's facility"""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    counts = (
        PhysicalStockCount.query
        .filter_by(facility=facility)
        .order_by(PhysicalStockCount.counted_at.desc())
        .limit(50)
        .all()
    )
    return jsonify([c.to_dict() for c in counts]), 200


# -----------------------
# Facility-to-Facility Transfer
# -----------------------

@api_bp.route("/inventory/transfer/initiate", methods=["POST"])
@login_required
def initiate_transfer():
    """Initiate a facility-to-facility transfer (sender starts it)."""
    data = _json_body()
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned to your account"}), 400

    to_facility = (data.get("to_facility") or "").strip()
    tool_name = (data.get("tool_name") or "").strip()
    quantity = _safe_int(data.get("quantity"))
    notes = (data.get("notes") or "").strip()

    if not to_facility or not tool_name or quantity <= 0:
        return jsonify({"error": "to_facility, tool_name, and quantity are required"}), 400

    if to_facility.lower() == facility.lower():
        return jsonify({"error": "Cannot transfer to the same facility"}), 400

    # Find tool by name
    tool = Tool.query.filter(func.lower(Tool.name) == tool_name.lower()).first()
    if not tool:
        return jsonify({"error": f"Tool '{tool_name}' not found"}), 404

    # Check sender has sufficient stock
    stock = FacilityStock.query.filter_by(facility=facility, tool_id=tool.id).first()
    available = stock.quantity if stock else 0
    if available < quantity:
        return jsonify({"error": f"Insufficient stock. Available at {facility}: {available}, requested: {quantity}"}), 400

    # Create the transfer record (status: pending) & deduct from sender immediately
    stock.quantity -= quantity
    transfer = FacilityTransfer(
        from_facility=facility,
        to_facility=to_facility,
        tool_id=tool.id,
        quantity=quantity,
        status="pending",
        notes=notes,
        initiated_by=current_user.id
    )
    db.session.add(transfer)
    db.session.commit()

    return jsonify(transfer.to_dict()), 201


@api_bp.route("/inventory/transfer/incoming", methods=["GET"])
@login_required
def list_incoming_transfers():
    """List pending transfers TO the user's facility (for receiving facility to see)."""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    transfers = (
        FacilityTransfer.query
        .filter_by(to_facility=facility)
        .order_by(FacilityTransfer.created_at.desc())
        .all()
    )
    return jsonify([t.to_dict() for t in transfers]), 200


@api_bp.route("/inventory/transfer/outgoing", methods=["GET"])
@login_required
def list_outgoing_transfers():
    """List transfers FROM the user's facility."""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    transfers = (
        FacilityTransfer.query
        .filter_by(from_facility=facility)
        .order_by(FacilityTransfer.created_at.desc())
        .all()
    )
    return jsonify([t.to_dict() for t in transfers]), 200


@api_bp.route("/inventory/transfer/<int:transfer_id>/accept", methods=["POST"])
@login_required
def accept_transfer(transfer_id):
    """Accept a pending transfer - adds stock to receiving facility (already deducted from sender at initiation)."""
    transfer = FacilityTransfer.query.get_or_404(transfer_id)
    facility = current_user.facility

    if not facility:
        return jsonify({"error": "No facility assigned"}), 400
    if transfer.to_facility.lower() != facility.lower():
        return jsonify({"error": "This transfer is not addressed to your facility"}), 403
    if transfer.status != "pending":
        return jsonify({"error": f"Cannot accept transfer with status '{transfer.status}'"}), 400

    # Add to receiver's stock (upsert) — sender was already deducted at initiation
    receiver_stock = FacilityStock.query.filter_by(facility=transfer.to_facility, tool_id=transfer.tool_id).first()
    if receiver_stock:
        receiver_stock.quantity += transfer.quantity
    else:
        receiver_stock = FacilityStock(
            facility=transfer.to_facility,
            tool_id=transfer.tool_id,
            quantity=transfer.quantity
        )
        db.session.add(receiver_stock)

    transfer.status = "accepted"
    transfer.responded_by = current_user.id
    transfer.responded_at = datetime.utcnow()

    db.session.commit()
    return jsonify(transfer.to_dict()), 200


@api_bp.route("/inventory/transfer/<int:transfer_id>/reject", methods=["POST"])
@login_required
def reject_transfer(transfer_id):
    """Reject a pending transfer — returns stock to sender."""
    transfer = FacilityTransfer.query.get_or_404(transfer_id)
    facility = current_user.facility

    if not facility:
        return jsonify({"error": "No facility assigned"}), 400
    if transfer.to_facility.lower() != facility.lower():
        return jsonify({"error": "This transfer is not addressed to your facility"}), 403
    if transfer.status != "pending":
        return jsonify({"error": f"Cannot reject transfer with status '{transfer.status}'"}), 400

    # Return stock to sender
    sender_stock = FacilityStock.query.filter_by(facility=transfer.from_facility, tool_id=transfer.tool_id).first()
    if sender_stock:
        sender_stock.quantity += transfer.quantity
    else:
        sender_stock = FacilityStock(
            facility=transfer.from_facility,
            tool_id=transfer.tool_id,
            quantity=transfer.quantity
        )
        db.session.add(sender_stock)

    transfer.status = "rejected"
    transfer.responded_by = current_user.id
    transfer.responded_at = datetime.utcnow()

    db.session.commit()
    return jsonify(transfer.to_dict()), 200


@api_bp.route("/inventory/transfer/<int:transfer_id>/cancel", methods=["POST"])
@login_required
def cancel_transfer(transfer_id):
    """Cancel a pending transfer (sender withdraws it)."""
    transfer = FacilityTransfer.query.get_or_404(transfer_id)
    facility = current_user.facility

    if not facility:
        return jsonify({"error": "No facility assigned"}), 400
    if transfer.from_facility.lower() != facility.lower():
        return jsonify({"error": "You can only cancel transfers you initiated"}), 403
    if transfer.status != "pending":
        return jsonify({"error": f"Cannot cancel transfer with status '{transfer.status}'"}), 400

    # Return stock to sender
    sender_stock = FacilityStock.query.filter_by(facility=transfer.from_facility, tool_id=transfer.tool_id).first()
    if sender_stock:
        sender_stock.quantity += transfer.quantity
    else:
        sender_stock = FacilityStock(
            facility=transfer.from_facility,
            tool_id=transfer.tool_id,
            quantity=transfer.quantity
        )
        db.session.add(sender_stock)

    transfer.status = "cancelled"
    db.session.commit()
    return jsonify(transfer.to_dict()), 200


@api_bp.route("/inventory/transfer/all", methods=["GET"])
@login_required
def admin_list_all_transfers():
    """Admin: list all facility transfers across all facilities."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    transfers = (
        FacilityTransfer.query
        .order_by(FacilityTransfer.created_at.desc())
        .limit(100)
        .all()
    )
    return jsonify([t.to_dict() for t in transfers]), 200


# -----------------------
# Dashboard Summary (HQ)
# -----------------------

@api_bp.route("/admin/dashboard-summary", methods=["GET"])
@login_required
def admin_dashboard_summary():
    """HQ admin dashboard summary"""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    total_facilities = db.session.query(func.count(func.distinct(Users.facility))).filter(Users.facility.isnot(None), Users.facility != "").scalar() or 0
    
    total_tools = Tool.query.count()
    
    pending_requests = RequestModel.query.filter(func.lower(RequestModel.status) == "pending").count()
    
    total_users = Users.query.count()

    # Stock across all facilities
    total_stock = db.session.query(func.sum(FacilityStock.quantity)).scalar() or 0

    # Department distribution summary across all facilities
    dept_summary = (
        db.session.query(
            DepartmentDistribution.department,
            func.sum(DepartmentDistribution.quantity).label("total")
        )
        .group_by(DepartmentDistribution.department)
        .all()
    )

    # Recent physical count discrepancies
    recent_discrepancies = (
        PhysicalStockCount.query
        .filter(PhysicalStockCount.discrepancy != 0)
        .order_by(PhysicalStockCount.counted_at.desc())
        .limit(10)
        .all()
    )

    # Facility-wise stock summary
    facility_stocks = (
        db.session.query(
            FacilityStock.facility,
            func.sum(FacilityStock.quantity).label("total")
        )
        .group_by(FacilityStock.facility)
        .order_by(func.sum(FacilityStock.quantity).desc())
        .all()
    )

    return jsonify({
        "summary": {
            "total_facilities": total_facilities,
            "total_tools": total_tools,
            "total_users": total_users,
            "pending_requests": pending_requests,
            "total_stock_items": int(total_stock),
        },
        "department_summary": [{"department": r[0], "total": int(r[1])} for r in dept_summary],
        "recent_discrepancies": [d.to_dict() for d in recent_discrepancies],
        "facility_stocks": [{"facility": r[0], "total": int(r[1])} for r in facility_stocks],
    }), 200


@api_bp.route("/admin/facility/<path:facility_name>/stock", methods=["GET"])
@login_required
def admin_facility_stock(facility_name):
    """Admin: view stock of a specific facility"""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    stocks = FacilityStock.query.filter_by(facility=facility_name).order_by(FacilityStock.tool_id).all()

    distributions = (
        DepartmentDistribution.query
        .filter_by(facility=facility_name)
        .order_by(DepartmentDistribution.date_distributed.desc())
        .all()
    )

    return jsonify({
        "facility": facility_name,
        "stocks": [s.to_dict() for s in stocks],
        "distributions": [d.to_dict() for d in distributions]
    }), 200


@api_bp.route("/admin/facility/<path:facility_name>/physical-counts", methods=["GET"])
@login_required
def admin_facility_physical_counts(facility_name):
    """Admin: view physical stock count history for a facility.
    System quantity shown is the state-wide stock (all facilities combined)."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    counts = (
        PhysicalStockCount.query
        .filter_by(facility=facility_name)
        .order_by(PhysicalStockCount.counted_at.desc())
        .all()
    )

    result = []
    for c in counts:
        # Compute state-wide system quantity for this tool
        all_stocks = FacilityStock.query.filter_by(tool_id=c.tool_id).all()
        opening = sum((s.opening_balance + s.qty_received) for s in all_stocks)

        delivered = int(db.session.query(func.coalesce(func.sum(Delivery.quantity_supplied), 0))
            .filter(Delivery.tool_id == c.tool_id, Delivery.is_delivered == True).scalar() or 0)

        received = int(db.session.query(func.coalesce(func.sum(StockReceiptLine.quantity_received), 0))
            .filter(StockReceiptLine.tool_id == c.tool_id).scalar() or 0)

        transfers_in = int(db.session.query(func.coalesce(func.sum(FacilityTransfer.quantity), 0))
            .filter(FacilityTransfer.tool_id == c.tool_id,
                    FacilityTransfer.status == 'accepted').scalar() or 0)

        distributed = int(db.session.query(func.coalesce(func.sum(DepartmentDistribution.quantity), 0))
            .filter(DepartmentDistribution.tool_id == c.tool_id).scalar() or 0)

        transfers_out = int(db.session.query(func.coalesce(func.sum(FacilityTransfer.quantity), 0))
            .filter(FacilityTransfer.tool_id == c.tool_id,
                    FacilityTransfer.status.in_(['pending', 'accepted'])).scalar() or 0)

        state_quantity = opening + delivered + received + transfers_in - distributed - transfers_out

        d = c.to_dict()
        d["system_quantity"] = state_quantity
        d["discrepancy"] = c.physical_quantity - state_quantity
        d["has_discrepancy"] = (c.physical_quantity - state_quantity) != 0
        result.append(d)

    return jsonify(result), 200



@api_bp.route("/signup", methods=["POST"])
def signup():
    data = _json_body()
    
    role_req = (data.get("role") or "").strip().lower()
    admin_key = (data.get("admin_key") or "").strip()
    admin_signup_key = (os.getenv("ADMIN_SIGNUP_KEY") or "").strip()

    final_role = role_req if role_req else "user"

    if final_role in ("admin", "administrator", "superadmin", "super_admin", "superuser"):
        if not admin_signup_key or admin_key != admin_signup_key:
            return jsonify({"error": "Invalid admin key"}), 403
        final_role = "admin"
    else:
        final_role = "user"

    email = (data.get("email") or "").strip().lower()
    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()
    first_name = (data.get("first_name") or "").strip()
    facility = (data.get("facility") or "").strip()

    if not email and username:
        email = username
    if not username and email:
        username = email

    if not email or not username or not password:
        return jsonify({"error": "email/username and password required"}), 400

    if Users.query.filter(func.lower(Users.email) == email).first():
        return jsonify({"error": "Email already registered"}), 400
    if Users.query.filter(func.lower(Users.username) == username).first():
        return jsonify({"error": "Username already registered"}), 400

    u = Users(email=email, username=username, first_name=first_name, facility=facility)

    # Always hash password with pbkdf2 for compatibility
    if hasattr(u, "set_password"):
        u.set_password(password)
    else:
        u.password = _hash_password(password)

    if hasattr(u, "role"):
        u.role = final_role
    if hasattr(u, "roles"):
        u.roles = final_role

    db.session.add(u)
    db.session.commit()
    return jsonify({"message": "ok"}), 201


@api_bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "ok"}), 200


# -----------------------
# Tools
# -----------------------

@api_bp.route("/tools", methods=["GET"])
@login_required
def list_tools():
    category_id = request.args.get("category_id")
    q = (request.args.get("q") or "").strip()

    query = Tool.query

    if category_id:
        try:
            query = query.filter(Tool.category_id == int(category_id))
        except Exception:
            pass

    if q:
        like = f"%{q}%"
        query = query.filter(
            (Tool.name.ilike(like)) | (Tool.description.ilike(like))
        )

    tools = query.order_by(Tool.name.asc()).all()
    return jsonify([_tool_dict(t) for t in tools]), 200


@api_bp.route("/tools", methods=["POST"])
@login_required
def create_tool():
    if not _is_admin_user(current_user):
        return _admin_required_json()

    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Tool name is required"}), 400

    description = (data.get("description") or "").strip()
    quantity = data.get("quantity", 0)
    category_id = data.get("category_id", None)

    try:
        quantity = int(quantity)
    except Exception:
        return jsonify({"error": "quantity must be a number"}), 400

    if category_id in ("", None):
        category_id = None
    else:
        try:
            category_id = int(category_id)
        except Exception:
            return jsonify({"error": "category_id must be a number"}), 400

        if category_id:
            cat = ToolCategory.query.get(category_id)
            if not cat:
                return jsonify({"error": "Category not found"}), 400

    t = Tool(name=name, description=description, quantity=quantity, category_id=category_id)
    db.session.add(t)
    db.session.commit()
    return jsonify(_tool_dict(t)), 201


@api_bp.route("/tools/<int:tool_id>", methods=["PUT"])
@login_required
def update_tool(tool_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    t = Tool.query.get_or_404(tool_id)
    data = request.get_json(force=True) or {}

    if "name" in data:
        t.name = (data.get("name") or "").strip() or t.name

    if "description" in data:
        t.description = (data.get("description") or "").strip()

    if "quantity" in data:
        try:
            t.quantity = int(data.get("quantity"))
        except Exception:
            return jsonify({"error": "quantity must be a number"}), 400

    if "category_id" in data:
        cid = data.get("category_id")
        if cid in ("", None):
            t.category_id = None
        else:
            try:
                cid = int(cid)
            except Exception:
                return jsonify({"error": "category_id must be a number"}), 400

            cat = ToolCategory.query.get(cid)
            if not cat:
                return jsonify({"error": "Category not found"}), 400
            t.category_id = cid

    db.session.commit()
    return jsonify(_tool_dict(t)), 200


@api_bp.route("/tools/<int:tool_id>", methods=["DELETE"])
@login_required
def delete_tool(tool_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    data = request.get_json(silent=True) or {}
    password = data.get("password")
    if password is not None:
        if (current_user.password or "") != str(password):
            return jsonify({"error": "Invalid password"}), 400

    t = Tool.query.get_or_404(tool_id)
    db.session.delete(t)
    db.session.commit()
    return jsonify({"ok": True}), 200


@api_bp.route("/tools/<int:tool_id>/logs", methods=["GET"])
@login_required
def tool_logs(tool_id):
    tool = Tool.query.get_or_404(tool_id)

    logs = []

    usage_rows = (
        db.session.query(ToolUsage, Users)
        .join(Users, Users.id == ToolUsage.user_id)
        .filter(ToolUsage.tool_id == tool_id)
        .order_by(ToolUsage.date_used.desc())
        .all()
    )
    for usage, user in usage_rows:
        logs.append({
            "date": usage.date_used.isoformat() if usage.date_used else None,
            "quantity": int(usage.quantity_used or 0),
            "user_name": user.first_name if user else None,
            "facility": user.facility if user else None,
            "source": "tool_usage",
            "id": usage.id
        })

    if not logs:
        approved_lines = (
            db.session.query(RequestedTool, RequestModel, Users)
            .join(RequestModel, RequestModel.id == RequestedTool.request_id)
            .join(Users, Users.id == RequestModel.user_id)
            .filter(RequestedTool.tool_id == tool_id)
            .filter(
                (func.lower(RequestModel.status) == "approved") |
                (func.lower(RequestedTool.status) == "approved")
            )
            .order_by(
                RequestModel.date_approved.desc().nullslast(),
                RequestModel.date_requested.desc()
            )
            .all()
        )

        for rt, req, user in approved_lines:
            when = req.date_approved or req.date_requested
            logs.append({
                "date": when.isoformat() if when else None,
                "quantity": int(rt.quantity or 0),
                "user_name": user.first_name if user else None,
                "facility": user.facility if user else None,
                "request_id": req.id,
                "request_status": req.status,
                "line_status": rt.status,
                "source": "request_or_line_approved",
                "id": rt.id
            })

    return jsonify({
        "tool_id": tool.id,
        "tool_name": tool.name,
        "distributions": logs,
        "logs": logs,
        "data": logs
    }), 200


@api_bp.route("/tools/<int:tid>/checkout", methods=["POST"])
@login_required
def checkout_tool(tid):
    tool = Tool.query.get_or_404(tid)
    data = _json_body()

    qty = _safe_int(data.get("quantity"), 0)
    if qty <= 0:
        qty = 1

    if (tool.quantity or 0) < qty:
        return jsonify({"error": "insufficient stock"}), 400

    tool.quantity = (tool.quantity or 0) - qty
    db.session.add(tool)

    try:
        usage = ToolUsage(
            tool_id=tool.id,
            user_id=current_user.id,
            quantity_used=qty,
            date_used=datetime.utcnow(),
        )
        db.session.add(usage)
    except Exception:
        current_app.logger.exception("Failed to log ToolUsage on checkout")

    db.session.commit()
    return jsonify({"message": "ok"}), 200


@api_bp.route("/tools/<int:tid>/checkin", methods=["POST"])
@login_required
def checkin_tool(tid):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    tool = Tool.query.get_or_404(tid)
    data = _json_body()
    qty = _safe_int(data.get("quantity"), 0)

    if qty <= 0:
        qty = 1

    tool.quantity = (tool.quantity or 0) + qty
    db.session.add(tool)
    db.session.commit()
    return jsonify({"message": "ok"}), 200


@api_bp.route("/debug/tool-logs/<int:tool_id>", methods=["GET"])
@login_required
def debug_tool_logs(tool_id):
    usage_count = ToolUsage.query.filter(ToolUsage.tool_id == tool_id).count()

    approved_line_count = (
        db.session.query(RequestedTool)
        .join(RequestModel, RequestModel.id == RequestedTool.request_id)
        .filter(RequestedTool.tool_id == tool_id)
        .filter(
            (func.lower(RequestModel.status) == "approved") |
            (func.lower(RequestedTool.status) == "approved")
        )
        .count()
    )

    return jsonify({
        "tool_id": tool_id,
        "toolusage_rows_for_tool": usage_count,
        "approved_requestedtool_rows_for_tool": approved_line_count
    }), 200


@api_bp.route("/tools/export", methods=["GET"])
@login_required
def export_tools_csv():
    tools = Tool.query.options(joinedload(Tool.category)).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "name", "description", "quantity", "category"])

    for t in tools:
        cat = t.category.name if getattr(t, "category", None) else ""
        writer.writerow([t.id, t.name, t.description or "", t.quantity or 0, cat])

    return output.getvalue(), 200, {"Content-Type": "text/csv; charset=utf-8"}


@api_bp.route("/tools/import", methods=["POST"])
@login_required
def import_tools_csv():
    if not _is_admin_user(current_user):
        return _admin_required_json()

    if "file" not in request.files:
        return jsonify({"error": "file required"}), 400

    f = request.files["file"]
    raw = f.read().decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(raw))

    created = 0
    updated = 0

    for row in reader:
        name = (row.get("name") or "").strip()
        if not name:
            continue

        qty = _safe_int(row.get("quantity"), 0)
        desc = (row.get("description") or "").strip()
        cat_name = (row.get("category") or "").strip()

        category_id = None
        if cat_name:
            cat = ToolCategory.query.filter(func.lower(ToolCategory.name) == cat_name.lower()).first()
            if not cat:
                cat = ToolCategory(name=cat_name)
                db.session.add(cat)
                db.session.flush()
            category_id = cat.id

        tool = Tool.query.filter(func.lower(Tool.name) == name.lower()).first()
        if tool:
            tool.description = desc
            tool.quantity = qty
            if category_id:
                tool.category_id = category_id
            updated += 1
        else:
            tool = Tool(name=name, description=desc, quantity=qty, category_id=category_id)
            db.session.add(tool)
            created += 1

    db.session.commit()
    return jsonify({"message": "ok", "created": created, "updated": updated}), 200


# -----------------------
# Categories / Users / Catalog
# -----------------------

@api_bp.route("/categories", methods=["GET"])
@login_required
def list_categories():
    cats = ToolCategory.query.order_by(ToolCategory.name.asc()).all()
    return jsonify([_cat_dict(c) for c in cats]), 200


@api_bp.route("/users", methods=["GET"])
@login_required
def list_users():
    if not _is_admin_user(current_user):
        return _admin_required_json()

    users = Users.query.all()
    out = []
    for u in users:
        out.append({
            "id": u.id,
            "username": getattr(u, "username", None),
            "email": getattr(u, "email", None),
            "first_name": getattr(u, "first_name", None),
            "facility": getattr(u, "facility", None),
            "role": getattr(u, "role", getattr(u, "roles", None)),
        })
    return jsonify(out), 200


@api_bp.route("/catalog", methods=["GET"])
@login_required
def catalog():
    try:
        cats = ToolCategory.query.order_by(ToolCategory.name.asc()).all()
        tools = Tool.query.order_by(Tool.name.asc()).all()

        tools_by_cat = {}
        for t in tools:
            tools_by_cat.setdefault(t.category_id, []).append(_tool_dict(t))

        out = []
        for c in cats:
            out.append({
                "id": c.id,
                "category": c.name,
                "tools": tools_by_cat.get(c.id, [])
            })

        if tools_by_cat.get(None):
            out.append({
                "id": -1,
                "category": "Uncategorized",
                "tools": tools_by_cat.get(None, [])
            })

        return jsonify(out), 200
    except Exception:
        current_app.logger.exception("catalog failed")
        return jsonify([]), 200


# -----------------------
# Requests (User)
# -----------------------

@api_bp.route("/requests", methods=["POST"])
@login_required
def create_request():
    data = _json_body()
    items = data.get("items") or data.get("lines") or []

    if not isinstance(items, list) or not items:
        return jsonify({"error": "items required"}), 400

    r = RequestModel(
        user_id=current_user.id,
        status="Pending",
        date_requested=datetime.utcnow()
    )
    db.session.add(r)
    db.session.flush()

    for it in items:
        tid = it.get("tool_id") or it.get("id")
        qty = _safe_int(it.get("quantity"), 0)
        if not tid or qty <= 0:
            continue
        db.session.add(RequestedTool(
            request_id=r.id,
            tool_id=int(tid),
            quantity=qty,
            status="Pending"
        ))

    db.session.commit()
    return jsonify({"message": "ok", "id": r.id}), 201


@api_bp.route("/requests", methods=["GET"])
@login_required
def list_my_requests():
    reqs = (
        RequestModel.query.options(
            joinedload(RequestModel.requested_tools).joinedload(RequestedTool.tool)
        )
        .filter_by(user_id=current_user.id)
        .order_by(RequestModel.date_requested.desc())
        .all()
    )

    out = []
    for r in reqs:
        out.append({
            "id": r.id,
            "status": r.status,
            "date_requested": _iso(r.date_requested),
            "lines": [
                {
                    "id": ln.id,
                    "tool_id": ln.tool_id,
                    "tool_name": ln.tool.name if ln.tool else "",
                    "quantity": ln.quantity,
                    "status": ln.status,
                }
                for ln in (r.requested_tools or [])
            ]
        })

    return jsonify(out), 200


# -----------------------
# Admin Requests
# -----------------------

@api_bp.route("/admin/requests", methods=["GET"])
@login_required
def admin_list_requests():
    if not _is_admin_user(current_user):
        return _admin_required_json()

    status_filter = (request.args.get("status") or "").strip().lower()

    q = RequestModel.query.options(
        joinedload(RequestModel.user),
        joinedload(RequestModel.requested_tools).joinedload(RequestedTool.tool).joinedload(Tool.category)
    )

    if status_filter:
        q = q.filter(func.lower(RequestModel.status) == status_filter)

    reqs = q.order_by(RequestModel.date_requested.desc()).all()

    out = []
    for r in reqs:
        user = getattr(r, "user", None)

        first_name = (getattr(user, "first_name", "") or "").strip() if user else ""
        other_name = (getattr(user, "other_name", "") or "").strip() if user else ""
        username   = (getattr(user, "username", "") or "").strip() if user else ""
        email      = (getattr(user, "email", "") or "").strip() if user else ""
        facility   = (getattr(user, "facility", "") or "").strip() if user else ""

        display_name = " ".join([n for n in [first_name, other_name] if n]).strip()
        if not display_name:
            display_name = username or email or ""

        lines = []
        total_qty = 0
        for ln in (r.requested_tools or []):
            qty = int(ln.quantity or 0)
            total_qty += qty

            tool_obj = getattr(ln, "tool", None)
            tool_name = (getattr(tool_obj, "name", "") or "").strip() if tool_obj else ""

            # Check if delivery exists and is confirmed
            delivery = Delivery.query.filter_by(requested_tool_id=ln.id).first()
            is_delivered = delivery.is_delivered if delivery else False

            line_payload = {
                "id": ln.id,
                "line_id": ln.id,
                "tool_id": ln.tool_id,
                "tool_name": tool_name,
                "tool": tool_name,
                "name": tool_name,
                "quantity": qty,
                "qty": qty,
                "status": ln.status,
                "in_stock": int(getattr(tool_obj, "quantity", 0) or 0) if tool_obj else 0,
                "stock": int(getattr(tool_obj, "quantity", 0) or 0) if tool_obj else 0,
                "available": int(getattr(tool_obj, "quantity", 0) or 0) if tool_obj else 0,
                "is_delivered": is_delivered,
                "delivery_id": delivery.id if delivery else None,
                "category": (
                    tool_obj.category.name
                    if tool_obj and getattr(tool_obj, "category", None)
                    else ""
                ),
            }
            lines.append(line_payload)

        summary = {
            "total_lines": len(lines),
            "total_items": int(total_qty),
        }

        payload = {
            "id": r.id,
            "request_id": r.id,
            "status": r.status,
            "date_requested": _iso(getattr(r, "date_requested", None)),
            "date": _iso(getattr(r, "date_requested", None)),
            "requested_by": display_name,
            "requestedBy": display_name,
            "requester": display_name,
            "requester_name": display_name,
            "user": display_name,
            "user_name": display_name,
            "username": username,
            "email": email,
            "facility": facility,
            "facility_name": facility,
            "user_facility": facility,
            "lines": lines,
            "requested_tools": lines,
            "tools": lines,
            "items": lines,
            "summary": summary,
            "totals": summary,
        }

        out.append(payload)

    return jsonify(out), 200


@api_bp.route("/admin/requests/<int:req_id>/approve", methods=["POST"])
@login_required
def admin_approve_request(req_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    r = (
        RequestModel.query.options(
            joinedload(RequestModel.requested_tools).joinedload(RequestedTool.tool)
        )
        .get(req_id)
    )

    if not r:
        return jsonify({"error": "Request not found"}), 404

    if (r.status or "").lower() != "pending":
        return jsonify({"error": "Only pending requests can be approved"}), 400

    now = datetime.utcnow()

    for ln in (r.requested_tools or []):
        tool = ln.tool
        if not tool:
            continue

        need = int(ln.quantity or 0)
        if need <= 0:
            continue

        if int(tool.quantity or 0) < need:
            return jsonify({"error": f"Insufficient stock for {tool.name}"}), 400

        tool.quantity = int(tool.quantity or 0) - need
        ln.status = "Approved"

        db.session.add(ToolUsage(
            tool_id=ln.tool_id,
            user_id=r.user_id,
            quantity_used=need,
            date_used=now
        ))

        db.session.add(tool)

    r.status = "Approved"
    if hasattr(r, "date_approved"):
        r.date_approved = now
    if hasattr(r, "approved_by_id"):
        r.approved_by_id = current_user.id

    # ---------- Auto-generate Delivery records & PDF notes ----------
    requester = Users.query.get(r.user_id) if r.user_id else None
    delivery_ids = []
    for ln in (r.requested_tools or []):
        if (ln.status or "").lower() != "approved":
            continue
        tool = ln.tool
        if not tool:
            continue

        # Create a Delivery record for this approved line item
        delivery = Delivery(
            request_id=r.id,
            tool_id=ln.tool_id,
            requested_tool_id=ln.id,
            quantity_supplied=int(ln.quantity or 0),
            basic_unit="unit",
            distributed_by=current_user.id,
            received_by=r.user_id,
            witnessed_by="",
            delivery_date=now,
            is_delivered=False,  # Awaiting facility user confirmation
        )
        db.session.add(delivery)
        db.session.flush()  # get delivery.id

        # Generate and save the delivery note PDF
        pdf_data = None
        try:
            pdf_data = create_delivery_note_pdf(
                delivery=delivery,
                tool=tool,
                requester=requester or current_user,
                distributor=current_user,
                request_obj=r,
            )
        except Exception:
            current_app.logger.exception("Failed to generate delivery note PDF")
            continue

        # Save PDF to disk
        if pdf_data:
            dl_dir = _downloads_dir()
            timestamp = now.strftime("%Y%m%d_%H%M%S")
            filename = f"delivery_note_{delivery.id}_{timestamp}.pdf"
            out_path = dl_dir / filename
            try:
                out_path.write_bytes(pdf_data)
                delivery.delivery_note_path = str(out_path)
                delivery.delivery_note_generated_at = now
            except Exception:
                current_app.logger.exception("Failed to save delivery note to disk")
                # Still commit the Delivery record even if file save fails
                delivery.delivery_note_path = None
                delivery.delivery_note_generated_at = now

        delivery_ids.append(delivery.id)

    db.session.commit()

    # Send notification to admins about the approval + delivery notes
    if requester:
        try:
            send_notification_to_admins({
                "type": "request_approved",
                "title": "Request Approved & Delivery Notes Generated",
                "message": f"Request #{r.id} for {requester.first_name or requester.username} approved. "
                           f"{len(delivery_ids)} delivery note(s) generated.",
                "request_id": r.id,
                "delivery_ids": delivery_ids,
                "facility": requester.facility or "Unknown",
                "timestamp": now.isoformat()
            })
        except Exception:
            pass  # Notification is best-effort

    return jsonify({
        "message": "approved",
        "delivery_ids": delivery_ids,
        "delivery_notes_generated": len(delivery_ids)
    }), 200


@api_bp.route("/admin/requests/<int:req_id>/reject", methods=["POST"])
@login_required
def admin_reject_request(req_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    r = RequestModel.query.options(joinedload(RequestModel.requested_tools)).get(req_id)
    if not r:
        return jsonify({"error": "Request not found"}), 404

    if (r.status or "").lower() != "pending":
        return jsonify({"error": "Only pending requests can be rejected"}), 400

    data = _json_body()
    reason = (data.get("reason") or data.get("rejection_reason") or "").strip()

    r.status = "Rejected"
    if hasattr(r, "date_rejected"):
        r.date_rejected = datetime.utcnow()
    if hasattr(r, "rejected_by_id"):
        r.rejected_by_id = current_user.id
    if hasattr(r, "rejection_reason"):
        r.rejection_reason = reason

    for ln in (r.requested_tools or []):
        ln.status = "Rejected"

    db.session.commit()
    return jsonify({"message": "rejected"}), 200


@api_bp.route("/admin/requests/<int:req_id>", methods=["PUT"])
@login_required
def admin_edit_request(req_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    r = RequestModel.query.options(joinedload(RequestModel.requested_tools)).get(req_id)
    if not r:
        return jsonify({"error": "Request not found"}), 404

    if (r.status or "").lower() != "pending":
        return jsonify({"error": "Only pending requests can be edited"}), 400

    data = _json_body()
    lines = data.get("lines") or []
    if not isinstance(lines, list):
        return jsonify({"error": "lines must be a list"}), 400

    line_map = {ln.id: ln for ln in (r.requested_tools or [])}
    for patch in lines:
        lid = patch.get("id")
        if lid not in line_map:
            return jsonify({"error": f"line id {lid} not found"}), 404

        ln = line_map[lid]
        if "quantity" in patch:
            ln.quantity = _safe_int(patch.get("quantity"), ln.quantity or 0)
        if "status" in patch:
            ln.status = patch.get("status")

    db.session.commit()
    return jsonify({"message": "updated"}), 200


@api_bp.route("/admin/requests/<int:req_id>", methods=["DELETE"])
@login_required
def admin_delete_request(req_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    r = RequestModel.query.options(joinedload(RequestModel.requested_tools)).get(req_id)
    if not r:
        return jsonify({"error": "Request not found"}), 404

    if (r.status or "").lower() != "pending":
        return jsonify({"error": "Only pending requests can be deleted"}), 400

    db.session.delete(r)
    db.session.commit()
    return jsonify({"message": "deleted"}), 200


@api_bp.route("/admin/pending-count", methods=["GET"])
@login_required
def admin_pending_count():
    if not _is_admin_user(current_user):
        return jsonify({"pending": 0}), 200

    pending = (
        db.session.query(func.count(RequestModel.id))
        .filter(func.lower(RequestModel.status) == "pending")
        .scalar()
        or 0
    )
    return jsonify({"pending": int(pending)}), 200


# -----------------------
# Delivery Management
# -----------------------

@api_bp.route("/delivery/confirm/<int:requested_tool_id>", methods=["POST"])
@login_required
def confirm_delivery(requested_tool_id):
    """Facility user confirms they have received the approved tool."""
    requested_tool = RequestedTool.query.get_or_404(requested_tool_id)
    
    request_obj = RequestModel.query.get(requested_tool.request_id)
    if not request_obj or request_obj.user_id != current_user.id:
        return jsonify({"error": "Unauthorized - This request doesn't belong to you"}), 403
    
    existing_delivery = Delivery.query.filter_by(requested_tool_id=requested_tool_id).first()
    if existing_delivery and existing_delivery.is_delivered:
        return jsonify({"error": "Delivery already confirmed for this item"}), 400
    
    if request_obj.status.lower() != "approved":
        return jsonify({"error": "Only approved requests can be confirmed as delivered"}), 400
    
    data = _json_body()
    witnessed_by = data.get("witnessed_by", "").strip()
    basic_unit = data.get("basic_unit", "unit")
    
    tool = Tool.query.get(requested_tool.tool_id)
    
    if existing_delivery:
        delivery = existing_delivery
        delivery.is_delivered = True
        delivery.delivery_confirmed_at = datetime.utcnow()
        delivery.witnessed_by = witnessed_by
    else:
        delivery = Delivery(
            request_id=request_obj.id,
            tool_id=requested_tool.tool_id,
            requested_tool_id=requested_tool_id,
            quantity_supplied=requested_tool.quantity,
            basic_unit=basic_unit,
            received_by=current_user.id,
            witnessed_by=witnessed_by,
            delivery_date=datetime.utcnow(),
            delivery_confirmed_at=datetime.utcnow(),
            is_delivered=True
        )
        db.session.add(delivery)
    
    db.session.commit()
    
    # Send real-time notification to admins
    requester_name = current_user.first_name or current_user.username
    facility = current_user.facility or "Unknown Facility"
    
    send_notification_to_admins({
        "type": "delivery_confirmed",
        "title": "Delivery Confirmed!",
        "message": f"{requester_name} from {facility} confirmed receipt of {delivery.quantity_supplied} x {tool.name}",
        "request_id": request_obj.id,
        "delivery_id": delivery.id,
        "tool_name": tool.name,
        "quantity": delivery.quantity_supplied,
        "facility": facility,
        "requester": requester_name,
        "timestamp": datetime.utcnow().isoformat()
    })
    
    return jsonify({
        "message": "Delivery confirmed successfully",
        "delivery_id": delivery.id,
        "requires_delivery_note": True
    }), 200

@api_bp.route("/notifications/recent", methods=["GET"])
@login_required
def get_recent_notifications():
    """Get recent notifications for the last 7 days"""
    is_admin = _is_admin_user(current_user)
    
    # Query recent deliveries from last 7 days
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    
    query = db.session.query(
        Delivery,
        Tool,
        Users
    ).outerjoin(
        Tool, Delivery.tool_id == Tool.id
    ).outerjoin(
        Users, Delivery.received_by == Users.id
    ).filter(
        Delivery.delivery_confirmed_at >= seven_days_ago,
        Delivery.is_delivered == True
    )
    
    # For non-admin users, only show their own delivery notifications
    if not is_admin:
        query = query.filter(Delivery.received_by == current_user.id)
    
    recent_deliveries = query.order_by(
        Delivery.delivery_confirmed_at.desc()
    ).limit(50).all()
    
    notifications = []
    # Get all delivery IDs that current user has marked as read
    read_ids = set(
        r[0] for r in db.session.query(NotificationRead.delivery_id)
        .filter(NotificationRead.user_id == current_user.id).all()
    )
    for delivery, tool, user in recent_deliveries:
        tool_name = tool.name if tool else "Unknown Tool"
        user_name = user.first_name or user.username if user else "Unknown"
        user_facility = user.facility if user else "Unknown"
        
        notifications.append({
            "id": delivery.id,
            "type": "delivery_confirmed",
            "title": "📦 Delivery Confirmed",
            "message": f"{user_name} from {user_facility} confirmed receipt of {delivery.quantity_supplied} x {tool_name}",
            "request_id": delivery.request_id,
            "delivery_id": delivery.id,
            "tool_name": tool_name,
            "quantity": delivery.quantity_supplied,
            "facility": user_facility,
            "requester": user_name,
            "timestamp": delivery.delivery_confirmed_at.isoformat() if delivery.delivery_confirmed_at else None,
            "is_read": delivery.id in read_ids
        })
    
    return jsonify(notifications), 200


@api_bp.route("/notifications/mark-read/<int:delivery_id>", methods=["POST"])
@login_required
def mark_notification_read(delivery_id):
    """Mark a single notification as read"""
    existing = NotificationRead.query.filter_by(user_id=current_user.id, delivery_id=delivery_id).first()
    if not existing:
        nr = NotificationRead(user_id=current_user.id, delivery_id=delivery_id)
        db.session.add(nr)
        db.session.commit()
    return jsonify({"status": "ok"}), 200


@api_bp.route("/notifications/mark-all-read", methods=["POST"])
@login_required
def mark_all_notifications_read():
    """Mark all recent notifications as read for the current user"""
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    # Get all delivery IDs that would appear in notifications
    deliveries = db.session.query(Delivery.id).filter(
        Delivery.delivery_confirmed_at >= seven_days_ago,
        Delivery.is_delivered == True
    )
    if not _is_admin_user(current_user):
        deliveries = deliveries.filter(Delivery.received_by == current_user.id)
    
    for (did,) in deliveries.all():
        existing = NotificationRead.query.filter_by(user_id=current_user.id, delivery_id=did).first()
        if not existing:
            nr = NotificationRead(user_id=current_user.id, delivery_id=did)
            db.session.add(nr)
    db.session.commit()
    return jsonify({"status": "ok"}), 200

def _generate_delivery_note_pdf_data(delivery_id):
    """Helper function to generate delivery note PDF data."""
    delivery = Delivery.query.get_or_404(delivery_id)
    
    tool = Tool.query.get(delivery.tool_id)
    if not tool:
        return None, "Associated tool has been deleted. Cannot generate delivery note.", None
    
    requester = Users.query.get(delivery.received_by)
    if not requester:
        return None, "Associated user account not found. Cannot generate delivery note.", None
    
    distributor = None
    if delivery.distributed_by:
        distributor = Users.query.get(delivery.distributed_by)
    else:
        if _is_admin_user(current_user):
            delivery.distributed_by = current_user.id
            distributor = current_user
            db.session.commit()
    
    if not distributor:
        distributor = current_user
    
    request_obj = RequestModel.query.get(delivery.request_id)
    
    try:
        pdf_data = create_delivery_note_pdf(
            delivery=delivery,
            tool=tool,
            requester=requester,
            distributor=distributor,
            request_obj=request_obj
        )
        
        filename = f"delivery_note_{delivery.id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        
        return pdf_data, None, filename
        
    except Exception as e:
        current_app.logger.exception("Failed to generate delivery note")
        return None, f"Failed to generate delivery note: {str(e)}", None

@api_bp.route("/delivery/generate-note/<int:delivery_id>", methods=["POST"])
@login_required
def generate_delivery_note(delivery_id):
    """Generate PDF delivery note for confirmed delivery."""
    delivery = Delivery.query.get_or_404(delivery_id)
    request_obj = RequestModel.query.get(delivery.request_id)
    is_authorized = (
        _is_admin_user(current_user) or 
        (request_obj and request_obj.user_id == current_user.id)
    )
    
    if not is_authorized:
        return _admin_required_json()
    
    pdf_data, error, filename = _generate_delivery_note_pdf_data(delivery_id)
    if error:
        return jsonify({"error": error}), 404 if "deleted" in error or "not found" in error else 500
    
    return send_file(
        BytesIO(pdf_data),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=filename
    )


@api_bp.route("/delivery/pending-confirmations", methods=["GET"])
@login_required
def get_pending_delivery_confirmations():
    """Admin endpoint: Get all approved deliveries waiting for facility user confirmation."""
    if not _is_admin_user(current_user):
        return _admin_required_json()
    
    confirmed_deliveries = db.session.query(Delivery.requested_tool_id).filter(
        Delivery.is_delivered == True
    ).subquery()
    
    pending = db.session.query(
        RequestedTool,
        RequestModel,
        Tool,
        Users
    ).join(
        RequestModel, RequestedTool.request_id == RequestModel.id
    ).join(
        Tool, RequestedTool.tool_id == Tool.id
    ).join(
        Users, RequestModel.user_id == Users.id
    ).filter(
        RequestedTool.status == "Approved",
        RequestModel.status == "Approved",
        not_(RequestedTool.id.in_(confirmed_deliveries))
    ).all()
    
    result = []
    for rt, req, tool, user in pending:
        result.append({
            "requested_tool_id": rt.id,
            "request_id": req.id,
            "tool_name": tool.name,
            "quantity": rt.quantity,
            "facility": user.facility,
            "requested_by": user.first_name or user.username,
            "request_date": req.date_requested.isoformat() if req.date_requested else None,
            "approval_date": req.date_approved.isoformat() if req.date_approved else None
        })
    
    return jsonify(result), 200


@api_bp.route("/delivery/my-confirmations", methods=["GET"])
@login_required
def get_my_delivery_confirmations():
    """Facility user endpoint: Get their own deliveries that need confirmation or are confirmed."""
    my_approved = db.session.query(
        RequestedTool,
        RequestModel,
        Tool
    ).join(
        RequestModel, RequestedTool.request_id == RequestModel.id
    ).join(
        Tool, RequestedTool.tool_id == Tool.id
    ).filter(
        RequestModel.user_id == current_user.id,
        RequestedTool.status == "Approved",
        RequestModel.status == "Approved"
    ).all()
    
    result = []
    for rt, req, tool in my_approved:
        delivery = Delivery.query.filter_by(requested_tool_id=rt.id).first()
        
        result.append({
            "requested_tool_id": rt.id,
            "request_id": req.id,
            "tool_name": tool.name,
            "quantity": rt.quantity,
            "is_delivered": delivery.is_delivered if delivery else False,
            "delivery_id": delivery.id if delivery else None,
            "can_confirm": not (delivery and delivery.is_delivered),
            "can_download_note": delivery and delivery.is_delivered,
            "basic_unit": delivery.basic_unit if delivery else "unit"
        })
    
    return jsonify(result), 200


@api_bp.route("/delivery/note/<int:delivery_id>/download", methods=["GET"])
@login_required
def download_delivery_note(delivery_id):
    """Download an existing delivery note."""
    delivery = Delivery.query.get_or_404(delivery_id)
    
    request_obj = RequestModel.query.get(delivery.request_id)
    is_authorized = (
        _is_admin_user(current_user) or 
        (request_obj and request_obj.user_id == current_user.id)
    )
    
    if not is_authorized:
        return _admin_required_json()
    
    pdf_data, error, filename = _generate_delivery_note_pdf_data(delivery_id)
    if error:
        return jsonify({"error": error}), 404 if "deleted" in error or "not found" in error else 500
    
    return send_file(
        BytesIO(pdf_data),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=filename
    )



@api_bp.route("/delivery/confirmed", methods=["GET"])
@login_required
def list_confirmed_delivery_notes():
    """List all confirmed delivery notes. Facility users see only their own; admins see all."""
    is_admin = _is_admin_user(current_user)
    
    query = db.session.query(
        Delivery,
        Tool,
        Users,
        RequestModel
    ).outerjoin(
        Tool, Delivery.tool_id == Tool.id
    ).outerjoin(
        Users, Delivery.received_by == Users.id
    ).outerjoin(
        RequestModel, Delivery.request_id == RequestModel.id
    ).filter(
        Delivery.is_delivered == True
    )
    
    # Facility users only see their own delivery notes
    if not is_admin:
        query = query.filter(Delivery.received_by == current_user.id)
    
    deliveries = query.order_by(
        Delivery.delivery_confirmed_at.desc().nullslast(),
        Delivery.delivery_date.desc().nullslast(),
        Delivery.created_at.desc()
    ).all()
    
    result = []
    for delivery, tool, user, req in deliveries:
        tool_name = tool.name if tool else "Unknown Tool"
        user_name = user.first_name or user.username if user else "Unknown"
        user_facility = user.facility if user else "Unknown"
        req_status = req.status if req else "Unknown"
        
        result.append({
            "id": delivery.id,
            "request_id": delivery.request_id,
            "tool_id": delivery.tool_id,
            "tool_name": tool_name,
            "quantity_supplied": delivery.quantity_supplied,
            "basic_unit": delivery.basic_unit,
            "received_by": delivery.received_by,
            "received_by_name": user_name,
            "facility": user_facility,
            "witnessed_by": delivery.witnessed_by,
            "delivery_date": delivery.delivery_date.isoformat() if delivery.delivery_date else None,
            "delivery_confirmed_at": delivery.delivery_confirmed_at.isoformat() if delivery.delivery_confirmed_at else None,
            "request_status": req_status,
            "has_note": bool(delivery.delivery_note_generated_at),
        })
    
    return jsonify(result), 200


# -----------------------
# Reports
# -----------------------

@api_bp.route("/reports/request-summary", methods=["POST"])
@login_required
def generate_request_summary_report():
    """Simplified request summary report."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    data = _json_body()
    start_date_str = data.get("start_date")
    end_date_str = data.get("end_date")
    facilities = data.get("facilities", [])

    out_format = (request.args.get("format") or "xlsx").strip().lower()
    save_local = (request.args.get("save") or "0").strip().lower() in ("1", "true", "yes")

    if not start_date_str or not end_date_str:
        return jsonify({"error": "Start date and end date are required"}), 400

    try:
        start_date = datetime.fromisoformat(str(start_date_str).replace("Z", "+00:00"))
        end_date = datetime.fromisoformat(str(end_date_str).replace("Z", "+00:00"))
        end_date = end_date.replace(hour=23, minute=59, second=59)
    except Exception:
        return jsonify({"error": "Invalid date format"}), 400

    results = db.session.query(
        RequestModel,
        RequestedTool,
        Tool,
        Users,
        Delivery
    ).join(
        Users, RequestModel.user_id == Users.id
    ).join(
        RequestedTool, RequestedTool.request_id == RequestModel.id
    ).join(
        Tool, RequestedTool.tool_id == Tool.id
    ).outerjoin(
        Delivery, Delivery.requested_tool_id == RequestedTool.id
    ).filter(
        RequestModel.date_requested.between(start_date, end_date)
    )

    if facilities and isinstance(facilities, list):
        results = results.filter(Users.facility.in_(facilities))

    results = results.all()
    
    if not results:
        return jsonify({"error": "No data found for the selected criteria"}), 404

    rows = []
    for req, req_tool, tool, user, delivery in results:
        status_date = req.date_approved or req.date_rejected or req.date_requested
        
        rows.append({
            "Facility": user.facility or "N/A",
            "Requested By": (user.first_name or user.username or "N/A"),
            "Request Date": req.date_requested.strftime("%Y-%m-%d") if req.date_requested else "",
            "Tools Requested": tool.name,
            "Quantity": req_tool.quantity,
            "Status": req.status,
            "Status Date": status_date.strftime("%Y-%m-%d") if status_date else "",
            "Delivered": "Yes" if (delivery and delivery.is_delivered) else "No"
        })

    df = pd.DataFrame(rows)

    if out_format == "csv":
        filename = f"request_summary_{start_date.date()}_to_{end_date.date()}.csv"
        data_bytes = df.to_csv(index=False).encode("utf-8-sig")
        mimetype = "text/csv"
    elif out_format == "xlsx":
        bio = BytesIO()
        with pd.ExcelWriter(bio, engine="xlsxwriter") as writer:
            df.to_excel(writer, sheet_name="Request Summary", index=False)
        data_bytes = bio.getvalue()
        filename = f"request_summary_{start_date.date()}_to_{end_date.date()}.xlsx"
        mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        return jsonify({"error": "Unsupported format. Use csv or xlsx"}), 400

    if save_local:
        try:
            saved = _save_report_bytes(filename, data_bytes)
            return jsonify({"saved": True, "path": str(saved), "filename": saved.name, "format": out_format}), 200
        except Exception:
            current_app.logger.exception("Failed saving report to Downloads")
            return jsonify({"error": "Failed to save report to Downloads"}), 500

    return send_file(BytesIO(data_bytes), mimetype=mimetype, as_attachment=True, download_name=filename)


@api_bp.route("/reports/inventory-consumption", methods=["GET"])
@login_required
def generate_inventory_consumption_report():
    """Detailed inventory consumption report with comprehensive columns."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    out_format = (request.args.get("format") or "xlsx").strip().lower()
    facility_filter = (request.args.get("facility") or "").strip()
    start_date = request.args.get("start_date", "").strip()
    end_date = request.args.get("end_date", "").strip()
    save_local = (request.args.get("save") or "0").strip().lower() in ("1", "true", "yes")

    tools = Tool.query.order_by(Tool.name.asc()).all()

    # Pre-fetch all facility stocks, deliveries, requests, distributions, counts in bulk
    all_facility_stocks = FacilityStock.query.all()
    stock_by_tool = {}
    for fs in all_facility_stocks:
        stock_by_tool.setdefault(fs.tool_id, []).append(fs)

    # Delivery aggregates per tool
    delivery_qty = dict(
        db.session.query(Delivery.tool_id, func.coalesce(func.sum(Delivery.quantity_supplied), 0))
        .filter(Delivery.is_delivered == True)
        .group_by(Delivery.tool_id).all()
    )

    # Department distribution aggregates per tool
    distribution_qty = dict(
        db.session.query(DepartmentDistribution.tool_id, func.coalesce(func.sum(DepartmentDistribution.quantity), 0))
        .group_by(DepartmentDistribution.tool_id).all()
    )

    # Request aggregates per tool
    request_counts = dict(
        db.session.query(RequestedTool.tool_id, func.count(RequestedTool.id))
        .group_by(RequestedTool.tool_id).all()
    )
    approved_qty = dict(
        db.session.query(RequestedTool.tool_id, func.coalesce(func.sum(RequestedTool.quantity), 0))
        .filter(RequestedTool.status == 'approved')
        .group_by(RequestedTool.tool_id).all()
    )
    pending_qty = dict(
        db.session.query(RequestedTool.tool_id, func.coalesce(func.sum(RequestedTool.quantity), 0))
        .filter(RequestedTool.status == 'pending')
        .group_by(RequestedTool.tool_id).all()
    )

    # Latest physical count per tool
    latest_counts = {}
    all_counts = PhysicalStockCount.query.order_by(PhysicalStockCount.counted_at.desc()).all()
    for pc in all_counts:
        if pc.tool_id not in latest_counts:
            latest_counts[pc.tool_id] = pc

    # Stock receipts per tool
    receipt_qty = {}
    receipt_lines = db.session.query(
        StockReceiptLine.tool_id, func.coalesce(func.sum(StockReceiptLine.quantity_received), 0)
    ).group_by(StockReceiptLine.tool_id).all()
    for tid, qty in receipt_lines:
        receipt_qty[tid] = int(qty or 0)

    data_list = []
    for tool in tools:
        tid = tool.id
        cat_name = tool.category.name if getattr(tool, "category", None) else "Uncategorized"

        fs_list = stock_by_tool.get(tid, [])
        facilities_with_stock = [fs.facility for fs in fs_list if fs.quantity > 0]
        total_opening = sum(fs.opening_balance or 0 for fs in fs_list)
        total_qty_received = sum(fs.qty_received or 0 for fs in fs_list)
        total_facility_stock = sum(fs.quantity or 0 for fs in fs_list)

        qty_supplied = int(delivery_qty.get(tid, 0) or 0)
        qty_distributed = int(distribution_qty.get(tid, 0) or 0)
        qty_receipts = int(receipt_qty.get(tid, 0) or 0)
        total_requests = int(request_counts.get(tid, 0) or 0)
        qty_approved = int(approved_qty.get(tid, 0) or 0)
        qty_pending = int(pending_qty.get(tid, 0) or 0)

        # Qty Utilized = opening_balance + approved requests (ever-increasing)
        qty_utilized = total_opening + qty_approved

        latest_pc = latest_counts.get(tid)
        physical_count = latest_pc.physical_quantity if latest_pc else None
        discrepancy = (physical_count - total_facility_stock) if physical_count is not None else None
        last_counted = latest_pc.counted_at.isoformat() if latest_pc and latest_pc.counted_at else None

        data_list.append({
            "Tool Name": tool.name,
            "Category": cat_name,
            "Facilities with Stock": ", ".join(facilities_with_stock) if facilities_with_stock else "—",
            "Facility Count": len(facilities_with_stock),
            "Opening Balance": total_opening,
            "Qty Supplied (Deliveries)": qty_supplied,
            "Qty Received (Manual)": total_qty_received,
            "Qty from Receipts": qty_receipts,
            "Qty Distributed (Depts)": qty_distributed,
            "Current Facility Stock": total_facility_stock,
            "Master Stock": tool.quantity or 0,
            "Total Requests": total_requests,
            "Approved Qty": qty_approved,
            "Pending Qty": qty_pending,
            "Qty Utilized": qty_utilized,
            "Physical Count": physical_count if physical_count is not None else "—",
            "Discrepancy": discrepancy if discrepancy is not None else "—",
            "Last Counted": last_counted or "—",
        })

    # Filter by facility if specified
    if facility_filter:
        data_list = [d for d in data_list if facility_filter in d["Facilities with Stock"]]

    df = pd.DataFrame(data_list)

    date_tag = datetime.now().strftime("%Y%m%d_%H%M")
    if out_format == "csv":
        filename = f"inventory_consumption_{date_tag}.csv"
        data_bytes = df.to_csv(index=False).encode("utf-8-sig")
        mimetype = "text/csv"
    elif out_format == "xlsx":
        bio = BytesIO()
        with pd.ExcelWriter(bio, engine="xlsxwriter") as writer:
            df.to_excel(writer, sheet_name="Inventory Consumption", index=False)
            # Auto-fit column widths
            ws = writer.sheets["Inventory Consumption"]
            for i, col in enumerate(df.columns):
                max_width = max(df[col].astype(str).apply(len).max(), len(col)) + 2
                ws.set_column(i, i, min(max_width, 50))
        data_bytes = bio.getvalue()
        filename = f"inventory_consumption_{date_tag}.xlsx"
        mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        return jsonify({"error": "Unsupported format. Use csv or xlsx"}), 400

    if save_local:
        try:
            saved = _save_report_bytes(filename, data_bytes)
            return jsonify({"saved": True, "path": str(saved), "filename": saved.name, "format": out_format}), 200
        except Exception:
            current_app.logger.exception("Failed saving report to Downloads")
            return jsonify({"error": "Failed to save report to Downloads"}), 500

    return send_file(BytesIO(data_bytes), mimetype=mimetype, as_attachment=True, download_name=filename)


# -----------------------
# Analysis (unchanged)
# -----------------------

@api_bp.route("/analysis/tool-usage", methods=["GET"])
def analysis_tool_usage():
    if not getattr(current_user, "is_authenticated", False):
        return jsonify([]), 200
    if not _is_admin_user(current_user):
        return jsonify([]), 200

    period = _safe_int(request.args.get("period"), 30)
    limit = _safe_int(request.args.get("limit"), 10)
    since = datetime.utcnow() - timedelta(days=max(period, 1))

    date_col, qty_col = _toolusage_cols()
    if date_col is None or qty_col is None:
        return jsonify([]), 200

    rows = (
        db.session.query(
            Tool.name.label("tool"),
            func.sum(qty_col).label("used")
        )
        .join(ToolUsage, Tool.id == ToolUsage.tool_id)
        .filter(date_col >= since)
        .group_by(Tool.name)
        .order_by(func.sum(qty_col).desc())
        .limit(limit)
        .all()
    )

    return jsonify([{"tool": r.tool, "used": int(r.used or 0)} for r in rows]), 200


@api_bp.route("/analysis/consumption-trends", methods=["GET"])
def consumption_trends():
    if not getattr(current_user, "is_authenticated", False):
        return jsonify([]), 200
    if not _is_admin_user(current_user):
        return jsonify([]), 200

    period = _safe_int(request.args.get("period"), 90)
    tool_id = request.args.get("tool_id")
    since = datetime.utcnow() - timedelta(days=max(period, 1))

    date_col, qty_col = _toolusage_cols()
    if date_col is None or qty_col is None:
        return jsonify([]), 200

    q = db.session.query(
        func.date(date_col).label("day"),
        func.sum(qty_col).label("used")
    ).filter(date_col >= since)

    if tool_id:
        q = q.filter(ToolUsage.tool_id == _safe_int(tool_id, 0))

    rows = q.group_by(func.date(date_col)).order_by(func.date(date_col)).all()
    return jsonify([{"date": str(r.day), "used": int(r.used or 0)} for r in rows]), 200


@api_bp.route("/analysis/dashboard-data", methods=["GET"])
def dashboard_data():
    period = _safe_int(request.args.get("period"), 30)
    since = datetime.utcnow() - timedelta(days=max(period, 1))

    empty = {
        "summary": {
            "total_requests": 0,
            "total_items": 0,
            "avg_daily_requests": 0,
            "unique_facilities": 0,
        },
        "daily_trends": [],
        "monthly_trends": [],
        "facility_distribution": [],
        "category_distribution": [],
        "status_distribution": [],
        "top_tools": [],
    }

    if not getattr(current_user, "is_authenticated", False):
        return jsonify(empty), 200
    if not _is_admin_user(current_user):
        return jsonify(empty), 200

    try:
        dialect = None
        try:
            dialect = db.session.get_bind().dialect.name
        except Exception:
            dialect = None

        if dialect == "sqlite":
            month_expr = func.strftime("%Y-%m", RequestModel.date_requested)
        elif dialect == "postgresql":
            month_expr = func.to_char(RequestModel.date_requested, "YYYY-MM")
        elif dialect in ("mysql", "mariadb"):
            month_expr = func.date_format(RequestModel.date_requested, "%Y-%m")
        else:
            month_expr = func.strftime("%Y-%m", RequestModel.date_requested)

        total_requests = (
            db.session.query(func.count(RequestModel.id))
            .filter(RequestModel.date_requested >= since)
            .scalar()
            or 0
        )

        total_items = (
            db.session.query(func.sum(RequestedTool.quantity))
            .join(RequestModel, RequestedTool.request_id == RequestModel.id)
            .filter(RequestModel.date_requested >= since)
            .scalar()
            or 0
        )

        unique_facilities = (
            db.session.query(func.count(func.distinct(Users.facility)))
            .join(RequestModel, RequestModel.user_id == Users.id)
            .filter(RequestModel.date_requested >= since)
            .scalar()
            or 0
        )

        avg_daily_requests = (total_requests / max(period, 1)) if period else 0

        daily_rows = (
            db.session.query(
                func.date(RequestModel.date_requested).label("day"),
                func.count(RequestModel.id).label("cnt"),
            )
            .filter(RequestModel.date_requested >= since)
            .group_by(func.date(RequestModel.date_requested))
            .order_by(func.date(RequestModel.date_requested))
            .all()
        )
        daily_trends = [{"date": str(r.day), "daily_requests": int(r.cnt or 0)} for r in daily_rows]

        monthly_rows = (
            db.session.query(
                month_expr.label("month"),
                func.count(RequestModel.id).label("cnt"),
            )
            .filter(RequestModel.date_requested >= since)
            .group_by(month_expr)
            .order_by(month_expr)
            .all()
        )
        monthly_trends = [{"month": r.month, "request_count": int(r.cnt or 0)} for r in monthly_rows]

        facility_rows = (
            db.session.query(
                Users.facility.label("facility"),
                func.count(func.distinct(RequestModel.id)).label("request_count"),
                func.sum(RequestedTool.quantity).label("total_items"),
            )
            .join(RequestModel, RequestModel.user_id == Users.id)
            .join(RequestedTool, RequestedTool.request_id == RequestModel.id)
            .filter(RequestModel.date_requested >= since)
            .group_by(Users.facility)
            .order_by(func.count(func.distinct(RequestModel.id)).desc())
            .all()
        )
        facility_distribution = [{
            "facility": r.facility or "Unknown",
            "request_count": int(r.request_count or 0),
            "total_items": int(r.total_items or 0),
        } for r in facility_rows]

        category_rows = (
            db.session.query(
                ToolCategory.name.label("category"),
                func.sum(RequestedTool.quantity).label("total_quantity"),
            )
            .join(Tool, Tool.category_id == ToolCategory.id)
            .join(RequestedTool, RequestedTool.tool_id == Tool.id)
            .join(RequestModel, RequestModel.id == RequestedTool.request_id)
            .filter(RequestModel.date_requested >= since)
            .group_by(ToolCategory.name)
            .order_by(func.sum(RequestedTool.quantity).desc())
            .all()
        )
        category_distribution = [{
            "category": r.category or "Uncategorized",
            "total_quantity": int(r.total_quantity or 0),
        } for r in category_rows]

        status_rows = (
            db.session.query(
                RequestModel.status.label("status"),
                func.count(RequestModel.id).label("count"),
            )
            .filter(RequestModel.date_requested >= since)
            .group_by(RequestModel.status)
            .order_by(func.count(RequestModel.id).desc())
            .all()
        )
        status_distribution = [{
            "status": (r.status or "Unknown"),
            "count": int(r.count or 0),
        } for r in status_rows]

        top_tool_rows = (
            db.session.query(
                Tool.name.label("tool_name"),
                ToolCategory.name.label("category"),
                func.sum(RequestedTool.quantity).label("total_requested"),
                func.count(func.distinct(RequestModel.id)).label("request_count"),
            )
            .join(RequestedTool, RequestedTool.tool_id == Tool.id)
            .join(RequestModel, RequestModel.id == RequestedTool.request_id)
            .outerjoin(ToolCategory, Tool.category_id == ToolCategory.id)
            .filter(RequestModel.date_requested >= since)
            .group_by(Tool.name, ToolCategory.name)
            .order_by(func.sum(RequestedTool.quantity).desc())
            .limit(50)
            .all()
        )
        top_tools = [{
            "tool_name": r.tool_name,
            "category": r.category or "Uncategorized",
            "total_requested": int(r.total_requested or 0),
            "request_count": int(r.request_count or 0),
        } for r in top_tool_rows]

        return jsonify({
            "summary": {
                "total_requests": int(total_requests),
                "total_items": int(total_items),
                "avg_daily_requests": float(avg_daily_requests),
                "unique_facilities": int(unique_facilities),
            },
            "daily_trends": daily_trends,
            "monthly_trends": monthly_trends,
            "facility_distribution": facility_distribution,
            "category_distribution": category_distribution,
            "status_distribution": status_distribution,
            "top_tools": top_tools,
        }), 200

    except Exception:
        current_app.logger.exception("dashboard-data failed")
        return jsonify(empty), 200

# -----------------------
# Real-time Notifications
# -----------------------

@api_bp.route("/notifications/stream")
@login_required
def notification_stream():
    """SSE endpoint for real-time notifications - Admin only"""
    if not _is_admin_user(current_user):
        return jsonify({"error": "Unauthorized"}), 403
    
    def event_stream():
        # Create a queue for this connection
        q = queue.Queue()
        connection_id = current_user.id
        connection_queues[connection_id] = q
        
        try:
            # Send initial connection message
            yield f"data: {json.dumps({'type': 'connected', 'message': 'Connected to notification stream'})}\n\n"
            
            while True:
                # Wait for messages with timeout to check for connection health
                try:
                    data = q.get(timeout=30)
                    yield f"data: {json.dumps(data)}\n\n"
                except queue.Empty:
                    # Send heartbeat to keep connection alive
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        except GeneratorExit:
            # Clean up when client disconnects
            if connection_id in connection_queues:
                del connection_queues[connection_id]
    
    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )


def send_notification_to_admins(notification):
    """Send notification to all connected admin users"""
    notification['timestamp'] = datetime.utcnow().isoformat()
    
    # Get all active admin connections
    for conn_id, q in list(connection_queues.items()):
        try:
            q.put(notification)
        except Exception:
            # Remove dead connections
            if conn_id in connection_queues:
                del connection_queues[conn_id]

@api_bp.route("/forecast/pharmacy", methods=["POST"])
@login_required
def forecast_pharmacy():
    if not _is_admin_user(current_user):
        return _admin_required_json()

    if "file" not in request.files:
        return jsonify({"error": "file required"}), 400

    f = request.files["file"]
    if not f or not f.filename:
        return jsonify({"error": "file required"}), 400

    period_days = _safe_int(
        request.form.get("period_days") or request.form.get("periodDays"), 
        30
    )
    if period_days <= 0:
        period_days = 30

    facility_filter = (request.form.get("facility") or "").strip()

    refills_per_booklet = _safe_int(
        request.form.get("refills_per_booklet") or request.form.get("refillsPerBooklet"), 
        50
    )
    if refills_per_booklet <= 0:
        refills_per_booklet = 50

    raw = f.read()
    if not raw:
        return jsonify({"error": "empty file"}), 400

    try:
        df = pd.read_excel(BytesIO(raw))
    except Exception:
        current_app.logger.exception("Failed reading RADET excel")
        return jsonify({"error": "Could not read Excel file"}), 400

    possible_fac_cols = ["Facility Name", "Facility", "Facility_Name", "FACILITY", "facility_name"]
    possible_status_cols = ["Current ART Status", "ART Status", "Status", "current_art_status"]
    possible_verify_cols = ["Client Verification Outcome", "Verification Outcome", "Verification", "client_verification_outcome"]
    possible_pickup_cols = ["Last Pickup Date (yyyy-mm-dd)", "Last Pickup Date", "last_pickup_date", "Pickup Date"]
    possible_months_cols = ["Months of ARV Refill", "ARV Refill Months", "Months", "months_of_arv_refill"]

    def find_column(df, possible_names):
        for name in possible_names:
            if name in df.columns:
                return name
        return None

    FAC_COL = find_column(df, possible_fac_cols)
    STATUS_COL = find_column(df, possible_status_cols)
    VERIFY_COL = find_column(df, possible_verify_cols)
    PICKUP_COL = find_column(df, possible_pickup_cols)
    MONTHS_COL = find_column(df, possible_months_cols)

    missing = [c for c in [FAC_COL, STATUS_COL, VERIFY_COL, PICKUP_COL, MONTHS_COL] if c is None]
    if missing:
        available_cols = list(df.columns)
        return jsonify({
            "error": f"Missing required columns in RADET file",
            "details": {
                "required": ["Facility Name", "Current ART Status", "Client Verification Outcome", 
                           "Last Pickup Date (yyyy-mm-dd)", "Months of ARV Refill"],
                "available": available_cols,
                "missing": missing
            }
        }), 400

    df[FAC_COL] = df[FAC_COL].fillna("").astype(str).str.strip()
    df[STATUS_COL] = df[STATUS_COL].fillna("").astype(str).str.strip().str.lower()
    df[VERIFY_COL] = df[VERIFY_COL].fillna("").astype(str).str.strip().str.lower()

    allowed_status = {"active", "active restart", "active_restart"}
    df = df[df[STATUS_COL].isin(allowed_status)]
    df = df[df[VERIFY_COL] == "valid"]

    if df.empty:
        return jsonify({
            "error": "No valid records found after filtering. Check if data has 'Active'/'Active Restart' status and 'valid' verification.",
            "filtered_count": 0
        }), 400

    if facility_filter:
        df = df[df[FAC_COL].str.lower() == facility_filter.lower()]

    try:
        df[PICKUP_COL] = pd.to_datetime(df[PICKUP_COL], errors="coerce", format="mixed")
    except Exception:
        df[PICKUP_COL] = pd.to_datetime(df[PICKUP_COL], errors="coerce")
    
    df[MONTHS_COL] = pd.to_numeric(df[MONTHS_COL], errors="coerce").fillna(0)

    df["next_refill_date"] = df[PICKUP_COL] + pd.to_timedelta(df[MONTHS_COL] * 30, unit="D")

    today = datetime.utcnow().date()
    end_date = (datetime.utcnow() + timedelta(days=period_days)).date()

    df = df[df["next_refill_date"].notna()]
    df["next_refill_day"] = df["next_refill_date"].dt.date
    window = df[(df["next_refill_day"] >= today) & (df["next_refill_day"] <= end_date)]

    if not window.empty:
        grouped = (
            window.groupby(FAC_COL)
            .size()
            .reset_index(name="expected_refills")
            .sort_values("expected_refills", ascending=False)
        )
    else:
        grouped = pd.DataFrame(columns=[FAC_COL, "expected_refills"])

    rows = []
    for _, r in grouped.iterrows():
        expected_refills = int(r["expected_refills"] or 0)
        recommended_booklets = int(math.ceil(expected_refills / float(refills_per_booklet))) if expected_refills > 0 else 0
        rows.append({
            "facility": str(r[FAC_COL]),
            "expected_refills": expected_refills,
            "refills_per_booklet": refills_per_booklet,
            "recommended_booklets": recommended_booklets,
        })

    facilities = sorted(set(df[FAC_COL].dropna().astype(str).str.strip().tolist()))

    return jsonify({
        "ok": True,
        "period_days": period_days,
        "from": str(today),
        "to": str(end_date),
        "facility_filter": facility_filter or None,
        "refills_per_booklet": refills_per_booklet,
        "facilities": facilities,
        "rows": rows,
        "total_expected_refills": int(sum(x["expected_refills"] for x in rows)),
        "total_recommended_booklets": int(sum(x["recommended_booklets"] for x in rows)),
        "summary": {
            "total_records": len(df),
            "filtered_records": len(window),
            "facilities_count": len(facilities),
            "forecast_facilities": len(rows)
        }
    }), 200


# -----------------------
# Stock Receipts
# -----------------------

@api_bp.route("/stock-receipts", methods=["GET"])
@login_required
def list_stock_receipts():
    """List all stock receipts (admin only)."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    receipts = (
        StockReceipt.query
        .options(joinedload(StockReceipt.lines).joinedload(StockReceiptLine.tool))
        .order_by(StockReceipt.created_at.desc())
        .all()
    )

    return jsonify([r.to_dict() for r in receipts]), 200


@api_bp.route("/stock-receipts", methods=["POST"])
@login_required
def create_stock_receipt():
    """Create a new stock receipt and auto-increment tool quantities."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    data = _json_body()

    date_supplied_str = data.get("date_supplied") or data.get("dateSupplied")
    supplied_from = (data.get("supplied_from") or data.get("suppliedFrom") or "").strip()
    supplied_by = (data.get("supplied_by") or data.get("suppliedBy") or "").strip()
    received_by = _safe_int(data.get("received_by") or data.get("receivedBy") or current_user.id, current_user.id)
    received_date_str = data.get("received_date") or data.get("receivedDate")
    lines = data.get("lines") or []

    if not supplied_from or not supplied_by:
        return jsonify({"error": "supplied_from and supplied_by are required"}), 400

    if not isinstance(lines, list) or not lines:
        return jsonify({"error": "lines (tools received) are required"}), 400

    # Parse dates
    try:
        date_supplied = datetime.fromisoformat(str(date_supplied_str).replace("Z", "+00:00")) if date_supplied_str else datetime.utcnow()
    except Exception:
        date_supplied = datetime.utcnow()

    try:
        received_date = datetime.fromisoformat(str(received_date_str).replace("Z", "+00:00")) if received_date_str else datetime.utcnow()
    except Exception:
        received_date = datetime.utcnow()

    # Verify receiver exists
    receiver = Users.query.get(received_by)
    if not receiver:
        return jsonify({"error": "Receiver user not found"}), 404

    receipt = StockReceipt(
        date_supplied=date_supplied,
        supplied_from=supplied_from,
        supplied_by=supplied_by,
        received_by=received_by,
        received_date=received_date,
        notes=(data.get("notes") or "").strip()
    )
    db.session.add(receipt)
    db.session.flush()

    for line in lines:
        tool_id = _safe_int(line.get("tool_id") or line.get("toolId"))
        quantity = _safe_int(line.get("quantity_received") or line.get("quantity") or line.get("quantityReceived"))
        serial_number = (line.get("serial_number") or line.get("serialNumber") or f"SR{receipt.id}-{len(receipt.lines or [])+1}")

        if not tool_id or quantity <= 0:
            continue

        tool = Tool.query.get(tool_id)
        if not tool:
            continue

        receipt_line = StockReceiptLine(
            receipt_id=receipt.id,
            serial_number=str(serial_number),
            tool_id=tool_id,
            quantity_received=quantity
        )
        db.session.add(receipt_line)

        # Auto-increment tool quantity
        tool.quantity = (tool.quantity or 0) + quantity
        db.session.add(tool)

    db.session.commit()

    # Reload to get populated relationships
    receipt = StockReceipt.query.options(
        joinedload(StockReceipt.lines).joinedload(StockReceiptLine.tool)
    ).get(receipt.id)

    return jsonify(receipt.to_dict()), 201


@api_bp.route("/stock-receipts/<int:receipt_id>", methods=["GET"])
@login_required
def get_stock_receipt(receipt_id):
    """Get a single stock receipt with its lines."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    receipt = (
        StockReceipt.query
        .options(joinedload(StockReceipt.lines).joinedload(StockReceiptLine.tool))
        .get(receipt_id)
    )

    if not receipt:
        return jsonify({"error": "Receipt not found"}), 404

    return jsonify(receipt.to_dict()), 200


@api_bp.route("/stock-receipts/<int:receipt_id>", methods=["DELETE"])
@login_required
def delete_stock_receipt(receipt_id):
    """Delete a stock receipt and revert tool quantities."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    receipt = StockReceipt.query.get(receipt_id)
    if not receipt:
        return jsonify({"error": "Receipt not found"}), 404

    # Revert quantities for each line
    for line in (receipt.lines or []):
        tool = Tool.query.get(line.tool_id)
        if tool:
            tool.quantity = max(0, (tool.quantity or 0) - (line.quantity_received or 0))
            db.session.add(tool)

    db.session.delete(receipt)
    db.session.commit()

    return jsonify({"message": "receipt deleted"}), 200

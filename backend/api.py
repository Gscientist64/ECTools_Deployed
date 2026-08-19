from flask import Blueprint, jsonify, request, current_app, send_file
from flask_login import login_user, logout_user, current_user, login_required
from extensions import db
from models import Users, Tool, ToolCategory, Request as RequestModel, RequestedTool, ToolUsage, Delivery, FacilityStock, DepartmentDistribution, PhysicalStockCount, StockReceipt, StockReceiptLine, FacilityTransfer, NotificationRead, AuditLog, RequestComment, DeliveryConcern, SupervisorAction, SystemSetting, EmailLog, UtilizationResult, UTILIZATION_THRESHOLD
from sqlalchemy.orm import joinedload
from sqlalchemy import func, and_, case, distinct, or_, not_
from werkzeug.utils import secure_filename
import pandas as pd
import numpy as np
from io import BytesIO
import math
from datetime import datetime, timedelta, date
from calendar import monthrange
from io import BytesIO
from pathlib import Path
import os
import csv
import io
import json
import asyncio
import queue
import threading
import hashlib
import sys
from flask import Response, stream_with_context

# PDF Generation (lazy-imported in create_delivery_note_pdf to survive missing reportlab)

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
    """Verify password against stored hash, handling scrypt and legacy formats."""
    if not stored or not password:
        return False
    try:
        return check_password_hash(stored, password)
    except ValueError:
        # werkzeug 3.x may fail on scrypt hashes — fall back to hashlib
        if stored.startswith("scrypt:"):
            try:
                import hashlib, base64
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
    except Exception:
        # stored is not a valid hash string (e.g. plaintext that tripped _looks_like_hash)
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


def _audit(action, entity_type=None, entity_id=None, details=None):
    """Record an audit log entry for the current request. Call before commit."""
    try:
        log = AuditLog(
            user_id=current_user.id if current_user.is_authenticated else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=json.dumps(details) if details else None,
            ip_address=request.remote_addr,
        )
        db.session.add(log)
    except Exception:
        pass


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

def create_delivery_note_pdf(deliveries, requester, distributor, request_obj):
    """
    Generate PDF delivery note using ReportLab.
    Accepts a LIST of Delivery objects (all from same request) to show multiple tools.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image as RLImage
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
    except ImportError:
        raise RuntimeError("PDF generation unavailable — reportlab library is not installed on the server.")

    buffer = BytesIO()
    
    # First delivery for metadata
    first_del = deliveries[0] if deliveries else None
    
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
    req_first = requester.first_name if requester else "Unknown"
    req_other = getattr(requester, 'other_name', '') if requester else ""
    req_facility = requester.facility if requester else "N/A"
    req_email = requester.email if requester else "N/A"
    dist_first = distributor.first_name if distributor else "Admin"
    dist_other = getattr(distributor, 'other_name', '') if distributor else ""
    dist_role = (getattr(distributor, 'role', None) or getattr(distributor, 'roles', None) or "Admin") if distributor else "Admin"
    
    def _unit_display(raw):
        if not raw:
            return "Unit"
        return {
            'register': 'Register',
            'booklet': 'Booklet',
            'pack': 'Pack',
            'unit': 'Unit'
        }.get(raw, str(raw).capitalize())
    
    story = []
    
    # --- ECEWS Logo ---
    try:
        if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
            logo_path = os.path.join(sys._MEIPASS, "frontend", "dist", "ecews-logo.png")
        else:
            logo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "ecews-logo.png"))
        if os.path.exists(logo_path):
            logo = RLImage(logo_path, width=65, height=65)
            logo.hAlign = 'CENTER'
            story.append(logo)
            story.append(Spacer(1, 8))
    except Exception:
        pass
    
    request_id = first_del.request_id if first_del else "N/A"
    story.append(Paragraph("DELIVERY NOTE", title_style))
    story.append(Spacer(1, 12))
    
    story.append(Paragraph(f"<b>Delivery Note #:</b> {request_id}", normal_style))
    story.append(Paragraph(f"<b>Date:</b> {datetime.now().strftime('%B %d, %Y')}", normal_style))
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("<b>DELIVER TO:</b>", heading_style))
    story.append(Paragraph(f"{req_first} {req_other}", normal_style))
    story.append(Paragraph(f"Facility: {req_facility or 'N/A'}", normal_style))
    story.append(Paragraph(f"Email: {req_email}", normal_style))
    story.append(Spacer(1, 20))
    
    story.append(Paragraph("<b>ITEMS SUPPLIED:</b>", heading_style))
    
    # Build multi-row table
    table_data = [['Tool Name', 'Basic Unit', 'Quantity Supplied']]
    for d in deliveries:
        tool_obj = Tool.query.get(d.tool_id)
        tool_name = tool_obj.name if tool_obj else f"Tool #{d.tool_id}"
        table_data.append([
            tool_name,
            _unit_display(d.basic_unit),
            str(d.quantity_supplied or 0)
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
    
    witnessed = getattr(first_del, 'witnessed_by', None) or '_________________'
    
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

    if _looks_like_hash(stored):
        ok = _verify_password(stored, password)
    else:
        # Legacy plaintext password — verify then silently upgrade to a hash
        ok = (stored == password)
        if ok:
            try:
                u.password = _hash_password(password)
                db.session.commit()
            except Exception:
                current_app.logger.exception("Failed to upgrade plaintext password to hash")

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


@api_bp.route("/facilities", methods=["GET"])
@login_required
def list_public_facilities():
    """List all unique facilities for any logged-in user (e.g., transfer dropdowns)."""
    rows = db.session.query(Users.facility).filter(
        Users.facility.isnot(None),
        Users.facility != "",
        Users.facility != "Supervisor",
    ).distinct().order_by(Users.facility).all()
    return jsonify([r[0] for r in rows]), 200


# -----------------------
# My Inventory (Facility user)
# -----------------------

@api_bp.route("/inventory/my-stock/update-qty-received", methods=["POST"])
@login_required
def update_qty_received():
    """Admin-only: manually adjust qty_received for a facility's stock record."""
    if current_user.role != "admin":
        return jsonify({"error": "Admin access required"}), 403
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
    tools = Tool.query.options(joinedload(Tool.category)).order_by(Tool.name.asc()).all()

    # Batch aggregations — 3 queries total instead of 3 per tool
    qty_supplied_rows = (
        db.session.query(
            Delivery.tool_id,
            func.coalesce(func.sum(Delivery.quantity_supplied), 0).label("total")
        )
        .filter(Delivery.is_delivered.is_(True))
        .join(Users, Delivery.received_by == Users.id)
        .filter(Users.facility == facility)
        .group_by(Delivery.tool_id)
        .all()
    )
    qty_supplied_map = {r.tool_id: int(r.total) for r in qty_supplied_rows}

    qty_distributed_rows = (
        db.session.query(
            DepartmentDistribution.tool_id,
            func.coalesce(func.sum(DepartmentDistribution.quantity), 0).label("total")
        )
        .filter(DepartmentDistribution.facility == facility)
        .group_by(DepartmentDistribution.tool_id)
        .all()
    )
    qty_distributed_map = {r.tool_id: int(r.total) for r in qty_distributed_rows}

    qty_used_rows = (
        db.session.query(
            ToolUsage.tool_id,
            func.coalesce(func.sum(ToolUsage.quantity_used), 0).label("total")
        )
        .join(Users, ToolUsage.user_id == Users.id)
        .filter(Users.facility == facility)
        .group_by(ToolUsage.tool_id)
        .all()
    )
    qty_used_map = {r.tool_id: int(r.total) for r in qty_used_rows}

    result = []
    for t in tools:
        s = stock_map.get(t.id)
        qty_supplied = qty_supplied_map.get(t.id, 0)
        qty_utilized = qty_distributed_map.get(t.id, 0) + qty_used_map.get(t.id, 0)
        opening_bal = s.opening_balance if s else 0
        qty_received = s.qty_received if s else 0
        current_qty = s.quantity if s else 0

        result.append({
            "tool_id": t.id,
            "tool_name": t.name,
            "category": t.category.name if t.category else "Uncategorized",
            "quantity": current_qty,
            "opening_balance": opening_bal,
            "qty_supplied": qty_supplied,
            "qty_received": qty_received,
            "qty_utilized": qty_utilized,
            "facility_stock_id": s.id if s else None
        })

    return jsonify(result), 200


@api_bp.route("/inventory/distributions", methods=["GET"])
@login_required
def my_department_distributions():
    """Get department distributions for the user's facility (paginated)"""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned to your account"}), 400

    page = max(1, _safe_int(request.args.get("page"), 1))
    per_page = min(100, max(1, _safe_int(request.args.get("limit"), 50)))

    pagination = (
        DepartmentDistribution.query
        .filter_by(facility=facility)
        .order_by(DepartmentDistribution.date_distributed.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )
    return jsonify({
        "items": [d.to_dict() for d in pagination.items],
        "page": page,
        "pages": pagination.pages,
        "total": pagination.total,
        "per_page": per_page,
    }), 200


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
        else:  # quarter (fiscal year: Q1=Oct-Dec, Q2=Jan-Mar, Q3=Apr-Jun, Q4=Jul-Sep)
            m = dt.month
            # Fiscal year: Oct-Dec belong to next calendar year's FY
            fy = dt.year + 1 if m >= 10 else dt.year
            fq = ((m + 2) % 12) // 3 + 1  # 1=Oct-Dec, 2=Jan-Mar, 3=Apr-Jun, 4=Jul-Sep
            # Start month: Q1→10, Q2→1, Q3→4, Q4→7
            q_start_month = ((fq * 3) + 6) % 12 + 1
            q_end_month = (q_start_month + 2) % 12 or 12
            # For Q1 (Oct-Dec), the period start year is fy-1; for Q2-Q4 it's fy
            start_yr = fy - 1 if fq == 1 else fy
            end_yr = fy - 1 if fq == 1 else fy
            period_start = datetime(start_yr, q_start_month, 1)
            last_day = monthrange(end_yr, q_end_month)[1]
            period_end = datetime(end_yr, q_end_month, last_day, 23, 59, 59)
            label = f"FY{fy}-Q{fq}"
            sort_key = f"{fy}{fq:02d}"
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
        .filter(Delivery.is_delivered.is_(True))
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

    # 4. ToolUsage (utilization recorded by facility users)
    usages = (
        ToolUsage.query
        .join(Users, ToolUsage.user_id == Users.id)
        .filter(Users.facility == facility)
        .filter(ToolUsage.date_used >= datetime(year, 1, 1))
        .filter(ToolUsage.date_used < datetime(year + 1, 1, 1))
        .all()
    )
    for u in usages:
        if not u.date_used:
            continue
        sk, label, p_start, p_end = period_key(u.date_used)
        tp = tool_periods.setdefault(u.tool_id, {})
        entry = tp.setdefault(sk, {"label": label, "period_start": p_start.isoformat(), "period_end": p_end.isoformat(), "supplied": 0, "utilized": 0})
        entry["utilized"] += u.quantity_used or 0

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
        .filter(Delivery.tool_id == tool_id, Delivery.is_delivered.is_(True))
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
# Tool Utilization (Record Usage)
# -----------------------

@api_bp.route("/inventory/record-utilization", methods=["POST"])
@login_required
def record_utilization():
    """Record tool usage/utilization by a facility user. Deducts from facility stock."""
    data = _json_body()
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    tool_id = _safe_int(data.get("tool_id"))
    quantity_used = _safe_int(data.get("quantity_used"))
    notes = (data.get("notes") or "").strip()

    if not tool_id or quantity_used <= 0:
        return jsonify({"error": "tool_id and positive quantity_used are required"}), 400

    # Check/deduct from facility stock
    stock = FacilityStock.query.filter_by(facility=facility, tool_id=tool_id).first()
    if not stock:
        return jsonify({"error": "No stock record for this tool at your facility"}), 400

    if stock.quantity < quantity_used:
        return jsonify({"error": f"Insufficient stock. Available: {stock.quantity}, requested: {quantity_used}"}), 400

    stock.quantity -= quantity_used

    # Record usage
    usage = ToolUsage(
        tool_id=tool_id,
        user_id=current_user.id,
        quantity_used=quantity_used,
        date_used=datetime.utcnow()
    )
    db.session.add(usage)
    db.session.commit()

    return jsonify(usage.to_dict()), 201


@api_bp.route("/inventory/my-utilization", methods=["GET"])
@login_required
def list_my_utilization():
    """List utilization records for the user's facility"""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    usages = (
        db.session.query(ToolUsage, Tool)
        .join(Tool, ToolUsage.tool_id == Tool.id)
        .join(Users, ToolUsage.user_id == Users.id)
        .filter(Users.facility == facility)
        .order_by(ToolUsage.date_used.desc())
        .limit(50)
        .all()
    )
    result = []
    for usage, tool in usages:
        result.append({
            "id": usage.id,
            "tool_id": usage.tool_id,
            "tool_name": tool.name if tool else "Unknown",
            "quantity_used": usage.quantity_used,
            "date_used": usage.date_used.isoformat() if usage.date_used else None,
        })
    return jsonify(result), 200


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
    total_stock = db.session.query(func.sum(FacilityStock.quantity)).scalar() or 0

    # Approved requests not yet confirmed by facilities (status stays "Approved" until facility confirms)
    approved_awaiting = RequestModel.query.filter(func.lower(RequestModel.status) == "approved").count()

    # Out-of-stock: admin/state-level tools where HQ stock has run to zero
    low_stock_count = Tool.query.filter(Tool.quantity <= 0).count()

    # Recent pending requests (most recent 8 for quick-action list)
    recent_pending = (
        RequestModel.query
        .filter(func.lower(RequestModel.status) == "pending")
        .order_by(RequestModel.date_requested.desc())
        .limit(8).all()
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

    # Department distribution summary
    dept_summary = (
        db.session.query(
            DepartmentDistribution.department,
            func.sum(DepartmentDistribution.quantity).label("total")
        )
        .group_by(DepartmentDistribution.department)
        .all()
    )

    def _req_brief(r):
        requester = Users.query.get(r.user_id)
        return {
            "id": r.id,
            "facility": getattr(requester, "facility", None) or "—",
            "requester": (getattr(requester, "first_name", None) or getattr(requester, "username", "")) if requester else "—",
            "date_requested": r.date_requested.isoformat() if r.date_requested else None,
            "item_count": RequestedTool.query.filter_by(request_id=r.id).count(),
        }

    pending_concerns = DeliveryConcern.query.filter_by(status='pending').count()

    return jsonify({
        "summary": {
            "total_facilities": total_facilities,
            "total_tools": total_tools,
            "total_users": total_users,
            "pending_requests": pending_requests,
            "approved_awaiting": approved_awaiting,
            "low_stock_count": low_stock_count,
            "total_stock_items": int(total_stock),
            "pending_concerns": pending_concerns,
        },
        "recent_pending": [_req_brief(r) for r in recent_pending],
        "facility_stocks": [{"facility": r[0], "total": int(r[1])} for r in facility_stocks],
        "department_summary": [{"department": r[0], "total": int(r[1])} for r in dept_summary],
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


@api_bp.route("/admin/facility/<path:facility_name>/inventory", methods=["GET"])
@login_required
def admin_facility_inventory(facility_name):
    """Admin: full inventory view for a facility — all tools with qty_received, qty_utilized, balance.
    Mirrors my_facility_stock() but accessible by admins for any facility."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    facility = facility_name
    stocks = FacilityStock.query.filter_by(facility=facility).all()
    stock_map = {s.tool_id: s for s in stocks}

    tools = Tool.query.options(joinedload(Tool.category)).order_by(Tool.name.asc()).all()

    qty_distributed_rows = (
        db.session.query(
            DepartmentDistribution.tool_id,
            func.coalesce(func.sum(DepartmentDistribution.quantity), 0).label("total")
        )
        .filter(DepartmentDistribution.facility == facility)
        .group_by(DepartmentDistribution.tool_id)
        .all()
    )
    qty_distributed_map = {r.tool_id: int(r.total) for r in qty_distributed_rows}

    qty_used_rows = (
        db.session.query(
            ToolUsage.tool_id,
            func.coalesce(func.sum(ToolUsage.quantity_used), 0).label("total")
        )
        .join(Users, ToolUsage.user_id == Users.id)
        .filter(Users.facility == facility)
        .group_by(ToolUsage.tool_id)
        .all()
    )
    qty_used_map = {r.tool_id: int(r.total) for r in qty_used_rows}

    result = []
    for t in tools:
        s = stock_map.get(t.id)
        qty_utilized = qty_distributed_map.get(t.id, 0) + qty_used_map.get(t.id, 0)
        result.append({
            "tool_id": t.id,
            "tool_name": t.name,
            "category": t.category.name if t.category else "Uncategorized",
            "quantity": s.quantity if s else 0,
            "opening_balance": s.opening_balance if s else 0,
            "qty_received": s.qty_received if s else 0,
            "qty_utilized": qty_utilized,
            "facility_stock_id": s.id if s else None,
        })

    return jsonify({"facility": facility_name, "tools": result}), 200


@api_bp.route("/admin/facility-stock", methods=["PUT"])
@login_required
def admin_update_facility_stock():
    """Admin: edit the current stock balance for a tool in a facility.
    Accepts { facility_stock_id } or { tool_id, facility }, plus optional
    opening_balance / qty_received. Creates the row if it doesn't exist."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    data = _json_body()
    fs_id = _safe_int(data.get("facility_stock_id"))
    tool_id = _safe_int(data.get("tool_id"))
    facility = (data.get("facility") or "").strip()
    qty = _safe_int(data.get("quantity"), 0)

    fs = None
    if fs_id:
        fs = FacilityStock.query.get(fs_id)
    elif tool_id and facility:
        fs = FacilityStock.query.filter_by(facility=facility, tool_id=tool_id).first()

    if not fs:
        if tool_id and facility:
            fs = FacilityStock(tool_id=tool_id, facility=facility, quantity=qty, opening_balance=0, qty_received=0)
            db.session.add(fs)
        else:
            return jsonify({"error": "Facility stock record not found"}), 404

    fs.quantity = qty
    for field in ("opening_balance", "qty_received"):
        if data.get(field) is not None:
            setattr(fs, field, _safe_int(data[field], 0))
    db.session.commit()
    return jsonify({"message": "Stock updated", "facility_stock_id": fs.id, "quantity": fs.quantity}), 200


@api_bp.route("/inventory/stocktake", methods=["GET"])
@login_required
def stocktake_summary():
    """All tools with system qty and latest physical count per tool — for stocktake reconciliation."""
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400

    tools = Tool.query.options(joinedload(Tool.category)).order_by(Tool.name.asc()).all()
    stocks = FacilityStock.query.filter_by(facility=facility).all()
    stock_map = {s.tool_id: s for s in stocks}

    # Latest physical count per tool (subquery)
    subq = (
        db.session.query(
            PhysicalStockCount.tool_id,
            func.max(PhysicalStockCount.counted_at).label("latest")
        )
        .filter(PhysicalStockCount.facility == facility)
        .group_by(PhysicalStockCount.tool_id)
        .subquery()
    )
    latest_counts = (
        db.session.query(PhysicalStockCount)
        .join(subq, (PhysicalStockCount.tool_id == subq.c.tool_id) &
              (PhysicalStockCount.counted_at == subq.c.latest))
        .filter(PhysicalStockCount.facility == facility)
        .all()
    )
    count_map = {c.tool_id: c for c in latest_counts}

    result = []
    for t in tools:
        s = stock_map.get(t.id)
        system_qty = s.quantity if s else 0
        pc = count_map.get(t.id)
        result.append({
            "tool_id": t.id,
            "tool_name": t.name,
            "category": t.category.name if t.category else "Uncategorized",
            "system_qty": system_qty,
            "physical_qty": pc.physical_quantity if pc else None,
            "variance": (pc.physical_quantity - system_qty) if pc else None,
            "last_counted": pc.counted_at.isoformat() if pc else None,
            "has_discrepancy": (pc.physical_quantity != system_qty) if pc else False,
        })

    return jsonify(result), 200


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

    tool_ids = list({c.tool_id for c in counts})

    # Batch all aggregates once — avoids 6 queries per count record
    opening_map: dict = {}
    delivered_map: dict = {}
    received_map: dict = {}
    transfers_in_map: dict = {}
    distributed_map: dict = {}
    transfers_out_map: dict = {}

    if tool_ids:
        for row in (
            db.session.query(
                FacilityStock.tool_id,
                func.coalesce(
                    func.sum(FacilityStock.opening_balance + FacilityStock.qty_received), 0
                ).label("total")
            )
            .filter(FacilityStock.tool_id.in_(tool_ids))
            .group_by(FacilityStock.tool_id)
            .all()
        ):
            opening_map[row.tool_id] = int(row.total)

        for row in (
            db.session.query(
                Delivery.tool_id,
                func.coalesce(func.sum(Delivery.quantity_supplied), 0).label("total")
            )
            .filter(Delivery.tool_id.in_(tool_ids), Delivery.is_delivered.is_(True))
            .group_by(Delivery.tool_id)
            .all()
        ):
            delivered_map[row.tool_id] = int(row.total)

        for row in (
            db.session.query(
                StockReceiptLine.tool_id,
                func.coalesce(func.sum(StockReceiptLine.quantity_received), 0).label("total")
            )
            .filter(StockReceiptLine.tool_id.in_(tool_ids))
            .group_by(StockReceiptLine.tool_id)
            .all()
        ):
            received_map[row.tool_id] = int(row.total)

        for row in (
            db.session.query(
                FacilityTransfer.tool_id,
                func.coalesce(func.sum(FacilityTransfer.quantity), 0).label("total")
            )
            .filter(FacilityTransfer.tool_id.in_(tool_ids), FacilityTransfer.status == "accepted")
            .group_by(FacilityTransfer.tool_id)
            .all()
        ):
            transfers_in_map[row.tool_id] = int(row.total)

        for row in (
            db.session.query(
                DepartmentDistribution.tool_id,
                func.coalesce(func.sum(DepartmentDistribution.quantity), 0).label("total")
            )
            .filter(DepartmentDistribution.tool_id.in_(tool_ids))
            .group_by(DepartmentDistribution.tool_id)
            .all()
        ):
            distributed_map[row.tool_id] = int(row.total)

        for row in (
            db.session.query(
                FacilityTransfer.tool_id,
                func.coalesce(func.sum(FacilityTransfer.quantity), 0).label("total")
            )
            .filter(
                FacilityTransfer.tool_id.in_(tool_ids),
                FacilityTransfer.status.in_(["pending", "accepted"])
            )
            .group_by(FacilityTransfer.tool_id)
            .all()
        ):
            transfers_out_map[row.tool_id] = int(row.total)

    result = []
    for c in counts:
        tid = c.tool_id
        state_quantity = (
            opening_map.get(tid, 0)
            + delivered_map.get(tid, 0)
            + received_map.get(tid, 0)
            + transfers_in_map.get(tid, 0)
            - distributed_map.get(tid, 0)
            - transfers_out_map.get(tid, 0)
        )
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
        except (ValueError, TypeError):
            return jsonify({"error": "category_id must be an integer"}), 400

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
        stored = current_user.password or ""
        if not (_looks_like_hash(stored) and _verify_password(stored, str(password))):
            return jsonify({"error": "Invalid password"}), 400

    t = Tool.query.get_or_404(tool_id)
    db.session.delete(t)
    db.session.commit()
    return jsonify({"ok": True}), 200


@api_bp.route("/tools/<int:tool_id>/logs", methods=["GET"])
@login_required
def tool_logs(tool_id):
    tool = Tool.query.get_or_404(tool_id)
    usages = []
    requests_log = []

    # 1. Direct usage records (ToolUsage)
    usage_rows = (
        db.session.query(ToolUsage, Users)
        .join(Users, Users.id == ToolUsage.user_id)
        .filter(ToolUsage.tool_id == tool_id)
        .all()
    )
    for usage, user in usage_rows:
        usages.append({
            "date": usage.date_used.isoformat() if usage.date_used else None,
            "quantity": int(usage.quantity_used or 0),
            "user_name": user.first_name if user else None,
            "facility": user.facility if user else None,
            "source": "tool_usage",
            "id": usage.id
        })

    # 2. Request/delivery records
    request_lines = (
        db.session.query(RequestedTool, RequestModel, Users)
        .join(RequestModel, RequestModel.id == RequestedTool.request_id)
        .join(Users, Users.id == RequestModel.user_id)
        .filter(RequestedTool.tool_id == tool_id)
        .filter(
            or_(
                func.lower(RequestModel.status) == "approved",
                func.lower(RequestedTool.status) == "approved",
                func.lower(RequestModel.status) == "pending",
                func.lower(RequestModel.status) == "pending supervisor review",
                func.lower(RequestModel.status) == "pending s.i review",
            )
        )
        .all()
    )
    for rt, req, user in request_lines:
        when = req.date_approved or req.date_requested
        requests_log.append({
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

    usages.sort(key=lambda x: (x.get("date") or "", x.get("id") or 0), reverse=True)
    requests_log.sort(key=lambda x: (x.get("date") or "", x.get("id") or 0), reverse=True)
    all_logs = sorted(usages + requests_log, key=lambda x: (x.get("date") or "", x.get("id") or 0), reverse=True)

    return jsonify({
        "tool_id": tool.id,
        "tool_name": tool.name,
        "usages": usages,
        "requests": requests_log,
        "distributions": all_logs,
        "logs": all_logs,
        "data": all_logs
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


@api_bp.route("/admin/users/<int:user_id>", methods=["PUT"])
@login_required
def admin_edit_user(user_id):
    """Admin: edit a user's name, email, role, facility."""
    if not _is_admin_user(current_user):
        return _admin_required_json()
    
    u = Users.query.get_or_404(user_id)
    data = _json_body()
    
    if "first_name" in data:
        u.first_name = (data.get("first_name") or "").strip()
    if "email" in data:
        new_email = (data.get("email") or "").strip().lower()
        if new_email and new_email != (u.email or "").lower():
            if Users.query.filter(func.lower(Users.email) == new_email, Users.id != user_id).first():
                return jsonify({"error": "Email already in use"}), 400
            u.email = new_email
    if "role" in data:
        u.role = (data.get("role") or "").strip().lower()
    if "facility" in data:
        u.facility = (data.get("facility") or "").strip()
    
    _audit("edit_user", "user", user_id)
    db.session.commit()
    return jsonify({"message": "User updated", "user": {
        "id": u.id, "username": u.username, "email": u.email,
        "first_name": u.first_name, "facility": u.facility,
        "role": u.role, "is_active": u.is_active_flag
    }}), 200


@api_bp.route("/admin/users/<int:user_id>/toggle-status", methods=["POST"])
@login_required
def admin_toggle_user_status(user_id):
    """Admin: enable or disable a user account."""
    if not _is_admin_user(current_user):
        return _admin_required_json()
    
    u = Users.query.get_or_404(user_id)
    if u.id == current_user.id:
        return jsonify({"error": "Cannot disable your own account"}), 400
    
    u.is_active_flag = not u.is_active_flag
    action = "enabled" if u.is_active_flag else "disabled"
    _audit("toggle_user_status", "user", user_id, {"action": action})
    db.session.commit()
    return jsonify({"message": f"User {action}", "is_active": u.is_active_flag}), 200


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
        return jsonify({"error": "Failed to load catalog"}), 500


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

    # Determine initial status based on supervisors
    from mailer import get_supervisors_for_facility, notify_facility_supervisor_of_request
    supervisor_emails = get_supervisors_for_facility(current_user.facility or "")
    si_setting = SystemSetting.query.filter_by(key="si_management_email").first()
    has_si = bool(si_setting and si_setting.value)

    if supervisor_emails:
        initial_status = "Pending Supervisor Review"
    elif has_si:
        initial_status = "Pending S.I Review"
    else:
        initial_status = "Pending"

    r = RequestModel(
        user_id=current_user.id,
        status=initial_status,
        date_requested=datetime.utcnow()
    )
    db.session.add(r)
    db.session.flush()

    tools_summary = []
    facility = current_user.facility or ""
    for it in items:
        tid = it.get("tool_id") or it.get("id")
        qty = _safe_int(it.get("quantity"), 0)
        if not tid or qty <= 0:
            continue

        # ─── Check duplicate: facility already has a pending request for this tool ───
        existing = (
            db.session.query(RequestedTool, RequestModel)
            .join(RequestModel, RequestedTool.request_id == RequestModel.id)
            .filter(
                RequestModel.user_id == current_user.id,
                RequestedTool.tool_id == int(tid),
                func.lower(RequestModel.status).in_([
                    "pending", "pending supervisor review", "pending s.i review", "approved"
                ])
            ).first()
        )
        if existing:
            rt_ex, req_ex = existing
            tool_check = Tool.query.get(int(tid))
            return jsonify({
                "error": f"You already have a {req_ex.status.lower()} request (#{req_ex.id}) for '{tool_check.name if tool_check else 'this tool'}'. Please wait for it to be processed.",
                "existing_request_id": req_ex.id,
                "existing_status": req_ex.status,
            }), 409

        # ─── Check stock warning: facility has >5 of this tool (informational only) ───
        warn_stock = None
        if facility:
            stock_check = FacilityStock.query.filter_by(facility=facility, tool_id=int(tid)).first()
            current_stock = stock_check.quantity if stock_check else 0
            tool_check = Tool.query.get(int(tid))
            threshold = tool_check.low_stock_threshold if tool_check and tool_check.low_stock_threshold is not None else 5
            if current_stock > threshold:
                warn_stock = {
                    "current_stock": current_stock,
                    "threshold": threshold,
                    "tool_name": tool_check.name if tool_check else "this tool"
                }

        db.session.add(RequestedTool(
            request_id=r.id,
            tool_id=int(tid),
            quantity=qty,
            status="Pending"
        ))
        tool = Tool.query.get(int(tid))
        tools_summary.append({
            "tool_id": int(tid),
            "name": tool.name if tool else "Unknown Tool",
            "quantity": qty,
        })

    db.session.commit()

    # ─── Trigger supervisor emails (in background thread so request returns fast) ───
    if supervisor_emails:
        emails_to_notify = list(supervisor_emails)
        req_id = r.id
        facility_name = current_user.facility or "Unknown Facility"
        requester_name = current_user.first_name or current_user.username or "Unknown"
        tools_snapshot = list(tools_summary)
        # Capture the real Flask app object now — `current_app` is a request-scoped
        # proxy and is NOT available inside the background thread.
        flask_app = current_app._get_current_object()

        def _send_emails():
            from mailer import notify_facility_supervisor_of_request
            for email in emails_to_notify:
                try:
                    # Push an app context in this thread: mailer hits the DB
                    # (SupervisorAction) and needs db.session, which is app-context scoped.
                    with flask_app.app_context():
                        ok = notify_facility_supervisor_of_request(
                            request_id=req_id,
                            facility_name=facility_name,
                            requester_name=requester_name,
                            tools_list=tools_snapshot,
                            supervisor_email=email,
                        )
                    if ok:
                        with flask_app.app_context():
                            db.session.add(EmailLog(request_id=req_id, email=email, role="facility_supervisor", status="sent"))
                            db.session.commit()
                    else:
                        with flask_app.app_context():
                            db.session.add(EmailLog(request_id=req_id, email=email, role="facility_supervisor", status="failed", error="send_email returned False"))
                            db.session.commit()
                        flask_app.logger.warning(f"Email to {email} failed to send (request #{req_id})")
                except Exception as e:
                    try:
                        with flask_app.app_context():
                            db.session.add(EmailLog(request_id=req_id, email=email, role="facility_supervisor", status="failed", error=str(e)))
                            db.session.commit()
                    except Exception:
                        pass
                    flask_app.logger.exception(f"Failed to notify supervisor {email}")

        threading.Thread(target=_send_emails, daemon=True).start()

    resp = {"message": "ok", "id": r.id}
    if warn_stock:
        resp["stock_warning"] = warn_stock
    return jsonify(resp), 201


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
        if status_filter == "pending":
            q = q.filter(func.lower(RequestModel.status).in_(["pending", "pending supervisor review", "pending s.i review"]))
        else:
            q = q.filter(func.lower(RequestModel.status) == status_filter)

    reqs = q.order_by(RequestModel.date_requested.desc()).all()

    # Batch-load all deliveries
    all_rt_ids = [ln.id for r in reqs for ln in (r.requested_tools or [])]
    deliveries_by_rt_id: dict = {}
    if all_rt_ids:
        for d in Delivery.query.filter(Delivery.requested_tool_id.in_(all_rt_ids)).all():
            deliveries_by_rt_id[d.requested_tool_id] = d

    # Batch: request-level supervisor actions
    all_req_ids = [r.id for r in reqs]
    supervisor_actions_map = {}
    if all_req_ids:
        for sa in SupervisorAction.query.filter(SupervisorAction.request_id.in_(all_req_ids)).order_by(SupervisorAction.created_at.desc()).all():
            supervisor_actions_map.setdefault(sa.request_id, []).append(sa)

    # Batch: latest supervisor email log per request (for resend tracking)
    email_status_map = {}
    if all_req_ids:
        for el in EmailLog.query.filter(
            EmailLog.request_id.in_(all_req_ids),
            EmailLog.role == "facility_supervisor",
        ).order_by(EmailLog.created_at.desc()).all():
            email_status_map.setdefault(el.request_id, el)

    # Lightweight batch: facility stocks (only for facilities in these requests)
    facilities_in_reqs = set()
    for r in reqs:
        u = getattr(r, "user", None)
        if u and u.facility:
            facilities_in_reqs.add(u.facility)
    facility_stock_map = {}
    if facilities_in_reqs:
        for fs in FacilityStock.query.filter(FacilityStock.facility.in_(facilities_in_reqs)).all():
            facility_stock_map[f"{fs.facility}|{fs.tool_id}"] = fs

    # Batch: last delivery per (facility, tool_id) for all request tools in these facilities
    tool_ids_in_reqs = set()
    for r in reqs:
        for ln in (r.requested_tools or []):
            tool_ids_in_reqs.add(ln.tool_id)
    last_delivery_map = {}
    if facilities_in_reqs and tool_ids_in_reqs:
        for d in (
            Delivery.query
            .join(Users, Delivery.received_by == Users.id)
            .filter(
                Users.facility.in_(facilities_in_reqs),
                Delivery.tool_id.in_(tool_ids_in_reqs),
                Delivery.is_delivered.is_(True)
            )
            .order_by(func.coalesce(Delivery.delivery_date, Delivery.delivery_confirmed_at).desc())
            .all()
        ):
            receiver = Users.query.get(d.received_by)
            fac = receiver.facility if receiver else ""
            key = f"{fac}|{d.tool_id}"
            if key not in last_delivery_map:
                last_delivery_map[key] = d

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

            delivery = deliveries_by_rt_id.get(ln.id)
            is_delivered = delivery.is_delivered if delivery else False

            # Last delivery info (from batch query)
            ld_key = f"{facility}|{ln.tool_id}"
            last_del = last_delivery_map.get(ld_key)
            last_delivery_date = (
                last_del.delivery_date.isoformat() if last_del and last_del.delivery_date
                else (last_del.delivery_confirmed_at.isoformat() if last_del and last_del.delivery_confirmed_at else None)
            )
            last_delivery_qty = last_del.quantity_supplied if last_del else None
            fs = facility_stock_map.get(ld_key)
            facility_stock_remaining = fs.quantity if fs else 0

            line_payload = {
                "id": ln.id,
                "line_id": ln.id,
                "tool_id": ln.tool_id,
                "tool_name": tool_name,
                "tool": tool_name,
                "name": tool_name,
                "quantity": qty,
                "qty": qty,
                "approved_quantity": ln.approved_quantity,
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
                "last_delivery_date": last_delivery_date,
                "last_delivery_qty": last_delivery_qty,
                "facility_stock_remaining": facility_stock_remaining,
            }
            lines.append(line_payload)

        summary = {
            "total_lines": len(lines),
            "total_items": int(total_qty),
        }

        # Supervisor actions for this request
        sa_list = supervisor_actions_map.get(r.id, [])
        supervisor_status = None
        si_status = None
        for sa in sa_list:
            if sa.reviewer_role == "facility_supervisor" and sa.action == "approved":
                supervisor_status = {"email": sa.reviewer_email, "action": sa.action, "date": sa.created_at.isoformat() if sa.created_at else None}
            elif sa.reviewer_role == "si_management" and sa.action in ("approved", "pending"):
                si_status = {"email": sa.reviewer_email, "action": sa.action, "date": sa.created_at.isoformat() if sa.created_at else None}

        payload = {
            "id": r.id,
            "request_id": r.id,
            "status": r.status,
            "supervisor_status": supervisor_status,
            "si_status": si_status,
            "supervisor_email": email_status_map.get(r.id).to_dict() if email_status_map.get(r.id) else None,
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


@api_bp.route("/admin/requests/<int:req_id>/resend-supervisor", methods=["POST"])
@login_required
def admin_resend_supervisor_email(req_id):
    """Re-sends the supervisor approval notification for a request and logs the result."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    r = (
        RequestModel.query.options(
            joinedload(RequestModel.user),
            joinedload(RequestModel.requested_tools).joinedload(RequestedTool.tool),
        )
        .filter(RequestModel.id == req_id)
        .first()
    )
    if not r:
        return jsonify({"error": "Request not found"}), 404

    from mailer import get_supervisors_for_facility, notify_facility_supervisor_of_request

    facility_name = (r.user.facility if r.user else "") or "Unknown Facility"
    requester_name = (r.user.first_name if r.user and r.user.first_name else (r.user.username if r.user else "Unknown"))

    tools_list = []
    for rt in (r.requested_tools or []):
        t = rt.tool
        tools_list.append({
            "tool_id": rt.tool_id,
            "name": t.name if t else "Unknown Tool",
            "quantity": rt.quantity,
        })

    supervisors = get_supervisors_for_facility(facility_name)
    if not supervisors:
        return jsonify({"error": f"No supervisor email found for facility '{facility_name}'."}), 404

    results = []
    for email in supervisors:
        try:
            ok = notify_facility_supervisor_of_request(
                request_id=r.id,
                facility_name=facility_name,
                requester_name=requester_name,
                tools_list=tools_list,
                supervisor_email=email,
            )
            db.session.add(EmailLog(
                request_id=r.id,
                email=email,
                role="facility_supervisor",
                status="sent" if ok else "failed",
                error=None if ok else "send_email returned False",
            ))
            db.session.commit()
            results.append({"email": email, "status": "sent" if ok else "failed"})
        except Exception as e:
            db.session.add(EmailLog(
                request_id=r.id,
                email=email,
                role="facility_supervisor",
                status="failed",
                error=str(e),
            ))
            db.session.commit()
            results.append({"email": email, "status": "failed", "error": str(e)})

    all_ok = all(x["status"] == "sent" for x in results)
    return jsonify({
        "message": "Supervisor email(s) sent successfully." if all_ok else "Some supervisor email(s) failed to send.",
        "results": results,
    }), 200 if all_ok else 207


def _approval_qty(ln):
    """Quantity that should actually be approved/dispatched for a line: the
    S.I.-approved quantity when the S.I. adjusted it, otherwise the requested
    quantity. This is what the admin approval, batch approval and the delivery
    confirmation all honor."""
    return int(ln.approved_quantity if ln.approved_quantity is not None else (ln.quantity or 0))


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

    if (r.status or "").lower() not in ("pending", "pending supervisor review", "pending s.i review"):
        return jsonify({"error": "Only pending requests can be approved"}), 400

    now = datetime.utcnow()

    for ln in (r.requested_tools or []):
        tool = ln.tool
        if not tool:
            continue

        need = _approval_qty(ln)
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

    # ---------- Create Delivery stubs (one per approved line, awaiting user confirmation) ----------
    requester = Users.query.get(r.user_id) if r.user_id else None
    delivery_ids = []
    for ln in (r.requested_tools or []):
        if (ln.status or "").lower() != "approved":
            continue
        if not ln.tool:
            continue

        # Skip if a Delivery record already exists for this line
        if Delivery.query.filter_by(requested_tool_id=ln.id).first():
            continue

        delivery = Delivery(
            request_id=r.id,
            tool_id=ln.tool_id,
            requested_tool_id=ln.id,
            quantity_supplied=_approval_qty(ln),
            basic_unit="unit",
            distributed_by=current_user.id,
            received_by=r.user_id,
            witnessed_by="",
            delivery_date=now,
            is_delivered=False,
        )
        db.session.add(delivery)
        db.session.flush()
        delivery_ids.append(delivery.id)

    _audit("approve_request", "request", r.id, {"facility": requester.facility if requester else None, "items": len(delivery_ids)})
    db.session.commit()

    if requester:
        try:
            send_notification_to_admins({
                "type": "request_approved",
                "title": "Request Approved",
                "message": f"Request #{r.id} for {requester.first_name or requester.username} has been approved.",
                "request_id": r.id,
                "facility": requester.facility or "Unknown",
            })
        except Exception:
            pass
        try:
            send_notification_to_user(r.user_id, {
                "type": "request_approved",
                "title": "Request Approved",
                "message": f"Your request #{r.id} has been approved. Items will be delivered to your facility.",
                "request_id": r.id,
            })
        except Exception:
            pass

    return jsonify({
        "message": "approved",
        "delivery_ids": delivery_ids,
    }), 200


@api_bp.route("/admin/requests/<int:req_id>/reject", methods=["POST"])
@login_required
def admin_reject_request(req_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    r = RequestModel.query.options(joinedload(RequestModel.requested_tools)).get(req_id)
    if not r:
        return jsonify({"error": "Request not found"}), 404

    if (r.status or "").lower() not in ("pending", "pending supervisor review", "pending s.i review"):
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

    _audit("reject_request", "request", r.id, {"reason": reason})
    db.session.commit()

    requester = Users.query.get(r.user_id)
    if requester:
        try:
            send_notification_to_user(r.user_id, {
                "type": "request_rejected",
                "title": "Request Rejected",
                "message": f"Your request #{r.id} was rejected." + (f" Reason: {reason}" if reason else ""),
                "request_id": r.id,
                "reason": reason,
            })
        except Exception:
            pass

    return jsonify({"message": "rejected"}), 200


@api_bp.route("/admin/requests/<int:req_id>", methods=["PUT"])
@login_required
def admin_edit_request(req_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()

    r = RequestModel.query.options(joinedload(RequestModel.requested_tools)).get(req_id)
    if not r:
        return jsonify({"error": "Request not found"}), 404

    if (r.status or "").lower() not in ("pending", "pending supervisor review", "pending s.i review"):
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
        if "approved_quantity" in patch:
            ln.approved_quantity = _safe_int(patch.get("approved_quantity"), ln.approved_quantity)
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

    if (r.status or "").lower() not in ("pending", "pending supervisor review", "pending s.i review"):
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
        .filter(func.lower(RequestModel.status).in_(["pending", "pending supervisor review", "pending s.i review"]))
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


@api_bp.route("/delivery/confirm-request/<int:request_id>", methods=["POST"])
@login_required
def confirm_request_delivery(request_id):
    """Confirm receipt of ALL approved items in a request at once (one action, one delivery note)."""
    request_obj = RequestModel.query.get_or_404(request_id)

    if request_obj.user_id != current_user.id:
        return jsonify({"error": "Unauthorized — this request does not belong to you"}), 403

    if (request_obj.status or "").lower() != "approved":
        return jsonify({"error": "Only approved requests can be confirmed as delivered"}), 400

    data = _json_body()
    witnessed_by = (data.get("witnessed_by") or "").strip()
    basic_unit = data.get("basic_unit") or "unit"
    # actual_quantities: {str(line_id): int} — facility user enters what physically arrived
    actual_quantities = data.get("actual_quantities") or {}
    now = datetime.utcnow()

    approved_lines = RequestedTool.query.filter_by(
        request_id=request_id, status="Approved"
    ).all()

    if not approved_lines:
        return jsonify({"error": "No approved items to confirm"}), 400

    facility = current_user.facility or ""
    delivery_ids = []
    for line in approved_lines:
        # Use actual received qty if supplied, fall back to the S.I.-approved qty
        # (or requested qty if the S.I. never adjusted it).
        approved_qty = _approval_qty(line)
        raw = actual_quantities.get(str(line.id))
        qty = max(0, int(raw)) if raw is not None else approved_qty

        existing = Delivery.query.filter_by(requested_tool_id=line.id).first()
        if existing:
            if existing.is_delivered:
                delivery_ids.append(existing.id)
                continue
            existing.is_delivered = True
            existing.delivery_confirmed_at = now
            existing.witnessed_by = witnessed_by
            existing.basic_unit = basic_unit
            existing.quantity_supplied = qty
            delivery_ids.append(existing.id)
        else:
            d = Delivery(
                request_id=request_id,
                tool_id=line.tool_id,
                requested_tool_id=line.id,
                quantity_supplied=qty,
                basic_unit=basic_unit,
                distributed_by=getattr(request_obj, "approved_by_id", None),
                received_by=current_user.id,
                witnessed_by=witnessed_by,
                delivery_date=now,
                delivery_confirmed_at=now,
                is_delivered=True,
            )
            db.session.add(d)
            db.session.flush()
            delivery_ids.append(d.id)

        # Auto-update FacilityStock using the actual received quantity
        if facility and line.tool_id and qty > 0:
            fs = FacilityStock.query.filter_by(
                facility=facility, tool_id=line.tool_id
            ).first()
            if fs:
                fs.quantity     += qty
                fs.qty_received += qty
            else:
                fs = FacilityStock(
                    facility=facility,
                    tool_id=line.tool_id,
                    quantity=qty,
                    opening_balance=0,
                    qty_received=qty,
                )
                db.session.add(fs)

    # Mark the request as Delivered now that the facility has confirmed receipt
    request_obj.status = "Delivered"

    _audit("confirm_delivery", "request", request_id, {"items": len(approved_lines), "facility": facility})
    db.session.commit()

    requester_name = current_user.first_name or current_user.username
    facility = facility or "Unknown Facility"
    try:
        send_notification_to_admins({
            "type": "delivery_confirmed",
            "title": "Delivery Confirmed",
            "message": (
                f"{requester_name} from {facility} confirmed receipt of "
                f"{len(approved_lines)} item(s) from Request #{request_id}"
            ),
            "request_id": request_id,
            "delivery_id": delivery_ids[0] if delivery_ids else None,
            "facility": facility,
            "requester": requester_name,
            "timestamp": now.isoformat(),
        })
    except Exception:
        pass

    return jsonify({
        "message": "All items confirmed successfully",
        "confirmed_count": len(approved_lines),
        "delivery_ids": delivery_ids,
    }), 200


@api_bp.route("/delivery/concern/<int:request_id>", methods=["POST"])
@login_required
def raise_delivery_concern(request_id):
    """Facility user raises a concern: actual quantities received differ from what was sent."""
    request_obj = RequestModel.query.get_or_404(request_id)

    if request_obj.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403

    status_lower = (request_obj.status or "").lower()
    if status_lower not in ("approved",):
        return jsonify({"error": "Can only raise concerns for approved requests"}), 400

    # Block duplicate pending concerns for the same request
    existing = DeliveryConcern.query.filter_by(request_id=request_id, status='pending').first()
    if existing:
        return jsonify({"error": "A concern is already pending for this request"}), 400

    data = _json_body()
    concern_note = (data.get("concern_note") or "").strip()
    actual_quantities = data.get("actual_quantities") or {}

    if not concern_note:
        return jsonify({"error": "Please describe your concern"}), 400

    concern = DeliveryConcern(
        request_id=request_id,
        raised_by=current_user.id,
        facility=current_user.facility or "",
        concern_note=concern_note,
        actual_quantities=json.dumps({str(k): int(v) for k, v in actual_quantities.items()}),
        status='pending',
    )
    db.session.add(concern)
    db.session.commit()

    _audit("raise_concern", "request", request_id, {
        "facility": current_user.facility,
        "concern_note": concern_note,
        "concern_id": concern.id,
    })

    # Alert all admin users via SSE
    raiser_name = current_user.first_name or current_user.username
    send_notification_to_admins({
        "type": "delivery_concern",
        "title": "Delivery Concern Raised",
        "message": (
            f"{raiser_name} from {current_user.facility} raised a concern "
            f"about the quantities received for Request #{request_id}"
        ),
        "request_id": request_id,
        "concern_id": concern.id,
        "facility": current_user.facility,
        "timestamp": datetime.utcnow().isoformat(),
    })

    return jsonify({"message": "Concern submitted successfully", "concern_id": concern.id}), 201


@api_bp.route("/admin/delivery-concerns", methods=["GET"])
@login_required
def list_delivery_concerns():
    """Admin: list delivery concerns, newest first."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    status_filter = request.args.get("status", "pending")
    q = DeliveryConcern.query
    if status_filter != "all":
        q = q.filter_by(status=status_filter)
    concerns = q.order_by(DeliveryConcern.created_at.desc()).all()

    result = []
    for c in concerns:
        # Enrich with the request lines so admin can see tool names + sent qty vs claimed qty
        lines = RequestedTool.query.filter_by(request_id=c.request_id, status="Approved").all()
        actual = json.loads(c.actual_quantities) if c.actual_quantities else {}
        result.append({
            **c.to_dict(),
            "lines": [
                {
                    "id": ln.id,
                    "tool_name": ln.tool.name if ln.tool else "—",
                    "sent_qty": ln.quantity,
                    "claimed_qty": actual.get(str(ln.id)),
                }
                for ln in lines
            ],
        })

    return jsonify(result), 200


@api_bp.route("/admin/delivery-concerns/<int:concern_id>/accept", methods=["POST"])
@login_required
def accept_delivery_concern(concern_id):
    """Admin accepts concern: use the claimed quantities, update stock, mark request Delivered."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    concern = DeliveryConcern.query.get_or_404(concern_id)
    if concern.status != 'pending':
        return jsonify({"error": "This concern has already been reviewed"}), 400

    request_obj = RequestModel.query.get_or_404(concern.request_id)
    actual_quantities = json.loads(concern.actual_quantities) if concern.actual_quantities else {}

    approved_lines = RequestedTool.query.filter_by(
        request_id=concern.request_id, status="Approved"
    ).all()

    now = datetime.utcnow()
    facility = concern.facility
    delivery_ids = []

    for line in approved_lines:
        approved_qty = int(line.quantity or 0)
        raw = actual_quantities.get(str(line.id))
        qty = max(0, int(raw)) if raw is not None else approved_qty

        existing = Delivery.query.filter_by(requested_tool_id=line.id).first()
        if existing:
            if existing.is_delivered:
                delivery_ids.append(existing.id)
                continue
            existing.is_delivered = True
            existing.delivery_confirmed_at = now
            existing.quantity_supplied = qty
            delivery_ids.append(existing.id)
        else:
            d = Delivery(
                request_id=concern.request_id,
                tool_id=line.tool_id,
                requested_tool_id=line.id,
                quantity_supplied=qty,
                basic_unit="unit",
                distributed_by=getattr(request_obj, "approved_by_id", None),
                received_by=concern.raised_by,
                witnessed_by="",
                delivery_date=now,
                delivery_confirmed_at=now,
                is_delivered=True,
            )
            db.session.add(d)
            db.session.flush()
            delivery_ids.append(d.id)

        if facility and line.tool_id and qty > 0:
            fs = FacilityStock.query.filter_by(facility=facility, tool_id=line.tool_id).first()
            if fs:
                fs.quantity     += qty
                fs.qty_received += qty
            else:
                db.session.add(FacilityStock(
                    facility=facility, tool_id=line.tool_id,
                    quantity=qty, opening_balance=0, qty_received=qty,
                ))

    request_obj.status = "Delivered"
    concern.status = "accepted"
    concern.reviewed_by = current_user.id
    concern.reviewed_at = now

    _audit("accept_concern", "delivery_concern", concern_id, {
        "request_id": concern.request_id, "facility": facility,
    })
    db.session.commit()

    # Notify the facility user that their concern was accepted
    raiser = Users.query.get(concern.raised_by)
    if raiser:
        send_notification_to_user(raiser.id, {
            "type": "concern_accepted",
            "title": "Delivery Concern Accepted",
            "message": (
                f"Admin accepted your concern for Request #{concern.request_id}. "
                f"Your reported quantities have been recorded and stock has been updated."
            ),
            "request_id": concern.request_id,
            "timestamp": now.isoformat(),
        })

    return jsonify({"message": "Concern accepted — delivery confirmed and stock updated"}), 200


@api_bp.route("/admin/delivery-concerns/<int:concern_id>/reject", methods=["POST"])
@login_required
def reject_delivery_concern(concern_id):
    """Admin rejects concern: send warning back to facility user to accept original quantities."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    concern = DeliveryConcern.query.get_or_404(concern_id)
    if concern.status != 'pending':
        return jsonify({"error": "This concern has already been reviewed"}), 400

    data = _json_body()
    reject_note = (data.get("reject_note") or "").strip()

    now = datetime.utcnow()
    concern.status = "rejected"
    concern.reviewed_by = current_user.id
    concern.reviewed_at = now

    _audit("reject_concern", "delivery_concern", concern_id, {
        "request_id": concern.request_id,
        "facility": concern.facility,
        "reject_note": reject_note,
    })
    db.session.commit()

    # Notify the facility user to confirm the original quantities
    raiser = Users.query.get(concern.raised_by)
    if raiser:
        send_notification_to_user(raiser.id, {
            "type": "concern_rejected",
            "title": "Delivery Concern Rejected",
            "message": (
                f"Admin rejected your concern for Request #{concern.request_id}. "
                f"Please confirm receipt of the original quantities that were sent."
                + (f" Admin note: {reject_note}" if reject_note else "")
            ),
            "request_id": concern.request_id,
            "timestamp": now.isoformat(),
        })

    return jsonify({"message": "Concern rejected — facility user notified"}), 200


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
        Delivery.is_delivered.is_(True)
    )
    
    # For non-admin users, only show their own delivery notifications
    if not is_admin:
        query = query.filter(Delivery.received_by == current_user.id)
    
    recent_deliveries = query.order_by(
        Delivery.delivery_confirmed_at.desc()
    ).limit(50).all()
    
    notifications = []
    read_delivery_ids = set(
        row[0] for row in db.session.query(NotificationRead.delivery_id)
        .filter(NotificationRead.user_id == current_user.id).all()
    )

    for delivery, tool, user in recent_deliveries:
        tool_name = tool.name if tool else "Unknown Tool"
        user_name = (user.first_name or user.username) if user else "Unknown"
        user_facility = user.facility if user else "Unknown"
        notifications.append({
            "id": delivery.id,
            "type": "delivery_confirmed",
            "title": "Delivery Confirmed",
            "message": (
                f"{user_name} from {user_facility} confirmed receipt of "
                f"{delivery.quantity_supplied} × {tool_name}"
            ) if is_admin else (
                f"Your delivery of {delivery.quantity_supplied} × {tool_name} has been confirmed."
            ),
            "request_id": delivery.request_id,
            "delivery_id": delivery.id,
            "tool_name": tool_name,
            "quantity": delivery.quantity_supplied,
            "facility": user_facility,
            "requester": user_name,
            "timestamp": delivery.delivery_confirmed_at.isoformat() if delivery.delivery_confirmed_at else None,
            "is_read": delivery.id in read_delivery_ids,
        })

    # For facility users: also surface request approval / rejection events
    if not is_admin:
        recent_reqs = RequestModel.query.filter(
            RequestModel.user_id == current_user.id,
            RequestModel.status.in_(["Approved", "Rejected"]),
            or_(
                and_(RequestModel.date_approved.isnot(None), RequestModel.date_approved >= seven_days_ago),
                and_(RequestModel.date_rejected.isnot(None), RequestModel.date_rejected >= seven_days_ago),
            )
        ).limit(30).all()

        for req in recent_reqs:
            if req.status == "Approved" and req.date_approved:
                notifications.append({
                    "id": f"req_appr_{req.id}",
                    "type": "request_approved",
                    "title": "Request Approved",
                    "message": f"Your request #{req.id} has been approved. Items will be delivered to your facility.",
                    "request_id": req.id,
                    "timestamp": req.date_approved.isoformat(),
                    "is_read": False,  # tracked client-side via localStorage
                })
            elif req.status == "Rejected" and req.date_rejected:
                notifications.append({
                    "id": f"req_rej_{req.id}",
                    "type": "request_rejected",
                    "title": "Request Rejected",
                    "message": (
                        f"Your request #{req.id} was rejected."
                        + (f" Reason: {req.rejection_reason}" if req.rejection_reason else "")
                    ),
                    "request_id": req.id,
                    "reason": req.rejection_reason or "",
                    "timestamp": req.date_rejected.isoformat(),
                    "is_read": False,
                })

    # Sort all notifications newest-first
    notifications.sort(key=lambda n: n.get("timestamp") or "", reverse=True)

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
        Delivery.is_delivered.is_(True)
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

def _generate_request_delivery_note_pdf_data(request_id):
    """Generate one consolidated PDF for ALL approved items in a request."""
    from types import SimpleNamespace

    request_obj = RequestModel.query.get(request_id)
    if not request_obj:
        return None, "Request not found.", None

    # Use all approved RequestedTool lines — not just confirmed Delivery records.
    # This ensures the PDF always lists every item in the request.
    approved_lines = RequestedTool.query.filter_by(
        request_id=request_id, status="Approved"
    ).all()
    if not approved_lines:
        # Fall back to any Delivery records so old data still works
        approved_lines = []

    # Also check for any Delivery records (to get witnessed_by / basic_unit)
    delivery_map = {
        d.requested_tool_id: d
        for d in Delivery.query.filter_by(request_id=request_id).all()
    }

    if not approved_lines and not delivery_map:
        return None, "No approved items found for this request.", None

    # Build SimpleNamespace items that mimic Delivery objects for create_delivery_note_pdf
    if approved_lines:
        items = []
        for line in approved_lines:
            d = delivery_map.get(line.id)
            items.append(SimpleNamespace(
                tool_id=line.tool_id,
                quantity_supplied=line.quantity,
                basic_unit=(d.basic_unit if d and d.basic_unit else "unit"),
                witnessed_by=(d.witnessed_by if d else ""),
                request_id=request_id,
            ))
    else:
        # Fallback: use Delivery objects directly
        items = list(delivery_map.values())

    requester = Users.query.get(request_obj.user_id)
    if not requester:
        return None, "Associated user account not found.", None

    # Find distributor from delivery records or from approver field
    distributor = None
    for d in delivery_map.values():
        if d.distributed_by:
            distributor = Users.query.get(d.distributed_by)
            break
    if not distributor and getattr(request_obj, "approved_by_id", None):
        distributor = Users.query.get(request_obj.approved_by_id)
    if not distributor:
        distributor = current_user

    try:
        pdf_data = create_delivery_note_pdf(
            deliveries=items,
            requester=requester,
            distributor=distributor,
            request_obj=request_obj,
        )
        filename = f"delivery_note_req_{request_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        return pdf_data, None, filename
    except Exception as e:
        current_app.logger.exception("Failed to generate request delivery note")
        return None, f"Failed to generate delivery note: {str(e)}", None


def _generate_delivery_note_pdf_data(delivery_id):
    """Helper function to generate delivery note PDF data for a single delivery."""
    delivery = Delivery.query.get_or_404(delivery_id)
    # Redirect to request-level PDF to include all tools
    return _generate_request_delivery_note_pdf_data(delivery.request_id)


@api_bp.route("/delivery/generate-note/<int:delivery_id>", methods=["POST"])
@login_required
def generate_delivery_note(delivery_id):
    """Generate PDF delivery note for confirmed delivery (includes all tools from same request)."""
    delivery = Delivery.query.get_or_404(delivery_id)
    request_obj = RequestModel.query.get(delivery.request_id)
    is_authorized = (
        _is_admin_user(current_user) or 
        (request_obj and request_obj.user_id == current_user.id)
    )
    
    if not is_authorized:
        return _admin_required_json()
    
    pdf_data, error, filename = _generate_request_delivery_note_pdf_data(delivery.request_id)
    if error:
        return jsonify({"error": error}), 404 if "deleted" in error or "not found" in error else 500
    
    return send_file(
        BytesIO(pdf_data),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=filename
    )


@api_bp.route("/delivery/generate-request-note/<int:request_id>", methods=["POST"])
@login_required
def generate_request_delivery_note(request_id):
    """Generate PDF delivery note for an entire request."""
    deliveries = Delivery.query.filter_by(request_id=request_id, is_delivered=True).first()
    if not deliveries:
        return jsonify({"error": "No confirmed deliveries for this request"}), 404
    
    request_obj = RequestModel.query.get(request_id)
    is_authorized = (
        _is_admin_user(current_user) or 
        (request_obj and request_obj.user_id == current_user.id)
    )
    
    if not is_authorized:
        return _admin_required_json()
    
    pdf_data, error, filename = _generate_request_delivery_note_pdf_data(request_id)
    if error:
        return jsonify({"error": error}), 404 if "deleted" in error or "not found" in error else 500
    
    return send_file(
        BytesIO(pdf_data),
        mimetype='application/pdf',
        as_attachment=True,
        download_name=filename
    )


@api_bp.route("/delivery/preview/<int:request_id>", methods=["GET"])
@login_required
def get_delivery_note_preview(request_id):
    """Return JSON preview data for ALL approved items in a request's delivery note."""
    request_obj = RequestModel.query.get(request_id)
    if not request_obj:
        return jsonify({"error": "Request not found"}), 404

    approved_lines = RequestedTool.query.filter_by(
        request_id=request_id, status="Approved"
    ).all()
    if not approved_lines:
        return jsonify({"error": "No approved items found for this request"}), 404

    delivery_map = {
        d.requested_tool_id: d
        for d in Delivery.query.filter_by(request_id=request_id).all()
    }

    requester = Users.query.get(request_obj.user_id)
    distributor = None
    for d in delivery_map.values():
        if d.distributed_by:
            distributor = Users.query.get(d.distributed_by)
            break
    if not distributor and getattr(request_obj, "approved_by_id", None):
        distributor = Users.query.get(request_obj.approved_by_id)

    def _unit_display(raw):
        if not raw: return "Unit"
        return {'register':'Register','booklet':'Booklet','pack':'Pack','unit':'Unit'}.get(raw, str(raw).capitalize())

    items = []
    for line in approved_lines:
        d = delivery_map.get(line.id)
        tool_obj = Tool.query.get(line.tool_id)
        items.append({
            "delivery_id": d.id if d else None,
            "tool_name": tool_obj.name if tool_obj else f"Tool #{line.tool_id}",
            "quantity_supplied": line.quantity,
            "basic_unit": _unit_display(d.basic_unit if d else None),
            "witnessed_by": (d.witnessed_by or "") if d else "",
            "delivery_date": d.delivery_date.isoformat() if d and d.delivery_date else None,
        })
    
    return jsonify({
        "request_id": request_id,
        "facility": requester.facility if requester else "Unknown",
        "received_by_name": f"{requester.first_name} {requester.other_name or ''}".strip() if requester else "Unknown",
        "received_by_email": requester.email if requester else "",
        "distributed_by_name": f"{distributor.first_name} {getattr(distributor, 'other_name', '') or ''}".strip() if distributor else "Admin",
        "distributed_by_role": (getattr(distributor, 'role', None) or getattr(distributor, 'roles', None) or "Admin") if distributor else "Admin",
        "request_status": request_obj.status if request_obj else "Unknown",
        "delivery_confirmed_at": next((d.delivery_confirmed_at.isoformat() for d in delivery_map.values() if d.delivery_confirmed_at), None),
        "items": items
    }), 200


@api_bp.route("/delivery/pending-confirmations", methods=["GET"])
@login_required
def get_pending_delivery_confirmations():
    """Admin endpoint: Get all approved deliveries waiting for facility user confirmation."""
    if not _is_admin_user(current_user):
        return _admin_required_json()
    
    confirmed_deliveries = db.session.query(Delivery.requested_tool_id).filter(
        Delivery.is_delivered.is_(True)
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
    """List confirmed delivery notes grouped by request_id. Facility users see only their own; admins see all."""
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
        Delivery.is_delivered.is_(True)
    )
    
    if not is_admin:
        query = query.filter(Delivery.received_by == current_user.id)
    
    deliveries = query.order_by(
        Delivery.delivery_confirmed_at.desc().nullslast(),
        Delivery.delivery_date.desc().nullslast(),
        Delivery.created_at.desc()
    ).all()
    
    # Group by request_id
    grouped = {}
    for delivery, tool, user, req in deliveries:
        rid = delivery.request_id
        if rid not in grouped:
            grouped[rid] = {
                "request_id": rid,
                "facility": user.facility if user else "Unknown",
                "received_by_name": (user.first_name or user.username) if user else "Unknown",
                "delivery_date": delivery.delivery_date.isoformat() if delivery.delivery_date else None,
                "delivery_confirmed_at": delivery.delivery_confirmed_at.isoformat() if delivery.delivery_confirmed_at else None,
                "request_status": req.status if req else "Unknown",
                "has_note": bool(delivery.delivery_note_generated_at),
                "items": []
            }
        grouped[rid]["items"].append({
            "delivery_id": delivery.id,
            "tool_id": delivery.tool_id,
            "tool_name": tool.name if tool else "Unknown Tool",
            "quantity_supplied": delivery.quantity_supplied,
            "basic_unit": delivery.basic_unit,
            "witnessed_by": delivery.witnessed_by,
        })
        # If any delivery in the group has a note, mark the group
        if delivery.delivery_note_generated_at:
            grouped[rid]["has_note"] = True
    
    result = list(grouped.values())
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
        .filter(Delivery.is_delivered.is_(True))
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
    """SSE endpoint for real-time notifications — available to all authenticated users."""
    user_id = current_user.id

    def event_stream():
        # Release the DB connection immediately — the SSE loop does no DB work.
        # This prevents Aiven's idle-connection timeout from killing the connection
        # while the stream is open, which would cause a crash on teardown rollback.
        try:
            db.session.remove()
        except Exception:
            pass

        q = queue.Queue()
        connection_queues[user_id] = q
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    data = q.get(timeout=30)
                    yield f"data: {json.dumps(data)}\n\n"
                except queue.Empty:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        except GeneratorExit:
            pass
        finally:
            connection_queues.pop(user_id, None)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


def send_notification_to_user(user_id, notification):
    """Push a real-time notification to a specific connected user."""
    notification.setdefault('timestamp', datetime.utcnow().isoformat())
    q = connection_queues.get(user_id)
    if q:
        try:
            q.put(notification)
        except Exception:
            connection_queues.pop(user_id, None)


def send_notification_to_admins(notification):
    """Push a real-time notification to all connected admin users."""
    notification.setdefault('timestamp', datetime.utcnow().isoformat())
    for conn_id, q in list(connection_queues.items()):
        user = Users.query.get(conn_id)
        if user and _is_admin_user(user):
            try:
                q.put(notification)
            except Exception:
                connection_queues.pop(conn_id, None)

# =============================================================================
# AUDIT LOG
# =============================================================================

@api_bp.route("/admin/audit-log", methods=["GET"])
@login_required
def get_audit_log():
    if not _is_admin_user(current_user):
        return _admin_required_json()
    page     = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    action   = request.args.get("action", "").strip()
    entity   = request.args.get("entity_type", "").strip()
    user_id  = request.args.get("user_id", "").strip()

    q = AuditLog.query.order_by(AuditLog.created_at.desc())
    if action:
        q = q.filter(AuditLog.action.ilike(f"%{action}%"))
    if entity:
        q = q.filter(AuditLog.entity_type == entity)
    if user_id:
        q = q.filter(AuditLog.user_id == int(user_id))

    total  = q.count()
    items  = q.offset((page - 1) * per_page).limit(per_page).all()
    return jsonify({
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [i.to_dict() for i in items],
    }), 200


# =============================================================================
# REQUEST COMMENTS
# =============================================================================

@api_bp.route("/requests/<int:req_id>/comments", methods=["GET"])
@login_required
def list_request_comments(req_id):
    r = RequestModel.query.get_or_404(req_id)
    # Requester can see their own; admin can see all
    if not _is_admin_user(current_user) and r.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403
    comments = RequestComment.query.filter_by(request_id=req_id).order_by(RequestComment.created_at.asc()).all()
    return jsonify([c.to_dict() for c in comments]), 200


@api_bp.route("/requests/<int:req_id>/comments", methods=["POST"])
@login_required
def add_request_comment(req_id):
    r = RequestModel.query.get_or_404(req_id)
    if not _is_admin_user(current_user) and r.user_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403
    data    = _json_body()
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message is required"}), 400

    comment = RequestComment(request_id=req_id, user_id=current_user.id, message=message)
    db.session.add(comment)
    _audit("add_comment", "request", req_id, {"message_len": len(message)})
    db.session.commit()

    # Notify the other party via SSE
    if _is_admin_user(current_user):
        send_notification_to_user(r.user_id, {
            "type": "request_comment",
            "title": "Admin commented on your request",
            "message": f"A comment was added to your request #{req_id}.",
            "request_id": req_id,
        })
    else:
        send_notification_to_admins({
            "type": "request_comment",
            "title": "Facility replied on a request",
            "message": f"User commented on request #{req_id}.",
            "request_id": req_id,
        })
    return jsonify(comment.to_dict()), 201


# =============================================================================
# BATCH APPROVE / REJECT
# =============================================================================

@api_bp.route("/admin/requests/batch-approve", methods=["POST"])
@login_required
def batch_approve_requests():
    if not _is_admin_user(current_user):
        return _admin_required_json()
    data = _json_body()
    ids  = data.get("ids", [])
    if not ids:
        return jsonify({"error": "No request IDs provided"}), 400

    approved, skipped = [], []
    now = datetime.utcnow()

    for req_id in ids:
        r = RequestModel.query.options(joinedload(RequestModel.requested_tools)).get(req_id)
        if not r or (r.status or "").lower() != "pending":
            skipped.append(req_id)
            continue

        r.status = "Approved"
        if hasattr(r, "date_approved"):
            r.date_approved = now
        if hasattr(r, "approved_by_id"):
            r.approved_by_id = current_user.id

        for ln in (r.requested_tools or []):
            if (ln.status or "").lower() != "pending":
                continue
            need = _approval_qty(ln)
            if need <= 0:
                continue
            ln.status = "Approved"
            if ln.tool:
                ln.tool.quantity = max(0, (ln.tool.quantity or 0) - need)
            if not Delivery.query.filter_by(requested_tool_id=ln.id).first():
                d = Delivery(
                    request_id=r.id, tool_id=ln.tool_id, requested_tool_id=ln.id,
                    quantity_supplied=need, basic_unit="unit",
                    distributed_by=current_user.id, received_by=r.user_id,
                    witnessed_by="", delivery_date=now, is_delivered=False,
                )
                db.session.add(d)

        _audit("batch_approve_request", "request", r.id)
        approved.append(req_id)

        requester = Users.query.get(r.user_id)
        if requester:
            try:
                send_notification_to_user(r.user_id, {
                    "type": "request_approved",
                    "title": "Request Approved",
                    "message": f"Your request #{r.id} has been approved.",
                    "request_id": r.id,
                })
            except Exception:
                pass

    db.session.commit()
    return jsonify({"approved": approved, "skipped": skipped}), 200


@api_bp.route("/admin/requests/batch-reject", methods=["POST"])
@login_required
def batch_reject_requests():
    if not _is_admin_user(current_user):
        return _admin_required_json()
    data   = _json_body()
    ids    = data.get("ids", [])
    reason = (data.get("reason") or "").strip()
    if not ids:
        return jsonify({"error": "No request IDs provided"}), 400

    rejected, skipped = [], []
    now = datetime.utcnow()

    for req_id in ids:
        r = RequestModel.query.options(joinedload(RequestModel.requested_tools)).get(req_id)
        if not r or (r.status or "").lower() != "pending":
            skipped.append(req_id)
            continue

        r.status = "Rejected"
        if hasattr(r, "date_rejected"):
            r.date_rejected = now
        if hasattr(r, "rejected_by_id"):
            r.rejected_by_id = current_user.id
        if hasattr(r, "rejection_reason"):
            r.rejection_reason = reason

        for ln in (r.requested_tools or []):
            ln.status = "Rejected"

        _audit("batch_reject_request", "request", r.id, {"reason": reason})
        rejected.append(req_id)

        requester = Users.query.get(r.user_id)
        if requester:
            try:
                send_notification_to_user(r.user_id, {
                    "type": "request_rejected",
                    "title": "Request Rejected",
                    "message": f"Your request #{r.id} was rejected." + (f" Reason: {reason}" if reason else ""),
                    "request_id": r.id,
                    "reason": reason,
                })
            except Exception:
                pass

    db.session.commit()
    return jsonify({"rejected": rejected, "skipped": skipped}), 200


# =============================================================================
# LOW STOCK ALERTS
# =============================================================================

@api_bp.route("/admin/low-stock", methods=["GET"])
@login_required
def get_low_stock():
    if not _is_admin_user(current_user):
        return _admin_required_json()
    threshold = request.args.get("threshold", type=int, default=None)
    q = Tool.query
    if threshold is not None:
        q = q.filter(Tool.quantity <= threshold)
    else:
        # Items where quantity <= their own threshold OR quantity == 0
        q = q.filter(
            or_(
                Tool.quantity == 0,
                and_(Tool.low_stock_threshold.isnot(None), Tool.quantity <= Tool.low_stock_threshold),
            )
        )
    tools = q.order_by(Tool.quantity.asc()).all()
    return jsonify([t.to_dict() for t in tools]), 200


@api_bp.route("/tools/<int:tool_id>/threshold", methods=["PUT"])
@login_required
def set_tool_threshold(tool_id):
    if not _is_admin_user(current_user):
        return _admin_required_json()
    tool = Tool.query.get_or_404(tool_id)
    data = _json_body()
    val  = data.get("low_stock_threshold")
    tool.low_stock_threshold = int(val) if val is not None else None
    _audit("set_threshold", "tool", tool_id, {"threshold": tool.low_stock_threshold})
    db.session.commit()
    return jsonify(tool.to_dict()), 200


# =============================================================================
# FACILITY DASHBOARD
# =============================================================================

@api_bp.route("/facility/dashboard", methods=["GET"])
@login_required
def facility_dashboard():
    facility = current_user.facility or ""

    # Recent requests for this user
    recent_requests = RequestModel.query.filter_by(user_id=current_user.id)\
        .order_by(RequestModel.date_requested.desc()).limit(10).all()

    # Counts
    total_requests  = RequestModel.query.filter_by(user_id=current_user.id).count()
    pending_count   = RequestModel.query.filter_by(user_id=current_user.id, status="Pending").count()
    approved_count  = RequestModel.query.filter_by(user_id=current_user.id, status="Approved").count()

    # Items awaiting user delivery confirmation
    awaiting_confirm = Delivery.query.filter_by(received_by=current_user.id, is_delivered=False).count()

    # Stock at this facility
    stock_items = FacilityStock.query.filter_by(facility=facility).all()
    low_stock_items = [s for s in stock_items if s.quantity == 0]

    # Incoming pending transfers
    incoming_transfers = FacilityTransfer.query.filter_by(
        to_facility=facility, status="pending"
    ).count() if facility else 0

    return jsonify({
        "facility": facility,
        "user_name": current_user.first_name,
        "stats": {
            "total_requests":    total_requests,
            "pending_requests":  pending_count,
            "approved_requests": approved_count,
            "awaiting_confirm":  awaiting_confirm,
            "stock_items":       len(stock_items),
            "out_of_stock":      len(low_stock_items),
            "incoming_transfers": incoming_transfers,
        },
        "recent_requests": [
            {
                "id": r.id,
                "status": r.status,
                "date_requested": r.date_requested.isoformat() if r.date_requested else None,
                "item_count": len(r.requested_tools or []),
                "tools": ", ".join(
                    t.tool.name for t in (r.requested_tools or []) if t.tool
                )[:80],
            }
            for r in recent_requests
        ],
        "stock_summary": [s.to_dict() for s in stock_items[:20]],
    }), 200


# =============================================================================
# MONTHLY CONSUMPTION REPORT
# =============================================================================

@api_bp.route("/reports/monthly-consumption", methods=["GET"])
@login_required
def monthly_consumption_report():
    if not _is_admin_user(current_user):
        return _admin_required_json()
    year  = int(request.args.get("year",  datetime.utcnow().year))
    month = int(request.args.get("month", datetime.utcnow().month))
    start = datetime(year, month, 1)
    _, last_day = monthrange(year, month)
    end   = datetime(year, month, last_day, 23, 59, 59)

    # Confirmed deliveries in this period
    deliveries = (
        db.session.query(Delivery, Tool, Users)
        .join(Tool,  Delivery.tool_id == Tool.id)
        .join(Users, Delivery.received_by == Users.id)
        .filter(Delivery.is_delivered.is_(True))
        .filter(Delivery.delivery_confirmed_at >= start)
        .filter(Delivery.delivery_confirmed_at <= end)
        .all()
    )

    # Group by facility then tool
    by_facility = {}
    for d, tool, user in deliveries:
        fac = user.facility or "Unknown"
        by_facility.setdefault(fac, {})
        key = tool.name
        by_facility[fac][key] = by_facility[fac].get(key, 0) + d.quantity_supplied

    rows = []
    for fac in sorted(by_facility.keys()):
        for tool_name in sorted(by_facility[fac].keys()):
            rows.append({
                "facility": fac,
                "tool": tool_name,
                "quantity": by_facility[fac][tool_name],
            })

    # Also tally new requests submitted this month
    requests_submitted = RequestModel.query.filter(
        RequestModel.date_requested >= start,
        RequestModel.date_requested <= end,
    ).count()
    requests_approved  = RequestModel.query.filter(
        RequestModel.date_approved >= start,
        RequestModel.date_approved <= end,
    ).count()

    return jsonify({
        "year": year,
        "month": month,
        "month_label": start.strftime("%B %Y"),
        "summary": {
            "requests_submitted": requests_submitted,
            "requests_approved":  requests_approved,
            "deliveries_confirmed": len(deliveries),
            "facilities_served":  len(by_facility),
        },
        "rows": rows,
    }), 200


@api_bp.route("/reports/monthly-consumption/download", methods=["GET"])
@login_required
def download_monthly_consumption():
    if not _is_admin_user(current_user):
        return _admin_required_json()
    year  = int(request.args.get("year",  datetime.utcnow().year))
    month = int(request.args.get("month", datetime.utcnow().month))
    start = datetime(year, month, 1)
    _, last_day = monthrange(year, month)
    end   = datetime(year, month, last_day, 23, 59, 59)

    deliveries = (
        db.session.query(Delivery, Tool, Users)
        .join(Tool,  Delivery.tool_id == Tool.id)
        .join(Users, Delivery.received_by == Users.id)
        .filter(Delivery.is_delivered.is_(True))
        .filter(Delivery.delivery_confirmed_at >= start)
        .filter(Delivery.delivery_confirmed_at <= end)
        .all()
    )

    data = []
    for d, tool, user in deliveries:
        data.append({
            "Facility":         user.facility or "Unknown",
            "Tool":             tool.name,
            "Quantity":         d.quantity_supplied,
            "Confirmed By":     user.first_name,
            "Confirmed At":     d.delivery_confirmed_at.strftime("%Y-%m-%d %H:%M") if d.delivery_confirmed_at else "",
            "Request ID":       d.request_id,
        })

    if not data:
        data = [{"Facility": "No data", "Tool": "", "Quantity": 0, "Confirmed By": "", "Confirmed At": "", "Request ID": ""}]

    df = pd.DataFrame(data)
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=start.strftime("%B %Y"))
    buf.seek(0)
    filename = f"monthly_consumption_{year}_{month:02d}.xlsx"
    return send_file(buf, as_attachment=True, download_name=filename,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------------------------------------------------------------------------
# Tools Utilization (given vs achieved -> eligibility)
# ---------------------------------------------------------------------------

# Mapping of which tool is calculated from which report column, and its pack kind.
#   kind 'form'  -> 1 unit = 1 booklet of 100 sheets
#   kind 'card'  -> 1 unit = 1 card
UTILIZATION_TOOLS = [
    {"name": "Combined Pharmacy Order Form",           "report": "RADET", "date_col": "Last Pickup Date (yyyy-mm-dd)",                 "kind": "form"},
    {"name": "Care/ART Card",                           "report": "RADET", "date_col": "Date of Registration",                          "kind": "card"},
    {"name": "National HTS form",                       "report": "HTS",   "date_col": "Date Of Current HIV Testing (yyyy-mm-dd)",   "kind": "form"},
    {"name": "PrEP/PEP card",                           "report": "PREP",  "date_col": "Date Of Registration (yyyy-mm-dd)",             "kind": "card"},
    {"name": "PrEP/PEP screening and eligibility form", "report": "PREP",  "date_col": "Date Of Last Pickup (yyyy-mm-dd)",              "kind": "form"},
    {"name": "Facility Care and Support Screening Checklist", "report": "RADET", "date_col": "Last Pickup Date (yyyy-mm-dd)",        "kind": "form"},
]
UTILIZATION_PACK = {"form": 100, "card": 1}
# Pseudo-facility name storing the state-wide aggregate daily histogram (all
# facilities in the report) so the admin State tab reflects the TRUE state count.
UTILIZATION_STATE_FACILITY = "__STATE__"


def _utilization_units_for(tool_name, given, achieved):
    """Return {kind, pack, given_units, achieved_units} for a mapped tool.
    FORM tools: 1 unit = 1 booklet = 100 sheets. CARD tools: 1 unit = 1 card."""
    kind = "form"
    for m in UTILIZATION_TOOLS:
        if (m.get("name") or "").lower() == (tool_name or "").lower():
            kind = m["kind"]
            break
    pack = UTILIZATION_PACK.get(kind, 1)

    def _u(v):
        if not pack:
            return v
        r = v / pack
        return int(r) if abs(r - round(r)) < 1e-9 else round(r, 1)

    return {
        "kind": kind,
        "pack": pack,
        "given_units": _u(given),
        "achieved_units": _u(achieved),
    }

REPORT_FACILITY_COLS = {
    "RADET": ["Facility Name", "Facility_Name", "FACILITY NAME"],
    "HTS":   ["Facility", "facility", "Facility Name", "FACILITY"],
    "PREP":  ["Facility Name", "Facility_Name", "Facility"],
}


def _utilization_norm(name):
    import re as _re
    if name is None:
        return ""
    return _re.sub(r"\s+", " ", str(name).strip().lower())


def _utilization_find_col(df, candidates):
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _utilization_approval_map():
    """One query: (facility, tool_id) -> (approval_datetime, given_qty) based on
    REQUESTS APPROVED BY ADMIN (status 'Approved' or 'Delivered').

    'Given' is sourced from the approved request rather than the delivery record
    so a facility that was approved a tool counts as having been given it even if
    they never confirmed the delivery. given_qty = approved_quantity if set (S.I.
    override) else the requested quantity."""
    rows = (db.session.query(
                RequestedTool.tool_id, Users.facility,
                RequestModel.date_approved, RequestModel.date_requested,
                RequestedTool.approved_quantity, RequestedTool.quantity,
            )
            .join(RequestModel, RequestedTool.request_id == RequestModel.id)
            .join(Users, RequestModel.user_id == Users.id)
            .filter(RequestModel.status.in_(["Approved", "Delivered"]))
            .all())
    amap = {}
    for tool_id, fac, appr, reqd, aq, qty in rows:
        if not fac:
            continue
        key = (fac.strip(), tool_id)
        dt = appr or reqd
        cur = amap.get(key)
        if cur is None or (dt is not None and (cur[0] is None or dt > cur[0])):
            amap[key] = (dt, (aq if aq is not None else (qty or 0)))
    return amap


def _utilization_approvals_in_period(tool_id, from_date, to_date):
    """Return {facility: total_approved_qty} for one tool within [from, to].
    Sums EVERY admin-approved request in the period (not just the most recent per
    facility) so the State total and the per-facility breakdown agree."""
    rows = (db.session.query(
                Users.facility,
                func.coalesce(RequestedTool.approved_quantity, RequestedTool.quantity),
                RequestModel.date_approved, RequestModel.date_requested,
            )
            .join(RequestModel, RequestedTool.request_id == RequestModel.id)
            .join(Users, RequestModel.user_id == Users.id)
            .filter(RequestedTool.tool_id == tool_id,
                    RequestModel.status.in_(["Approved", "Delivered"]))
            .all())
    out = {}
    for fac, qty, appr, reqd in rows:
        if not fac:
            continue
        fac = fac.strip()
        dt = appr or reqd
        d = dt.date() if dt else None
        if d is None or not (from_date <= d <= to_date):
            continue
        out[fac] = out.get(fac, 0) + int(qty or 0)
    return out


def _utilization_last_delivery(facility, tool_id, dmap=None):
    """Return (start_date, given_count) based on the MOST RECENT APPROVED request
    of tool_id to facility (status Approved/Delivered). given_count is the raw
    approved quantity (pack applied later)."""
    if dmap is not None:
        entry = dmap.get((facility.strip(), int(tool_id)))
        if not entry:
            return None, None
        start, raw_given = entry
        start = start.date() if start else None
        return start, raw_given

    rows = (db.session.query(RequestedTool.tool_id, Users.facility,
                             RequestModel.date_approved, RequestModel.date_requested,
                             RequestedTool.approved_quantity, RequestedTool.quantity)
            .join(RequestModel, RequestedTool.request_id == RequestModel.id)
            .join(Users, RequestModel.user_id == Users.id)
            .filter(Users.facility == facility, RequestedTool.tool_id == tool_id,
                    RequestModel.status.in_(["Approved", "Delivered"]))
            .all())
    if not rows:
        return None, None

    best_dt = None
    best_qty = 0
    for _tid, _fac, appr, reqd, aq, qty in rows:
        dt = appr or reqd or datetime.min
        if best_dt is None or dt > best_dt:
            best_dt = dt
            best_qty = (aq if aq is not None else (qty or 0))
    start = best_dt.date() if best_dt else None
    return start, best_qty


def _utilization_match_norms(db_fac, report_norms):
    """Return the set of normalized report facility names matching a DB facility."""
    n = _utilization_norm(db_fac)
    if not n:
        return set()
    if n in report_norms:
        return {n}
    out = set()
    for rn in report_norms:
        if rn and (rn in n or n in rn):
            out.add(rn)
    return out


def _si_management_emails():
    """Case-insensitive set of S.I. management recipient emails."""
    entries = []
    s = SystemSetting.query.filter_by(key="si_management_entries").first()
    if s and s.value:
        try:
            entries = json.loads(s.value)
        except Exception:
            pass
    if not entries:
        legacy = SystemSetting.query.filter_by(key="si_management_email").first()
        if legacy and legacy.value:
            entries = [{"email": legacy.value.strip()}]
    return {(e.get("email") or "").strip().lower() for e in entries if e.get("email")}


def _utilization_visible_facilities(user):
    """Return the set of facility names the user can see in utilization, or None for ALL."""
    if _is_admin_user(user):
        return None
    # S.I. management see all facilities
    if (user.email or "").strip().lower() in _si_management_emails():
        return None
    # supervisors see the facilities they supervise
    if getattr(user, "is_supervisor", False) and user.supervised_facilities:
        try:
            facs = json.loads(user.supervised_facilities or "[]")
        except Exception:
            facs = []
        facs = [f.strip() for f in facs if f and f.strip()]
        if facs:
            return set(facs)
    # otherwise, only their own facility
    if user.facility:
        return {user.facility}
    return set()


@api_bp.route("/admin/utilization/upload", methods=["POST"])
@login_required
def admin_upload_utilization():
    """Upload RADET / HTS / PrEP report(s) -> compute per-facility utilization for
    the mapped tools -> store results (persisted for all users to view)."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    radet_file = request.files.get("radet_file")
    hts_file   = request.files.get("hts_file")
    prep_file  = request.files.get("prep_file")
    uploaded = [f for f in (radet_file, hts_file, prep_file) if f and f.filename]
    if not uploaded:
        return jsonify({"error": "Upload at least one report (RADET, HTS or PrEP)."}), 400

    def _read(report_type, fobj):
        raw = fobj.read()
        if not raw:
            raise ValueError("Empty file")
        try:
            import python_calamine  # noqa: F401  (fast Rust reader, fallback to openpyxl)
            engine = "calamine"
        except Exception:
            engine = None

        def _rd(**kw):
            return pd.read_excel(BytesIO(raw), engine=engine, **kw) if engine else pd.read_excel(BytesIO(raw), **kw)

        df0 = _rd(nrows=1)
        cols = list(df0.columns)
        fac_col = _utilization_find_col(df0, REPORT_FACILITY_COLS[report_type])
        want = [fac_col] if fac_col else []
        want += [m["date_col"] for m in UTILIZATION_TOOLS if m["report"] == report_type and m["date_col"] in cols]
        want = list(dict.fromkeys(c for c in want if c))
        return _rd(usecols=want) if want else _rd()

    reports = {}
    errors = {}
    if radet_file and radet_file.filename:
        try:
            reports["RADET"] = _read("RADET", radet_file)
        except Exception as e:
            errors["RADET"] = f"Could not read RADET file: {e}"
    if hts_file and hts_file.filename:
        try:
            reports["HTS"] = _read("HTS", hts_file)
        except Exception as e:
            errors["HTS"] = f"Could not read HTS file: {e}"
    if prep_file and prep_file.filename:
        try:
            reports["PREP"] = _read("PREP", prep_file)
        except Exception as e:
            errors["PREP"] = f"Could not read PrEP file: {e}"

    # Real facilities only: exclude admin/HQ "facilities" (e.g. State Office Team).
    admin_facs = {u.facility for u in Users.query.all() if _is_admin_user(u) and u.facility}
    db_facilities = sorted(
        f for f in {(u.facility or "").strip() for u in Users.query.all() if u.facility}
        if f and f not in admin_facs
    )
    delivery_map = _utilization_approval_map()

    # Cache per (report, date_col): (fac_norm -> row idx list, date_int array, norm set)
    combo_cache = {}

    def _get_combo(report, date_col):
        key = (report, date_col)
        if key not in combo_cache:
            df = reports[report]
            fac_col = _utilization_find_col(df, REPORT_FACILITY_COLS[report])
            if not fac_col or date_col not in df.columns:
                combo_cache[key] = None
                return None
            fac_arr = df[fac_col].fillna("").astype(str).map(_utilization_norm).values
            dates = pd.to_datetime(df[date_col], errors="coerce")
            valid = dates.notna().values
            date_int = np.full(len(dates), -1, dtype=np.int64)
            date_int[valid] = (
                dates[valid].dt.year * 10000 + dates[valid].dt.month * 100 + dates[valid].dt.day
            ).values
            norm_to_idx = {}
            for i in range(len(fac_arr)):
                n = fac_arr[i]
                if n and date_int[i] != -1:
                    norm_to_idx.setdefault(n, []).append(i)
            combo_cache[key] = (norm_to_idx, date_int, set(norm_to_idx.keys()))
        return combo_cache[key]

    computed = []
    for mapping in UTILIZATION_TOOLS:
        if mapping["report"] not in reports:
            continue
        tool = Tool.query.filter(func.lower(Tool.name) == mapping["name"].lower()).first()
        if not tool:
            continue
        combo_data = _get_combo(mapping["report"], mapping["date_col"])
        if combo_data is None:
            errors[mapping["report"]] = (
                f"Missing columns: facility or '{mapping['date_col']}' not found in {mapping['report']}."
            )
            continue
        norm_to_idx, date_int, report_norms = combo_data
        pack = UTILIZATION_PACK.get(mapping["kind"], 1)

        for fac in db_facilities:
            start, raw_given = _utilization_last_delivery(fac, tool.id, dmap=delivery_map)
            if start is None or raw_given is None or raw_given <= 0:
                continue
            given = raw_given * pack
            norms = _utilization_match_norms(fac, report_norms)
            achieved = 0
            matched_idx = []
            if norms:
                s_int = start.year * 10000 + start.month * 100 + start.day
                for n in norms:
                    idx = norm_to_idx.get(n)
                    if idx:
                        matched_idx.extend(idx)
                        achieved += int((date_int[idx] >= s_int).sum())
            # Daily histogram {yyyymmdd: count} for this facility+tool (all dates, no window)
            daily = {}
            if matched_idx:
                dvals = date_int[matched_idx]
                dvals = dvals[dvals != -1]
                if len(dvals):
                    uniq, cnts = np.unique(dvals, return_counts=True)
                    daily = {str(int(u)): int(c) for u, c in zip(uniq, cnts)}
            pct = round(achieved / given * 100, 1) if given else None

            row = UtilizationResult.query.filter_by(facility=fac, tool_id=tool.id).first()
            if not row:
                row = UtilizationResult(facility=fac, tool_id=tool.id)
            row.report_type = mapping["report"]
            row.date_column = mapping["date_col"]
            row.given = given
            row.achieved = achieved
            row.utilization_pct = pct
            row.start_date = start
            row.daily_counts = json.dumps(daily)
            db.session.add(row)
            computed.append(row.to_dict())

        # State-wide aggregate daily histogram (ALL report rows, all facilities).
        # Powers the admin State tab so "used" reflects the whole report, not only
        # facilities that happen to have a delivery record in the system.
        state_daily = {}
        dvals_all = date_int[date_int != -1]
        if len(dvals_all):
            uniq, cnts = np.unique(dvals_all, return_counts=True)
            state_daily = {str(int(u)): int(c) for u, c in zip(uniq, cnts)}
        state_row = UtilizationResult.query.filter_by(
            facility=UTILIZATION_STATE_FACILITY, tool_id=tool.id).first()
        if not state_row:
            state_row = UtilizationResult(facility=UTILIZATION_STATE_FACILITY, tool_id=tool.id)
        state_row.report_type = mapping["report"]
        state_row.date_column = mapping["date_col"]
        state_row.given = 0
        state_row.achieved = 0
        state_row.utilization_pct = None
        state_row.start_date = None
        state_row.daily_counts = json.dumps(state_daily)
        db.session.add(state_row)

    db.session.commit()

    # Drop stale results for mapped tools whose report was uploaded: remove any row
    # whose facility no longer has a delivery of that tool. (Tools whose report was
    # NOT uploaded this time keep their last-known values.)
    uploaded_reports = set(reports.keys())
    for mapping in UTILIZATION_TOOLS:
        if mapping["report"] not in uploaded_reports:
            continue
        tool = Tool.query.filter(func.lower(Tool.name) == mapping["name"].lower()).first()
        if not tool:
            continue
        for s in UtilizationResult.query.filter_by(tool_id=tool.id).all():
            if s.facility == UTILIZATION_STATE_FACILITY:
                continue  # the state-aggregate row is maintained separately
            _, raw_given = _utilization_last_delivery(s.facility, tool.id, dmap=delivery_map)
            if raw_given is None or raw_given <= 0:
                db.session.delete(s)
    db.session.commit()

    return jsonify({
        "ok": True,
        "computed_at": datetime.utcnow().isoformat(),
        "count": len(computed),
        "results": computed,
        "errors": errors,
        "threshold": UTILIZATION_THRESHOLD,
    }), 200


@api_bp.route("/utilization", methods=["GET"])
@login_required
def list_utilization():
    """Return stored utilization results visible to the current user."""
    visible = _utilization_visible_facilities(current_user)
    q = UtilizationResult.query.options(joinedload(UtilizationResult.tool))
    if visible is not None:
        q = q.filter(UtilizationResult.facility.in_(visible))
    q = q.filter(UtilizationResult.facility != UTILIZATION_STATE_FACILITY)
    rows = q.order_by(UtilizationResult.facility, UtilizationResult.tool_id).all()
    results = [r.to_dict() for r in rows]
    for r in results:
        r.update(_utilization_units_for(r.get("tool_name"), r.get("given") or 0, r.get("achieved") or 0))

    # group by facility for convenience
    by_facility = {}
    for r in results:
        by_facility.setdefault(r["facility"], []).append(r)

    return jsonify({
        "threshold": UTILIZATION_THRESHOLD,
        "count": len(results),
        "results": results,
        "by_facility": by_facility,
        "visible_facilities": sorted(visible) if visible is not None else None,
    }), 200


@api_bp.route("/utilization/state", methods=["GET"])
@login_required
def utilization_state():
    """State-level aggregate per mapped tool for a selected period (from/to optional).
    given = ADMIN-APPROVED quantities of the tool within the period (pack-adjusted).
    achieved = sum of report counts within the period (from stored daily histograms)."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    from_str = (request.args.get("from") or "").strip()
    to_str   = (request.args.get("to")   or "").strip()

    def _parse(s, default):
        try:
            return datetime.strptime(s, "%Y-%m-%d").date()
        except Exception:
            return default

    from_date = _parse(from_str, (datetime.utcnow() - timedelta(days=90)).date())
    to_date   = _parse(to_str, datetime.utcnow().date())

    f_int = from_date.year * 10000 + from_date.month * 100 + from_date.day
    t_int = to_date.year * 10000 + to_date.month * 100 + to_date.day

    results = []
    for mapping in UTILIZATION_TOOLS:
        tool = Tool.query.filter(func.lower(Tool.name) == mapping["name"].lower()).first()
        if not tool:
            continue
        pack = UTILIZATION_PACK.get(mapping["kind"], 1)

        # given in period = ALL admin-approved requests of this tool within [from,to]
        # (pack-adjusted). Sums every approval in the period so the total matches the
        # per-facility breakdown shown when the card is clicked.
        given_map = _utilization_approvals_in_period(tool.id, from_date, to_date)
        given = sum(given_map.values()) * pack
        facs_with_given = set(given_map)

        # achieved in period = state-wide report counts within [from,to], summed
        # from the state-aggregate histogram (ALL facilities in the report).
        achieved = 0
        state_row = UtilizationResult.query.filter_by(
            facility=UTILIZATION_STATE_FACILITY, tool_id=tool.id).first()
        if state_row and state_row.daily_counts:
            try:
                daily = json.loads(state_row.daily_counts or "{}")
            except Exception:
                daily = {}
            for ds, cnt in daily.items():
                try:
                    if f_int <= int(ds) <= t_int:
                        achieved += int(cnt)
                except Exception:
                    pass

        pct = round(achieved / given * 100, 1) if given else None
        units = _utilization_units_for(tool.name, given, achieved)
        results.append({
            "tool_id": tool.id,
            "tool_name": tool.name,
            "report_type": mapping["report"],
            "kind": mapping["kind"],
            "given": given,
            "achieved": achieved,
            "given_units": units["given_units"],
            "achieved_units": units["achieved_units"],
            "utilization_pct": pct,
            "under_utilized": pct is not None and given > 0 and pct < UTILIZATION_THRESHOLD,
            "facilities": len(facs_with_given),
        })

    return jsonify({
        "from": from_date.isoformat(),
        "to": to_date.isoformat(),
        "threshold": UTILIZATION_THRESHOLD,
        "results": results,
    }), 200


@api_bp.route("/utilization/state/facilities", methods=["GET"])
@login_required
def utilization_state_facilities():
    """Per-facility breakdown for ONE tool within a period (used by the admin State
    tab when a tool card is clicked). Each row = a facility that was given the tool
    in the period: given (approved qty in period, pack-adjusted), used (report counts
    in period), utilization %, status."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    tool_id = request.args.get("tool_id", type=int)
    if not tool_id:
        return jsonify({"error": "tool_id is required"}), 400

    tool = Tool.query.get(tool_id)
    if not tool:
        return jsonify({"error": "Tool not found"}), 404

    mapping = None
    for m in UTILIZATION_TOOLS:
        if (m.get("name") or "").lower() == (tool.name or "").lower():
            mapping = m
            break
    if not mapping:
        return jsonify({"error": "Tool is not a utilization tool"}), 400
    pack = UTILIZATION_PACK.get(mapping["kind"], 1)

    from_str = (request.args.get("from") or "").strip()
    to_str   = (request.args.get("to")   or "").strip()

    def _parse(s, default):
        try:
            return datetime.strptime(s, "%Y-%m-%d").date()
        except Exception:
            return default

    from_date = _parse(from_str, (datetime.utcnow() - timedelta(days=90)).date())
    to_date   = _parse(to_str, datetime.utcnow().date())
    f_int = from_date.year * 10000 + from_date.month * 100 + from_date.day
    t_int = to_date.year * 10000 + to_date.month * 100 + to_date.day

    # given per facility = ALL approved quantities of this tool within [from,to]
    given_map = _utilization_approvals_in_period(tool_id, from_date, to_date)

    # used per facility = sum of that facility's stored daily_counts within [from,to]
    used_map = {}
    for r in UtilizationResult.query.filter_by(tool_id=tool_id, report_type=mapping["report"]).all():
        if r.facility == UTILIZATION_STATE_FACILITY:
            continue
        if not r.daily_counts:
            continue
        try:
            daily = json.loads(r.daily_counts or "{}")
        except Exception:
            continue
        total = 0
        for ds, cnt in daily.items():
            try:
                if f_int <= int(ds) <= t_int:
                    total += int(cnt)
            except Exception:
                pass
        used_map[r.facility] = total

    rows = []
    for fac in sorted(given_map):
        given = given_map[fac] * pack
        used = used_map.get(fac, 0)
        pct = round(used / given * 100, 1) if given else None
        rows.append({
            "facility": fac,
            "given": given,
            "given_units": round(given / pack, 1) if pack else given,
            "used": used,
            "used_units": round(used / pack, 1) if pack else used,
            "utilization_pct": pct,
            "under_utilized": pct is not None and given > 0 and pct < UTILIZATION_THRESHOLD,
        })

    return jsonify({
        "tool_id": tool.id,
        "tool_name": tool.name,
        "kind": mapping["kind"],
        "from": from_date.isoformat(),
        "to": to_date.isoformat(),
        "threshold": UTILIZATION_THRESHOLD,
        "count": len(rows),
        "results": rows,
    }), 200


def _utilization_for_tool(facility, tool_id):
    """Stored utilization summary for a facility+tool (or None)."""
    u = UtilizationResult.query.filter_by(facility=facility, tool_id=int(tool_id)).first()
    if not u or u.given <= 0:
        return None
    result = {
        "given": u.given,
        "achieved": u.achieved,
        "utilization_pct": round(u.utilization_pct, 1) if u.utilization_pct is not None else None,
        "under_utilized": u.utilization_pct is not None and u.utilization_pct < UTILIZATION_THRESHOLD,
        "start_date": u.start_date.isoformat() if u.start_date else None,
    }
    result.update(_utilization_units_for(u.tool.name if u.tool else None, u.given, u.achieved))
    return result


def _enrich_tools_with_utilization(tools_list, facility):
    """Attach a 'utilization' dict to each tool in the list (used by S.I. email/page)."""
    out = []
    for t in tools_list:
        tid = t.get("tool_id")
        if tid:
            u = _utilization_for_tool(facility, tid)
            if u:
                t = dict(t)
                t["utilization"] = u
        out.append(t)
    return out


def _utilization_warning_message(tool_name, u):
    pct = u.get("utilization_pct")
    given = u.get("given", 0)
    achieved = u.get("achieved", 0)

    def _fmt(v):
        v = float(v or 0)
        return str(int(v)) if v == int(v) else f"{v:g}"

    if u.get("kind") == "form":
        g_text = f"{_fmt(u.get('given_units'))} booklets ({_fmt(given)} sheets)"
        a_text = f"{_fmt(u.get('achieved_units'))} booklets ({_fmt(achieved)} sheets)"
    else:
        g_text = f"{_fmt(given)} cards"
        a_text = f"{_fmt(achieved)} cards"
    return (
        f"You have used only {pct}% ({a_text} of {g_text}) of the '{tool_name}' previously given "
        f"to your facility. Your request might likely be rejected because the tool was under-utilized."
    )


@api_bp.route("/admin/utilization/calculate", methods=["POST"])
@login_required
def calculate_utilization():
    """Calculate expected tool utilization from RADET and/or HTS_PEPFAR reports."""
    if not _is_admin_user(current_user):
        return _admin_required_json()

    period_start_str = (request.form.get("period_start") or "").strip()
    period_end_str   = (request.form.get("period_end")   or "").strip()

    if not period_start_str or not period_end_str:
        return jsonify({"error": "period_start and period_end are required (YYYY-MM-DD)"}), 400

    try:
        period_start = datetime.strptime(period_start_str, "%Y-%m-%d").date()
        period_end   = datetime.strptime(period_end_str,   "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

    if period_start > period_end:
        return jsonify({"error": "period_start must be before period_end"}), 400

    def _find_col(df, candidates):
        for c in candidates:
            if c in df.columns:
                return c
        return None

    def _read_excel(file_obj):
        raw = file_obj.read()
        if not raw:
            raise ValueError("Empty file")
        return pd.read_excel(BytesIO(raw))

    # ── RADET ────────────────────────────────────────────────────────────────
    radet_data  = {}   # facility -> row count (refills)
    radet_error = None
    radet_file  = request.files.get("radet_file")

    if radet_file and radet_file.filename:
        try:
            df = _read_excel(radet_file)
            fac_col  = _find_col(df, ["Facility Name", "Facility_Name", "FACILITY NAME"])
            date_col = _find_col(df, ["Last Pickup Date (yyyy-mm-dd)", "Last Pickup Date",
                                       "last_pickup_date", "LastPickupDate"])
            if not fac_col:
                radet_error = (
                    f"RADET: 'Facility Name' column not found. "
                    f"Available: {', '.join(str(c) for c in df.columns[:15])}"
                )
            elif not date_col:
                radet_error = (
                    f"RADET: 'Last Pickup Date (yyyy-mm-dd)' column not found. "
                    f"Available: {', '.join(str(c) for c in df.columns[:15])}"
                )
            else:
                df[fac_col]  = df[fac_col].fillna("").astype(str).str.strip()
                df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
                mask = (
                    (df[date_col].dt.date >= period_start) &
                    (df[date_col].dt.date <= period_end)
                )
                for fac, cnt in df[mask].groupby(fac_col).size().items():
                    if fac:
                        radet_data[fac] = int(cnt)
        except Exception as exc:
            radet_error = f"RADET read error: {exc}"

    # ── HTS ─────────────────────────────────────────────────────────────────
    hts_data  = {}   # facility -> row count (tests)
    hts_error = None
    hts_file  = request.files.get("hts_file")

    if hts_file and hts_file.filename:
        try:
            df = _read_excel(hts_file)
            fac_col  = _find_col(df, ["facility", "Facility", "Facility Name", "FACILITY"])
            date_col = _find_col(df, ["Date of Current HIV Testing (yyyy-mm-dd)",
                                       "Date of Current HIV Testing",
                                       "testing_date", "Testing Date"])
            if not fac_col:
                hts_error = (
                    f"HTS: 'facility' column not found. "
                    f"Available: {', '.join(str(c) for c in df.columns[:15])}"
                )
            elif not date_col:
                hts_error = (
                    f"HTS: 'Date of Current HIV Testing (yyyy-mm-dd)' column not found. "
                    f"Available: {', '.join(str(c) for c in df.columns[:15])}"
                )
            else:
                df[fac_col]  = df[fac_col].fillna("").astype(str).str.strip()
                df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
                mask = (
                    (df[date_col].dt.date >= period_start) &
                    (df[date_col].dt.date <= period_end)
                )
                for fac, cnt in df[mask].groupby(fac_col).size().items():
                    if fac:
                        hts_data[fac] = int(cnt)
        except Exception as exc:
            hts_error = f"HTS read error: {exc}"

    # ── Build per-facility results ────────────────────────────────────────
    all_facilities = sorted(set(list(radet_data) + list(hts_data)))

    results = []
    for fac in all_facilities:
        radet_cnt = radet_data.get(fac, 0)
        hts_cnt   = hts_data.get(fac, 0)
        results.append({
            "facility":                     fac,
            "radet_refills":                radet_cnt,
            "hts_tests":                    hts_cnt,
            # 1 form = 100 refills
            "combined_pharmacy_forms":      math.ceil(radet_cnt / 100) if radet_cnt else 0,
            # 1 form = 100 persons
            "facility_care_support_forms":  math.ceil(radet_cnt / 100) if radet_cnt else 0,
            # 1 worksheet = 1900 refills
            "pharmacy_daily_worksheets":    math.ceil(radet_cnt / 1900) if radet_cnt else 0,
            # 1 form per test
            "national_hts_forms":           hts_cnt,
        })

    totals = {
        "facility_count":               len(results),
        "radet_refills":                sum(r["radet_refills"]               for r in results),
        "hts_tests":                    sum(r["hts_tests"]                   for r in results),
        "combined_pharmacy_forms":      sum(r["combined_pharmacy_forms"]      for r in results),
        "facility_care_support_forms":  sum(r["facility_care_support_forms"]  for r in results),
        "pharmacy_daily_worksheets":    sum(r["pharmacy_daily_worksheets"]    for r in results),
        "national_hts_forms":           sum(r["national_hts_forms"]           for r in results),
    }

    return jsonify({
        "period":          {"start": period_start_str, "end": period_end_str},
        "results":         results,
        "totals":          totals,
        "radet_facilities": len(radet_data),
        "hts_facilities":   len(hts_data),
        "errors":          {"radet": radet_error, "hts": hts_error},
    }), 200


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

# =============================================================================
# PATCH: New endpoints added 2026-08-11 (Features 1-11)
# =============================================================================

# ---------------------------------------------------------------------------
# Physical Count Export
# ---------------------------------------------------------------------------

@api_bp.route("/inventory/physical-counts/export", methods=["GET"])
@login_required
def export_physical_counts():
    facility = current_user.facility
    if not facility:
        return jsonify({"error": "No facility assigned"}), 400
    counts = PhysicalStockCount.query.filter_by(facility=facility).order_by(PhysicalStockCount.counted_at.desc()).all()
    if not counts:
        return jsonify({"error": "No physical count records found"}), 404
    rows = []
    for c in counts:
        tool = Tool.query.get(c.tool_id)
        counted_by_user = Users.query.get(c.counted_by) if c.counted_by else None
        rows.append({
            "Tool": tool.name if tool else f"Tool #{c.tool_id}",
            "System Quantity": c.system_quantity, "Physical Quantity": c.physical_quantity,
            "Discrepancy": c.discrepancy, "Has Discrepancy": "Yes" if c.discrepancy != 0 else "No",
            "Counted By": counted_by_user.first_name if counted_by_user else "Unknown",
            "Counted At": c.counted_at.strftime("%Y-%m-%d %H:%M") if c.counted_at else "",
            "Notes": c.notes or "",
        })
    df = pd.DataFrame(rows)
    bio = BytesIO()
    safe_facility = facility.replace(" ", "_").replace("/", "_")[:30]
    with pd.ExcelWriter(bio, engine="xlsxwriter") as writer:
        df.to_excel(writer, sheet_name=safe_facility[:31], index=False)
        ws = writer.sheets[safe_facility[:31]]
        for i, col in enumerate(df.columns):
            ws.set_column(i, i, min(max(df[col].astype(str).apply(len).max(), len(col)) + 2, 50))
    data_bytes = bio.getvalue()
    filename = f"physical_count_{safe_facility}_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return send_file(BytesIO(data_bytes), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", as_attachment=True, download_name=filename)


# ---------------------------------------------------------------------------
# Stock Check Before Request
# ---------------------------------------------------------------------------

def _stock_threshold_for_tool(tool):
    """Category-based stock threshold: Forms 5, Registers 3, Cards 20, everything else 5."""
    if tool is None or tool.category is None:
        return 5
    cat = (tool.category.name or "").strip().lower()
    if cat == "form":
        return 5
    if cat == "register":
        return 3
    if cat == "card":
        return 20
    return 5


@api_bp.route("/requests/check-stock", methods=["POST"])
@login_required
def check_stock_before_request():
    data = _json_body()
    tool_id = _safe_int(data.get("tool_id"))
    requested_qty = _safe_int(data.get("quantity"), 0)
    facility = current_user.facility
    if not tool_id:
        return jsonify({"warn": False, "block": False, "utilization_warning": None}), 200

    tool = Tool.query.get(tool_id)
    threshold = _stock_threshold_for_tool(tool)
    tool_name = tool.name if tool else "this tool"

    # ─── Utilization check: has this facility under-used this tool previously? ───
    util_warning = None
    if facility:
        u = _utilization_for_tool(facility, tool_id)
        if u and u.get("under_utilized"):
            util_warning = {
                "message": _utilization_warning_message(tool_name, u),
                "given": u.get("given"),
                "achieved": u.get("achieved"),
                "utilization_pct": u.get("utilization_pct"),
                "threshold": UTILIZATION_THRESHOLD,
            }

    # ─── State-level stock check ───
    state_qty = tool.quantity if tool else 0
    if state_qty <= 0:
        return jsonify({
            "warn": True,
            "block": True,
            "message": f"'{tool_name}' is currently out of stock at the state level and is not available.",
            "state_stock": state_qty,
            "utilization_warning": util_warning,
        }), 200
    if requested_qty > state_qty:
        return jsonify({
            "warn": True,
            "block": False,
            "message": f"You requested {requested_qty}, but only {state_qty} is currently available at the state level.",
            "state_stock": state_qty,
            "requested_qty": requested_qty,
            "utilization_warning": util_warning,
        }), 200

    # ─── Facility-level stock check (informational) ───
    if not facility:
        return jsonify({"warn": False, "block": False, "utilization_warning": None}), 200
    stock = FacilityStock.query.filter_by(facility=facility, tool_id=tool_id).first()
    current_qty = stock.quantity if stock else 0
    if current_qty > threshold:
        return jsonify({
            "warn": True,
            "block": True,
            "message": f"You already have {current_qty} units of '{tool_name}' in stock, so it was not added to your request.",
            "current_stock": current_qty,
            "threshold": threshold,
            "utilization_warning": util_warning,
        }), 200
    return jsonify({"warn": False, "block": False, "utilization_warning": util_warning}), 200


# ---------------------------------------------------------------------------
# Smart Reminders (login nudges)
# ---------------------------------------------------------------------------

@api_bp.route("/reminders", methods=["GET"])
@login_required
def my_reminders():
    """Smart login nudges for facility users: deliveries awaiting confirmation
    and tools running low on stock."""
    facility = current_user.facility or ""

    pending_count = Delivery.query.filter_by(received_by=current_user.id, is_delivered=False).count()

    low_stock = []
    if facility:
        stocks = FacilityStock.query.filter_by(facility=facility).all()
        for fs in stocks:
            # Skip tools the facility has never actually received — not a "low stock" nudge
            if fs.qty_received <= 0 and fs.quantity <= 0:
                continue
            tool = Tool.query.get(fs.tool_id)
            thr = _stock_threshold_for_tool(tool)
            if fs.quantity <= thr:
                low_stock.append({
                    "tool_id": fs.tool_id,
                    "name": tool.name if tool else "Unknown",
                    "quantity": fs.quantity,
                    "threshold": thr,
                })
        low_stock.sort(key=lambda x: x["quantity"])

    return jsonify({
        "pending_deliveries": pending_count,
        "low_stock": low_stock[:5],
    }), 200



# ---------------------------------------------------------------------------
# Duplicate Request Check
# ---------------------------------------------------------------------------

@api_bp.route("/requests/check-duplicate", methods=["POST"])
@login_required
def check_duplicate_request():
    data = _json_body()
    tool_id = _safe_int(data.get("tool_id"))
    if not tool_id:
        return jsonify({"blocked": False}), 200
    existing = db.session.query(RequestedTool, RequestModel).join(RequestModel, RequestedTool.request_id == RequestModel.id).filter(RequestModel.user_id == current_user.id, RequestedTool.tool_id == tool_id, RequestModel.status.in_(["Pending", "Pending Supervisor Review", "Pending S.I Review", "Approved"])).first()
    if existing:
        rt, req = existing
        return jsonify({"blocked": True, "message": f"You already have a {req.status.lower()} request (#{req.id}) for this tool. Please wait for it to be processed.", "existing_request_id": req.id, "existing_status": req.status}), 200
    return jsonify({"blocked": False}), 200


# ---------------------------------------------------------------------------
# App Update Check
# ---------------------------------------------------------------------------

# Cache the GitHub release lookup so we don't hammer GitHub's unauthenticated
# API (60 req/hr/IP) from Render's shared egress IP.
_update_cache = {"data": None, "at": 0.0}
_UPDATE_CACHE_TTL = 1800  # 30 minutes

# Live auto-update download progress (updated by the background update thread).
_update_progress = {"status": "idle", "percent": 0, "message": "", "downloaded": 0, "total": 0}


@api_bp.route("/app/check-update", methods=["GET"])
def check_app_update():
    import time as _time
    now = _time.time()
    if _update_cache["data"] and (now - _update_cache["at"]) < _UPDATE_CACHE_TTL:
        return jsonify(_update_cache["data"])

    import urllib.request
    try:
        repo_owner = os.getenv("GITHUB_REPO_OWNER", "Gscientist64")
        repo_name = os.getenv("GITHUB_REPO_NAME", "ECTools_Deployed")
        url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/releases/latest"
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github.v3+json", "User-Agent": "TIMS-Updater/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            latest_version = data["tag_name"].lstrip("v")
            asset = next((a for a in data.get("assets", []) if a["name"].endswith(".exe")), None)
            result = {"latest_version": latest_version, "download_url": asset["browser_download_url"] if asset else None, "release_notes": data.get("body", ""), "size": asset.get("size", 0) if asset else 0, "published_at": data.get("published_at", "")}
            _update_cache["data"] = result
            _update_cache["at"] = now
            return jsonify(result)
    except Exception as e:
        current_app.logger.warning(f"Update check failed: {e}")
        # If we have a cached result, return it so clients aren't left guessing.
        if _update_cache["data"]:
            return jsonify(_update_cache["data"])
        return jsonify({"error": "Could not check for updates"}), 500


@api_bp.route("/app/apply-update", methods=["POST"])
@login_required
def apply_app_update():
    """Start an in-place auto-update in a background thread so the UI can show
    download progress. Only works in the frozen desktop build (PyInstaller)."""
    import sys
    if not getattr(sys, "frozen", False):
        return jsonify({"ok": False, "error": "Auto-update is only available in the desktop app."}), 400

    data = request.get_json(silent=True) or {}
    download_url = data.get("download_url")
    version = data.get("version")  # target version, used for the post-restart success marker
    if not download_url:
        return jsonify({"ok": False, "error": "Missing download_url"}), 400

    import threading
    flask_app = current_app._get_current_object()
    threading.Thread(target=_run_update, args=(flask_app, download_url, version), daemon=True).start()
    return jsonify({"ok": True, "status": "started"}), 200


@api_bp.route("/app/update-progress", methods=["GET"])
@login_required
def update_progress():
    return jsonify(_update_progress), 200


@api_bp.route("/app/update-status", methods=["GET"])
def app_update_status():
    """One-shot: returns (and clears) a marker written just before an in-place
    update, so the freshly-restarted app can confirm the update succeeded.
    Public on purpose — after a restart the session may be gone."""
    import os
    import json
    marker = os.path.join(_tims_data_dir(), "update_success.json")
    try:
        if os.path.isfile(marker):
            with open(marker, "r", encoding="utf-8") as f:
                data = json.load(f)
            try:
                os.remove(marker)
            except Exception:
                pass
            return jsonify({"updated_to": data.get("version")}), 200
    except Exception:
        pass
    return jsonify({"updated_to": None}), 200


def _tims_data_dir():
    import os
    return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "TIMS")


def _dir_is_writable(path):
    """Best-effort check whether we can write to a folder on Windows."""
    import tempfile
    import os
    try:
        fd, tmp = tempfile.mkstemp(dir=path, prefix=".tims_wt_")
        os.close(fd)
        os.remove(tmp)
        return True
    except Exception:
        return False


def _repoint_shortcuts(old_exe, new_exe):
    """Repoint any Desktop / Public Desktop / Start-Menu shortcuts that target
    old_exe to new_exe (used when the app moves to the AppData folder)."""
    import subprocess
    ps = (
        "$old=$args[0]; $new=$args[1]; "
        "$ws=New-Object -ComObject WScript.Shell; "
        "$dirs=@((Join-Path $env:USERPROFILE 'Desktop'),"
        "(Join-Path $env:PUBLIC 'Desktop'),"
        "(Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs')); "
        "Get-ChildItem -Path $dirs -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | "
        "ForEach-Object { try { $s=$ws.CreateShortcut($_.FullName); "
        "if ($s.TargetPath -ieq $old) { $s.TargetPath=$new; $s.Save() } } catch {} }"
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps, old_exe, new_exe],
            capture_output=True, timeout=60,
        )
    except Exception:
        pass


def _build_update_bat(new_exe, target_exe, exe_name, child_pid, parent_pid, in_place):
    """Build the detached batch that kills the app, installs the new exe, and
    relaunches it (with an automatic launch retry). in_place=True replaces the
    running exe in place; in_place=False launches the AppData copy already staged
    by Python."""
    L = [
        "@echo off",
        "chcp 65001 >nul",
        'set "LOG=%LOCALAPPDATA%\\TIMS\\update.log"',
        'echo [%date% %time%] update script started >> "%LOG%"',
        # Kill any lingering instance by image name (also covers the
        # "old app not killed in Task Manager" case).
        f"taskkill /F /IM {exe_name} >nul 2>&1",
        f"taskkill /F /PID {child_pid} >nul 2>&1",
        f"taskkill /F /PID {parent_pid} >nul 2>&1",
        "timeout /t 4 /nobreak >nul",
        # Lift the "downloaded from internet" mark so Defender/SmartScreen don't
        # fight the onefile temp extraction on relaunch.
        f'powershell -NoProfile -Command "Unblock-File -LiteralPath \'{new_exe}\'" >nul 2>&1',
    ]
    if in_place:
        L += [
            "set /a R=0",
            ":copy_loop",
            f'copy /Y "{new_exe}" "{target_exe}" >nul 2>&1',
            # Verify the new exe actually replaced the old one (sizes must match).
            # `if exist` is NOT a reliable check — compare file sizes instead.
            f'for %%A in ("{new_exe}") do set "NS=%%~zA"',
            f'for %%A in ("{target_exe}") do set "ES=%%~zA"',
            'if "%NS%"=="%ES%" if defined ES if not "%ES%"=="0" goto copied',
            "set /a R+=1",
            "if %R% LSS 10 ( timeout /t 1 /nobreak >nul & goto copy_loop )",
            'echo [%date% %time%] WARNING in-place copy failed after %R% attempts >> "%LOG%"',
            ":copied",
            f'echo [%date% %time%] exe replaced in place >> "%LOG%"',
            f'del "{new_exe}" >nul 2>&1',
            f'powershell -NoProfile -Command "Unblock-File -LiteralPath \'{target_exe}\'" >nul 2>&1',
        ]
    else:
        # AppData install: the new exe was already staged at target_exe by Python.
        L += [
            f'echo [%date% %time%] installed to AppData "{target_exe}" >> "%LOG%"',
            f'del "{new_exe}" >nul 2>&1',
            f'powershell -NoProfile -Command "Unblock-File -LiteralPath \'{target_exe}\'" >nul 2>&1',
        ]
    # Launch (with automatic retry if the app does not stay running).
    L += [
        "set /a LR=0",
        ":launch_loop",
        "timeout /t 2 /nobreak >nul",
        f'start "" "{target_exe}"',
        "timeout /t 8 /nobreak >nul",
        f'tasklist /FI "IMAGENAME eq {exe_name}" 2>nul | find /i "{exe_name}" >nul && goto launched',
        "set /a LR+=1",
        'echo [%date% %time%] launch retry %LR% >> "%LOG%"',
        "if %LR% LSS 3 ( goto launch_loop )",
        'echo [%date% %time%] WARNING app did not stay running after %LR% tries >> "%LOG%"',
        ":launched",
        'echo [%date% %time%] done >> "%LOG%"',
        'del "%~f0" >nul 2>&1',
    ]
    return "\r\n".join(L) + "\r\n"


def _run_update(flask_app, download_url, version=None):
    """Download the new .exe (reporting progress), then install it and restart.
    Replaces the exe in place when its folder is writable; otherwise installs to
    the user's writable AppData TIMS folder and repoints shortcuts, so the new
    version always takes effect (fixes updates that never applied)."""
    import urllib.request
    import tempfile
    import subprocess
    import shutil
    import sys
    import os
    import time
    import json

    try:
        _update_progress.update(status="downloading", percent=0, message="Downloading update…", downloaded=0, total=0)

        exe_path = sys.executable
        new_exe = os.path.join(tempfile.gettempdir(), f"TIMS_update_{int(time.time())}.exe")

        # 1. Download with progress
        req = urllib.request.Request(download_url, headers={"User-Agent": "TIMS-Updater/1.0"})
        with urllib.request.urlopen(req, timeout=600) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            _update_progress["total"] = total
            downloaded = 0
            with open(new_exe, "wb") as f:
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    _update_progress["downloaded"] = downloaded
                    if total:
                        _update_progress["percent"] = min(99, int(downloaded * 100 / total))

        # Sanity check: the download must be complete before we replace the exe.
        if total and downloaded != total:
            raise RuntimeError(f"Download incomplete ({downloaded}/{total} bytes)")

        # Strip any "downloaded from internet" mark (MOTW) so Windows Defender /
        # SmartScreen treat the new exe as a local file. This avoids the onefile
        # temp-extraction interference that can cause "Failed to load Python DLL".
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"Unblock-File -LiteralPath '{new_exe}'"],
                capture_output=True, timeout=30,
            )
        except Exception:
            pass

        _update_progress.update(percent=99, status="installing", message="Installing update…")

        data_dir = _tims_data_dir()
        try:
            os.makedirs(data_dir, exist_ok=True)
        except Exception:
            pass

        # 2. One-shot success marker read by the restarted app to show "Update Successful".
        marker = os.path.join(data_dir, "update_success.json")
        try:
            with open(marker, "w", encoding="utf-8") as f:
                json.dump({"version": version or ""}, f)
        except Exception:
            pass

        child_pid = os.getpid()
        parent_pid = os.getppid()
        bat_path = os.path.join(data_dir, "update_tims.bat")
        exe_name = os.path.basename(exe_path)

        # 3. Decide the install strategy.
        #    If the current exe folder is writable we replace the exe in place
        #    (keeps the user's existing install/shortcut). Otherwise the exe is
        #    installed into the writable AppData TIMS folder and Desktop/Start-Menu
        #    shortcuts are repointed there, so the new version ALWAYS takes effect
        #    even when the original install folder is read-only (e.g. Program Files).
        appdata_exe = os.path.join(data_dir, "EC_Tools.exe")
        in_place = _dir_is_writable(os.path.dirname(exe_path) or ".")
        target_exe = exe_path if in_place else appdata_exe

        if not in_place:
            # Copy the new exe to the writable AppData location now (this target is
            # not the running exe, so the copy cannot be blocked by a file lock),
            # unblock it, and repoint any shortcuts that used to launch the old exe.
            try:
                shutil.copyfile(new_exe, appdata_exe)
            except Exception as e:
                flask_app.logger.error("AppData install failed: %s", e)
                _update_progress.update(status="error", message="Could not install the update to your user folder.")
                return
            try:
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command",
                     f"Unblock-File -LiteralPath '{appdata_exe}'"],
                    capture_output=True, timeout=30,
                )
            except Exception:
                pass
            _repoint_shortcuts(exe_path, appdata_exe)

        # 4. Build a robust batch script. Lives in the writable TIMS data dir
        #    (not next to the exe, which may be in a read-only folder).
        script = _build_update_bat(
            new_exe=new_exe, target_exe=target_exe, exe_name=exe_name,
            child_pid=child_pid, parent_pid=parent_pid, in_place=in_place,
        )
        with open(bat_path, "w", encoding="utf-8") as f:
            f.write(script)

        # 5. Launch the script detached so the response can reach the frontend first.
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        subprocess.Popen(
            ["cmd", "/c", bat_path],
            cwd=data_dir,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )

        _update_progress.update(status="restarting", percent=100, message="Restarting app…")
    except Exception as e:
        _update_progress.update(status="error", message=str(e))
        flask_app.logger.error("Auto-update failed: %s", e)


# ---------------------------------------------------------------------------
# Email Diagnostic (admin only)
# ---------------------------------------------------------------------------

@api_bp.route("/admin/test-email", methods=["GET"])
@login_required
def test_email_diagnostic():
    if not _is_admin_user(current_user): return _admin_required_json()

    from mailer import send_email, get_supervisors_for_facility
    import smtplib

    cfg = current_app.config
    result = {}

    # 1. SMTP config
    result["smtp_host"] = cfg.get("SMTP_HOST", os.getenv("SMTP_HOST", "smtp.gmail.com"))
    result["smtp_port"] = int(cfg.get("SMTP_PORT", os.getenv("SMTP_PORT", "587")))
    smtp_user = os.getenv("SMTP_USER", "")
    result["smtp_user"] = (smtp_user[:3] + "***") if smtp_user else "(not set)"
    result["smtp_from"] = os.getenv("SMTP_FROM", "")
    result["smtp_password_set"] = bool(os.getenv("SMTP_PASSWORD", ""))

    # 2. Server URL
    result["server_url"] = os.getenv("SERVER_URL") or os.getenv("RENDER_EXTERNAL_URL") or "https://ectools-deployed.onrender.com"

    # 3. SMTP connectivity test
    smtp_host = result["smtp_host"]
    smtp_port = result["smtp_port"]
    try:
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
        server.starttls()
        if smtp_user and os.getenv("SMTP_PASSWORD"):
            server.login(smtp_user, os.getenv("SMTP_PASSWORD"))
        result["smtp_connect"] = "OK"
        server.quit()
    except Exception as e:
        result["smtp_connect"] = f"FAILED: {e}"

    # 4. Test send
    smtp_from = os.getenv("SMTP_FROM", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    if smtp_password:
        ok = send_email(
            [smtp_from],
            "[TIMS] Diagnostic Test",
            "<p>This is a test email from TIMS email diagnostic.</p>"
        )
        result["test_send"] = "OK" if ok else "FAILED"
    else:
        result["test_send"] = "SKIPPED (no SMTP password)"

    # 5. Supervisors list
    all_supers = Users.query.filter_by(is_supervisor=True).all()
    result["supervisors_count"] = len(all_supers)
    result["supervisors"] = [
        {"id": s.id, "email": s.email, "facilities": json.loads(s.supervised_facilities or "[]")}
        for s in all_supers
    ]

    # 6. S.I Management entries
    si = SystemSetting.query.filter_by(key="si_management_entries").first()
    result["si_management"] = json.loads(si.value) if si and si.value else []

    return jsonify(result), 200


# ---------------------------------------------------------------------------
# Supervisor Email Action Handler (clicked from email)
# ---------------------------------------------------------------------------

def _supervisor_page(title, message, kind="neutral"):
    colors = {"ok": "#059669", "err": "#dc2626", "neutral": "#1e3a8a"}
    accent = colors.get(kind, "#1e3a8a")
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:20px;box-shadow:0 8px 30px rgba(15,23,42,0.08);overflow:hidden;">
  <div style="background:linear-gradient(135deg,#0f172a,#1e3a8a);padding:28px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:22px;">{title}</h1>
  </div>
  <div style="padding:28px;text-align:center;color:#334155;font-size:15px;line-height:1.6;">{message}</div>
</div></body></html>"""


def _supervisor_confirm_page(req_id, facility, requester_name, role_label, action, token, tools_list, stock_source="facility", allow_quantities=False, secondary_action=None, secondary_token=None):
    from mailer import _render_tools_table, _esc, _available_stock
    is_approve = action == "approved"
    action_word = "Approve" if is_approve else "Reject"
    accent = "#059669" if is_approve else "#dc2626"
    emoji = "&#10003;" if is_approve else "&#10007;"
    if allow_quantities:
        # S.I. review: let the reviewer set the actual approved quantity per tool.
        rows = []
        for t in tools_list:
            name = _esc(t.get("name", "Unknown"))
            qty = t.get("quantity", 0)
            stock = _available_stock(facility, t.get("tool_id"), source=stock_source)
            stock_str = str(stock) if stock is not None else "&mdash;"
            tid = t.get("tool_id", "")
            name_cell = name
            util = t.get("utilization")
            if util:
                pct = util.get("utilization_pct")
                given = util.get("given")
                achieved = util.get("achieved")
                under = bool(util.get("under_utilized"))
                color = "#b45309" if under else "#047857"
                note = f"Utilization: {pct}% (used {achieved} of {given})"
                if under:
                    note += " &mdash; under-utilized"
                name_cell += (
                    f'<div style="font-size:11px;color:{color};margin-top:4px;font-weight:600;line-height:1.4;">'
                    f"{note}</div>"
                )
            rows.append(
                f"<tr style=\"border-bottom:1px solid #f1f5f9;\">"
                f'<td style="padding:12px 14px;color:#334155;font-size:14px;">{name_cell}</td>'
                f'<td style="padding:12px 14px;text-align:center;color:#334155;font-size:14px;font-weight:600;">{qty}</td>'
                f'<td style="padding:12px 14px;text-align:center;color:#64748b;font-size:14px;">{stock_str}</td>'
                f'<td style="padding:10px 14px;text-align:center;">'
                f'<input type="number" name="qty_{tid}" value="{qty}" min="0" max="{stock if stock is not None else qty}" '
                f'style="width:72px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;text-align:center;font-weight:600;color:#0f172a;"/>'
                f'</td></tr>'
            )
        table = (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:16px 0 24px;">'
            '<thead><tr style="background:#f8fafc;">'
            '<th style="padding:12px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Tool / Item</th>'
            '<th style="padding:12px 14px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Requested</th>'
            '<th style="padding:12px 14px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Available</th>'
            '<th style="padding:12px 14px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Approve Qty</th>'
            '</tr></thead><tbody>'
            f"{''.join(rows)}"
            '</tbody></table>'
        )
        qty_note = (
            '<p style="margin:0 0 16px;color:#64748b;font-size:13px;line-height:1.6;">'
            'You can adjust the <strong>approved quantity</strong> for each item below (the numbers are '
            'pre-filled with the requested quantity). Leave them as-is to approve the full request.'
            '</p>'
        )
    else:
        table = _render_tools_table(tools_list, facility, show_stock=True, stock_source=stock_source)
        qty_note = ""

    # Primary action button (the action of the token this page was opened with).
    primary_btn = (
        f'<button type="submit" onclick="document.getElementById(\'action_token\').value=\'{token}\';" '
        f'style="flex:1;background:{accent};color:#ffffff;border:none;padding:16px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;">'
        f'{emoji}&nbsp; Confirm {action_word}</button>'
    )
    # Secondary (opposite) button — e.g. Reject when opened from the Approve link.
    secondary_btn = ""
    if secondary_token and secondary_action:
        sec_is_approve = secondary_action == "approved"
        sec_word = "Approve Request" if sec_is_approve else "Reject Request"
        sec_accent = "#059669" if sec_is_approve else "#dc2626"
        sec_emoji = "&#10003;" if sec_is_approve else "&#10007;"
        secondary_btn = (
            f'<button type="submit" onclick="document.getElementById(\'action_token\').value=\'{secondary_token}\';" '
            f'style="flex:1;background:#ffffff;color:{sec_accent};border:2px solid {sec_accent};padding:16px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;">'
            f'{sec_emoji}&nbsp; {sec_word}</button>'
        )

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:40px auto;background:#ffffff;border-radius:20px;box-shadow:0 8px 30px rgba(15,23,42,0.08);overflow:hidden;">
  <div style="background:linear-gradient(135deg,#0f172a,#1e3a8a);padding:32px 40px;">
    <div style="font-size:12px;color:#93c5fd;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">ECEWS Tools Inventory</div>
    <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">{role_label} Review</h1>
    <p style="margin:8px 0 0;color:#bfdbfe;font-size:14px;">Request #{req_id} &mdash; {_esc(facility)}</p>
  </div>
  <div style="padding:32px 40px;">
    <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">
      <strong>{_esc(requester_name)}</strong> from <strong>{_esc(facility)}</strong> has submitted a request.
      Please confirm the action below. No action is taken until you click a button.
    </p>
    <form method="POST" action="/api/supervisor/action" id="reviewForm">
      <input type="hidden" name="token" id="action_token" value="{token}" />
      {qty_note}
      {table}
      <div style="display:flex;gap:10px;margin-top:16px;">
        {primary_btn}
        {secondary_btn}
      </div>
    </form>
  </div>
  <div style="padding:20px 40px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:12px;">TIMS &mdash; Tools Inventory Management System</div>
</div></body></html>"""


def _request_still_awaits_reviewer(request_obj, role):
    """Return True if `request_obj` is still at the stage where this reviewer's
    decision is required (so a token consumed prematurely should be restored)."""
    if not request_obj:
        return False
    st = (request_obj.status or "").strip().lower()
    if role == "facility_supervisor":
        return st == "pending supervisor review"
    if role == "si_management":
        return st == "pending s.i review"
    return False


def _request_status_description(request_obj):
    """Human-friendly summary of a request's current status (for the
    'already processed' page)."""
    st = (request_obj.status or "").strip().lower()
    when = ""
    if request_obj.date_rejected:
        try:
            when = f" on {request_obj.date_rejected.strftime('%Y-%m-%d at %H:%M')}"
        except Exception:
            when = ""
    if st == "rejected":
        return f"It was rejected{when}."
    if st == "approved":
        return "It has been fully approved and is being processed."
    if st == "delivered":
        return "It has been approved and delivered."
    if st == "pending s.i review":
        return "It has been approved by the facility supervisor and is now awaiting S.I. Management review."
    if st == "pending":
        return "It is currently pending final approval by the administrator."
    if st == "pending supervisor review":
        return "It is currently awaiting facility supervisor review."
    return f"Its current status is '{request_obj.status}'."


@api_bp.route("/supervisor/action", methods=["GET", "POST"])
def supervisor_email_action():
    from mailer import _verify_action_token, _make_action_token, notify_si_management_of_request, _esc

    # POST performs the action; GET only shows a confirmation page (no action),
    # so email security scanners that fetch links can never auto-approve.
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        token = (request.form.get("token") or data.get("token") or "").strip()
    else:
        token = (request.args.get("token") or "").strip()

    if not token:
        return _supervisor_page("Invalid Link", "No token was provided."), 400

    # _verify_action_token returns (request_id, email, role, action) on success
    # or (None, error_message) on failure.
    result = _verify_action_token(token)
    if result[0] is None:
        return _supervisor_page("Invalid or Expired Link", _esc(result[1])), 400
    req_id, email, role, action = result

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    sa = SupervisorAction.query.filter_by(token_hash=token_hash).first()

    request_obj = RequestModel.query.get(req_id)
    if not request_obj:
        return _supervisor_page("Request Not Found", "The request associated with this link no longer exists."), 404

    if sa is None:
        # The signature verified (the link is authentic) but there is no recorded
        # review row for it (e.g. the email predates the DB row, or a newer email
        # superseded it). Tell the reviewer how to proceed instead of a dead-end.
        return _supervisor_page(
            "Link Not Found",
            "This link could not be matched to a review for this request. It may have been "
            "replaced by a newer email. Please use the most recent email you received for "
            "this request, or contact the TIMS administrator for help."
        ), 200

    if sa.action != "pending":
        # The token was already consumed. If the request is STILL waiting on this
        # reviewer, the action never actually took effect (e.g. a duplicate submit,
        # a browser retry, or an email link-checker during a slow server wake-up),
        # so restore the token and let the reviewer complete their action. Otherwise
        # the request genuinely moved on - show a clear status instead of the
        # confusing "link already used" dead-end.
        if _request_still_awaits_reviewer(request_obj, role):
            sa.action = "pending"
            sa.created_at = datetime.utcnow()
            db.session.commit()
        else:
            detail = _request_status_description(request_obj)
            return _supervisor_page(
                "Already Processed",
                f"This request has already been processed. {detail} No further action is needed from this link."
            ), 200

    requester = Users.query.get(request_obj.user_id)
    facility_name = requester.facility if requester else "Unknown Facility"
    tools_rows = RequestedTool.query.filter_by(request_id=req_id).all()
    tools_list = [{
        "tool_id": rt.tool_id,
        "name": (Tool.query.get(rt.tool_id).name if Tool.query.get(rt.tool_id) else "Unknown"),
        "quantity": rt.quantity,
    } for rt in tools_rows]

    # GET: show confirmation page (do NOT act)
    if request.method == "GET":
        role_label = "Facility Supervisor" if role == "facility_supervisor" else "S.I. Management"
        # Facility supervisor sees their facility stock; S.I. sees the state/central stock.
        stock_source = "state" if role == "si_management" else "facility"
        # S.I. (Super Supervisors) can set the actual approved quantity per tool.
        allow_quantities = role == "si_management"

        # Provide the opposite-action button too (e.g. Reject when opened from the
        # Approve link). Recreate the sibling token with the SAME expiry embedded in
        # this token, so it matches the one already sent in the email (no orphans).
        secondary_action = None
        secondary_token = None
        if allow_quantities:
            try:
                expiry = int(token.split("|")[4])
                opposite = "rejected" if action == "approved" else "approved"
                opp_token = _make_action_token(req_id, email, role, opposite, expiry=expiry)
                opp_hash = hashlib.sha256(opp_token.encode()).hexdigest()
                if not SupervisorAction.query.filter_by(token_hash=opp_hash).first():
                    db.session.add(SupervisorAction(
                        request_id=req_id, reviewer_email=email, reviewer_role=role,
                        action="pending", token_hash=opp_hash))
                    db.session.commit()
                secondary_action = opposite
                secondary_token = opp_token
            except Exception:
                pass

        # S.I. sees each tool's utilization (given vs achieved) on the review page.
        if role == "si_management":
            tools_list = _enrich_tools_with_utilization(tools_list, facility_name)

        return _supervisor_confirm_page(req_id, facility_name,
                                        requester.first_name if requester else "Unknown",
                                        role_label, action, token, tools_list, stock_source,
                                        allow_quantities, secondary_action, secondary_token), 200

    # POST: perform the action
    if action == "approved":
        sa.action = "approved"
        sa.created_at = datetime.utcnow()
        if role == "facility_supervisor":
            si_setting = SystemSetting.query.filter_by(key="si_management_email").first()
            if si_setting and si_setting.value:
                request_obj.status = "Pending S.I Review"
                db.session.commit()
                try:
                    notify_si_management_of_request(
                        request_id=req_id,
                        facility_name=facility_name,
                        requester_name=requester.first_name if requester else "Unknown",
                        tools_list=_enrich_tools_with_utilization(tools_list, facility_name),
                        supervisor_name=email,
                    )
                except Exception:
                    current_app.logger.exception("Failed to notify S.I Management")
                return _supervisor_page("Approved", "Your approval has been recorded. The request has been forwarded to S.I. Management.", "ok"), 200
            else:
                request_obj.status = "Pending"
                db.session.commit()
                return _supervisor_page("Approved", "Your approval has been recorded. The request has been forwarded to admin.", "ok"), 200
        elif role == "si_management":
            # Save the S.I.-approved quantity per tool (entered on the review page).
            # These are submitted as form fields named qty_<tool_id>.
            for ln in (request_obj.requested_tools or []):
                field = request.form.get(f"qty_{ln.tool_id}")
                if field is not None and str(field).strip() != "":
                    try:
                        q = int(float(field))
                        if q >= 0:
                            ln.approved_quantity = q
                    except (ValueError, TypeError):
                        pass
            sa.approved_quantities = json.dumps({
                str(ln.tool_id): ln.approved_quantity
                for ln in (request_obj.requested_tools or [])
                if ln.approved_quantity is not None
            })
            request_obj.status = "Pending"
            db.session.commit()
            return _supervisor_page("Approved", "Your S.I. approval has been recorded. The request has been sent to admin.", "ok"), 200
    elif action == "rejected":
        sa.action = "rejected"
        sa.created_at = datetime.utcnow()
        request_obj.status = "Rejected"
        request_obj.date_rejected = datetime.utcnow()
        request_obj.rejection_reason = f"Rejected by {role.replace('_', ' ').title()} ({email})"
        for ln in (request_obj.requested_tools or []):
            ln.status = "Rejected"
        _audit("supervisor_reject", "request", req_id, {"role": role, "email": email})
        db.session.commit()
        return _supervisor_page("Rejected", "The request has been rejected.", "err"), 200
    return _supervisor_page("Unknown Action", ""), 400


# ---------------------------------------------------------------------------
# Admin: Supervisor CRUD
# ---------------------------------------------------------------------------

@api_bp.route("/admin/supervisors", methods=["GET"])
@login_required
def list_supervisors():
    if not _is_admin_user(current_user): return _admin_required_json()
    supervisors = Users.query.filter_by(is_supervisor=True).all()
    result = []
    for s in supervisors:
        facilities = json.loads(s.supervised_facilities or "[]")
        result.append({"id": s.id, "email": s.email, "username": s.username, "first_name": s.first_name, "supervised_facilities": facilities, "supervised_count": len(facilities) if facilities else "All facilities"})
    return jsonify(result), 200


@api_bp.route("/admin/supervisors", methods=["POST"])
@login_required
def create_supervisor():
    if not _is_admin_user(current_user): return _admin_required_json()
    data = _json_body()
    email = (data.get("email") or "").strip().lower()
    first_name = (data.get("first_name") or data.get("name") or "").strip()
    facilities = data.get("facilities") or []
    if not email: return jsonify({"error": "Email is required"}), 400
    if not isinstance(facilities, list): return jsonify({"error": "facilities must be a list"}), 400
    user = Users.query.filter(func.lower(Users.email) == email).first()
    if user:
        user.is_supervisor = True
        user.supervised_facilities = json.dumps(facilities)
    else:
        username = email.split("@")[0]
        base = username; counter = 1
        while Users.query.filter(func.lower(Users.username) == username.lower()).first():
            username = f"{base}{counter}"; counter += 1
        user = Users(email=email, username=username, first_name=first_name or "Supervisor", facility="Supervisor", password=_hash_password("changeme123"), roles="supervisor", is_supervisor=True, supervised_facilities=json.dumps(facilities))
        db.session.add(user)
    db.session.commit()
    return jsonify({"message": "Supervisor created/updated", "id": user.id, "email": user.email, "supervised_facilities": facilities}), 201


@api_bp.route("/admin/supervisors/<int:user_id>", methods=["PUT"])
@login_required
def update_supervisor(user_id):
    if not _is_admin_user(current_user): return _admin_required_json()
    user = Users.query.get_or_404(user_id)
    data = _json_body()
    if "facilities" in data: user.supervised_facilities = json.dumps(data["facilities"] or [])
    if "email" in data: user.email = (data.get("email") or "").strip().lower()
    if "first_name" in data: user.first_name = (data.get("first_name") or "").strip()
    db.session.commit()
    return jsonify({"message": "Supervisor updated"}), 200


@api_bp.route("/admin/supervisors/<int:user_id>", methods=["DELETE"])
@login_required
def remove_supervisor(user_id):
    if not _is_admin_user(current_user): return _admin_required_json()
    user = Users.query.get_or_404(user_id)
    user.is_supervisor = False
    user.supervised_facilities = None
    db.session.commit()
    return jsonify({"message": "Supervisor removed"}), 200


# ---------------------------------------------------------------------------
# Admin: S.I Management Settings
# ---------------------------------------------------------------------------

@api_bp.route("/admin/settings/si-management", methods=["GET"])
@login_required
def get_si_management_settings():
    if not _is_admin_user(current_user): return _admin_required_json()
    setting = SystemSetting.query.filter_by(key="si_management_entries").first()
    entries = []
    if setting and setting.value:
        try:
            entries = json.loads(setting.value)
        except Exception:
            entries = []
    # Also support legacy single-email format
    if not entries:
        legacy = SystemSetting.query.filter_by(key="si_management_email").first()
        if legacy and legacy.value:
            entries = [{"email": legacy.value.strip(), "name": "S.I Management"}]
    return jsonify({"entries": entries}), 200


@api_bp.route("/admin/settings/si-management", methods=["PUT"])
@login_required
def update_si_management_settings():
    if not _is_admin_user(current_user): return _admin_required_json()
    data = _json_body()
    entries = data.get("entries") or []
    if not isinstance(entries, list):
        return jsonify({"error": "entries must be a list"}), 400
    setting = SystemSetting.query.filter_by(key="si_management_entries").first()
    if setting:
        setting.value = json.dumps(entries)
    else:
        setting = SystemSetting(key="si_management_entries", value=json.dumps(entries))
        db.session.add(setting)
    # Also update legacy field for backward compat
    legacy = SystemSetting.query.filter_by(key="si_management_email").first()
    primary_email = entries[0]["email"] if entries else ""
    if legacy:
        legacy.value = primary_email
    elif primary_email:
        db.session.add(SystemSetting(key="si_management_email", value=primary_email))
    db.session.commit()
    return jsonify({"message": "S.I Management updated", "entries": entries}), 200


# ---------------------------------------------------------------------------
# Admin: List All Facilities
# ---------------------------------------------------------------------------

@api_bp.route("/admin/facilities-list", methods=["GET"])
@login_required
def list_all_facilities():
    if not _is_admin_user(current_user): return _admin_required_json()
    user_facs = db.session.query(Users.facility).filter(Users.facility.isnot(None), Users.facility != "", Users.facility != "Supervisor").distinct().order_by(Users.facility).all()
    return jsonify([r[0] for r in user_facs]), 200

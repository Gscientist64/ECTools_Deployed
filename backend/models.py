# backend/models.py
from datetime import datetime
from sqlalchemy import func
from flask_login import UserMixin
from extensions import db

# ---------- Users ----------
class Users(db.Model, UserMixin):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)

    # columns confirmed from your seed output:
    # {'first_name','facility','password','id','username','email','is_active_flag','roles','other_name'}
    first_name     = db.Column(db.String(100), nullable=False)
    other_name     = db.Column(db.String(100), nullable=True)
    email          = db.Column(db.String(100), nullable=False)
    facility       = db.Column(db.String(100), nullable=True)
    username       = db.Column(db.String(100), unique=True, nullable=False)
    password       = db.Column(db.String(200), nullable=False)   # plaintext for now (you can migrate later)
    roles          = db.Column(db.String(50),  nullable=False, default='user')
    is_active_flag = db.Column(db.Boolean, default=True)

    # relationships
    requests = db.relationship('Request', back_populates='user', cascade="all, delete-orphan", foreign_keys='[Request.user_id]')
    usage_records = db.relationship('ToolUsage', back_populates='user', cascade="all, delete-orphan")

    # Flask-Login
    @property
    def is_active(self):
        return self.is_active_flag

    def get_id(self):
        return str(self.id)

    def to_dict(self):
        return {
            "id": self.id,
            "first_name": self.first_name,
            "other_name": self.other_name,
            "email": self.email,
            "facility": self.facility,
            "username": self.username,
            "roles": self.roles
        }

# ---------- Tool Category ----------
class ToolCategory(db.Model):
    __tablename__ = 'tool_category'

    id    = db.Column(db.Integer, primary_key=True)
    name  = db.Column(db.String(255), unique=True, nullable=False)
    tools = db.relationship('Tool', backref='category', lazy=True, cascade="all, delete-orphan")

    def __repr__(self):
        return f"<ToolCategory {self.name}>"

# ---------- Tool ----------
class Tool(db.Model):
    __tablename__ = 'tool'

    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(200), nullable=False)
    description = db.Column(db.String(500), nullable=True)
    quantity    = db.Column(db.Integer, nullable=False, default=0)
    category_id = db.Column(db.Integer, db.ForeignKey('tool_category.id'))

    # relationships
    requested_tool = db.relationship('RequestedTool', back_populates='tool', cascade="all, delete-orphan")
    usage_records  = db.relationship('ToolUsage', back_populates='tool', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category.name if self.category else None
        }

    @property
    def available_quantity(self):
        # Total approved requested quantity minus total used
        approved_requests = RequestedTool.query.filter_by(tool_id=self.id, status='approved').all()
        total_requested = sum(rt.quantity for rt in approved_requests)
        total_used = sum(usage.quantity_used for usage in self.usage_records)
        return total_requested - total_used

# ---------- Request (header) ----------
class Request(db.Model):
    __tablename__ = 'request'

    id               = db.Column(db.Integer, primary_key=True)
    user_id          = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status           = db.Column(db.String(50), default='Pending')
    date_requested   = db.Column(db.DateTime, default=datetime.utcnow)
    date_approved    = db.Column(db.DateTime, nullable=True)
    date_rejected    = db.Column(db.DateTime, nullable=True)
    rejection_reason = db.Column(db.String(500), nullable=True)
    approved_by_id   = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    rejected_by_id   = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # relationships
    user            = db.relationship('Users', back_populates='requests', foreign_keys=[user_id])
    approved_by     = db.relationship('Users', foreign_keys=[approved_by_id])
    rejected_by     = db.relationship('Users', foreign_keys=[rejected_by_id])
    requested_tools = db.relationship('RequestedTool', back_populates='request', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "user": self.user.first_name if self.user else None,
            "status": self.status,
            "rejection_reason": self.rejection_reason,
            "tools": [rt.to_dict() for rt in self.requested_tools],
            "requested_tools": [rt.to_dict() for rt in self.requested_tools],
        }

# ---------- RequestedTool (line items) ----------
class RequestedTool(db.Model):
    __tablename__ = 'requested_tool'

    id         = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(db.Integer, db.ForeignKey('request.id'), nullable=False)
    tool_id    = db.Column(db.Integer, db.ForeignKey('tool.id'),    nullable=False)
    quantity   = db.Column(db.Integer, nullable=False)
    status     = db.Column(db.String(50), default='Pending')  # per-line status

    # relationships
    request = db.relationship('Request', back_populates='requested_tools')
    tool    = db.relationship('Tool',    back_populates='requested_tool')

    def to_dict(self):
        return {
            "id": self.id,
            "request_id": self.request_id,
            "tool_name": self.tool.name if self.tool else None,
            "quantity": self.quantity,
            "status": self.status
        }

# ---------- ToolUsage ----------
class ToolUsage(db.Model):
    __tablename__ = 'tool_usage'

    id            = db.Column(db.Integer, primary_key=True)
    tool_id       = db.Column(db.Integer, db.ForeignKey('tool.id'),   nullable=False)
    user_id       = db.Column(db.Integer, db.ForeignKey('users.id'),  nullable=False)
    quantity_used = db.Column(db.Integer, nullable=False)
    date_used     = db.Column(db.DateTime, default=datetime.utcnow)

    # relationships
    tool = db.relationship('Tool',  back_populates='usage_records')
    user = db.relationship('Users', back_populates='usage_records')

    def to_dict(self):
        return {
            "id": self.id,
            "tool_id": self.tool_id,
            "tool_name": self.tool.name if self.tool else None,
            "user_id": self.user_id,
            "user_name": self.user.first_name if self.user else None,
            "quantity_used": self.quantity_used,
            "date_used": self.date_used
        }

# Add after ToolUsage class in models.py

class Delivery(db.Model):
    """Tracks delivery of approved requests"""
    __tablename__ = 'delivery'

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(db.Integer, db.ForeignKey('request.id'), nullable=False)
    tool_id = db.Column(db.Integer, db.ForeignKey('tool.id'), nullable=False)
    requested_tool_id = db.Column(db.Integer, db.ForeignKey('requested_tool.id'), nullable=False)
    
    # Delivery details
    quantity_supplied = db.Column(db.Integer, nullable=False)
    basic_unit = db.Column(db.String(50), nullable=False)
    
    # People involved
    distributed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    received_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    witnessed_by = db.Column(db.String(200), nullable=True)
    
    # Status
    is_delivered = db.Column(db.Boolean, default=False)
    delivery_date = db.Column(db.DateTime, nullable=True)
    delivery_confirmed_at = db.Column(db.DateTime, nullable=True)
    
    # Delivery note
    delivery_note_path = db.Column(db.String(500), nullable=True)
    delivery_note_generated_at = db.Column(db.DateTime, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    request = db.relationship('Request', backref='deliveries', foreign_keys=[request_id])
    tool = db.relationship('Tool', backref='deliveries', foreign_keys=[tool_id])
    requested_tool = db.relationship('RequestedTool', backref='delivery', foreign_keys=[requested_tool_id])
    distributor = db.relationship('Users', foreign_keys=[distributed_by], backref='distributed_deliveries')
    receiver = db.relationship('Users', foreign_keys=[received_by], backref='received_deliveries')


# ---------- Stock Receipt ----------
class StockReceipt(db.Model):
    """Documents tools received from suppliers"""
    __tablename__ = 'stock_receipt'

    id = db.Column(db.Integer, primary_key=True)
    date_supplied = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    supplied_from = db.Column(db.String(200), nullable=False)  # Supplier/District name
    supplied_by = db.Column(db.String(200), nullable=False)     # Person who supplied
    received_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    received_date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    receiver = db.relationship('Users', foreign_keys=[received_by], backref='stock_receipts')
    lines = db.relationship('StockReceiptLine', back_populates='receipt', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "date_supplied": self.date_supplied.isoformat() if self.date_supplied else None,
            "supplied_from": self.supplied_from,
            "supplied_by": self.supplied_by,
            "received_by": self.received_by,
            "received_by_name": self.receiver.first_name if self.receiver else None,
            "received_date": self.received_date.isoformat() if self.received_date else None,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "lines": [ln.to_dict() for ln in (self.lines or [])],
        }


class StockReceiptLine(db.Model):
    """Line items within a stock receipt"""
    __tablename__ = 'stock_receipt_line'

    id = db.Column(db.Integer, primary_key=True)
    receipt_id = db.Column(db.Integer, db.ForeignKey('stock_receipt.id'), nullable=False)
    serial_number = db.Column(db.String(100), nullable=True)
    tool_id = db.Column(db.Integer, db.ForeignKey('tool.id'), nullable=False)
    quantity_received = db.Column(db.Integer, nullable=False, default=0)

    # Relationships
    receipt = db.relationship('StockReceipt', back_populates='lines')
    tool = db.relationship('Tool', backref='stock_receipt_lines')

    def to_dict(self):
        return {
            "id": self.id,
            "receipt_id": self.receipt_id,
            "serial_number": self.serial_number,
            "tool_id": self.tool_id,
            "tool_name": self.tool.name if self.tool else None,
            "quantity_received": self.quantity_received,
        }


# ---------- Facility Stock ----------
class FacilityStock(db.Model):
    """Per-facility, per-tool stock levels"""
    __tablename__ = 'facility_stock'

    id              = db.Column(db.Integer, primary_key=True)
    tool_id         = db.Column(db.Integer, db.ForeignKey('tool.id'), nullable=False)
    facility        = db.Column(db.String(100), nullable=False)
    quantity        = db.Column(db.Integer, nullable=False, default=0)
    opening_balance = db.Column(db.Integer, nullable=False, default=0)
    qty_received    = db.Column(db.Integer, nullable=False, default=0)

    # composite unique constraint: one row per tool per facility
    __table_args__ = (db.UniqueConstraint('tool_id', 'facility', name='uq_tool_facility'),)

    tool = db.relationship('Tool', backref='facility_stocks')

    def to_dict(self):
        return {
            "id": self.id,
            "tool_id": self.tool_id,
            "tool_name": self.tool.name if self.tool else None,
            "facility": self.facility,
            "quantity": self.quantity,
            "opening_balance": self.opening_balance,
            "qty_received": self.qty_received,
        }


# ---------- Department Distribution ----------
class DepartmentDistribution(db.Model):
    """Records tools distributed to departments within a facility"""
    __tablename__ = 'department_distribution'

    id              = db.Column(db.Integer, primary_key=True)
    facility        = db.Column(db.String(100), nullable=False)
    tool_id         = db.Column(db.Integer, db.ForeignKey('tool.id'), nullable=False)
    department      = db.Column(db.String(50), nullable=False)  # lab, pharmacy, triage, community, others
    quantity        = db.Column(db.Integer, nullable=False)
    distributed_by  = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    date_distributed = db.Column(db.DateTime, default=datetime.utcnow)
    notes           = db.Column(db.String(300), nullable=True)

    tool = db.relationship('Tool', backref='department_distributions')
    distributor = db.relationship('Users', foreign_keys=[distributed_by])

    def to_dict(self):
        return {
            "id": self.id,
            "facility": self.facility,
            "tool_id": self.tool_id,
            "tool_name": self.tool.name if self.tool else None,
            "department": self.department,
            "quantity": self.quantity,
            "distributed_by": self.distributor.first_name if self.distributor else None,
            "issued_by": self.distributor.first_name if self.distributor else None,  # alias for frontend
            "distributed_by_id": self.distributed_by,
            "basic_unit": "unit",  # frontend compat
            "date_distributed": self.date_distributed.isoformat() if self.date_distributed else None,
            "created_at": self.date_distributed.isoformat() if self.date_distributed else None,  # alias
            "notes": self.notes
        }


# ---------- Physical Stock Count ----------
class PhysicalStockCount(db.Model):
    """Physical count vs system balance snapshots"""
    __tablename__ = 'physical_stock_count'

    id                = db.Column(db.Integer, primary_key=True)
    facility          = db.Column(db.String(100), nullable=False)
    tool_id           = db.Column(db.Integer, db.ForeignKey('tool.id'), nullable=False)
    system_quantity   = db.Column(db.Integer, nullable=False)
    physical_quantity = db.Column(db.Integer, nullable=False)
    discrepancy       = db.Column(db.Integer, nullable=False)  # physical - system
    counted_by        = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    counted_at        = db.Column(db.DateTime, default=datetime.utcnow)
    notes             = db.Column(db.String(300), nullable=True)

    tool = db.relationship('Tool', backref='physical_counts')
    counter = db.relationship('Users', foreign_keys=[counted_by])

    def to_dict(self):
        return {
            "id": self.id,
            "facility": self.facility,
            "tool_id": self.tool_id,
            "tool_name": self.tool.name if self.tool else None,
            "system_quantity": self.system_quantity,
            "physical_quantity": self.physical_quantity,
            "physical_count": self.physical_quantity,  # alias for frontend compat
            "discrepancy": self.discrepancy,
            "has_discrepancy": self.discrepancy != 0,
            "counted_by": self.counter.first_name if self.counter else None,
            "counted_by_id": self.counted_by,
            "counted_at": self.counted_at.isoformat() if self.counted_at else None,
            "created_at": self.counted_at.isoformat() if self.counted_at else None,  # alias
            "notes": self.notes
        }


# -----------------------
# Facility-to-Facility Transfer
# -----------------------

class FacilityTransfer(db.Model):
    __tablename__ = "facility_transfer"

    id = db.Column(db.Integer, primary_key=True)
    from_facility = db.Column(db.String(100), nullable=False)
    to_facility = db.Column(db.String(100), nullable=False)
    tool_id = db.Column(db.Integer, db.ForeignKey("tool.id"), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), default="pending")  # pending | accepted | rejected | cancelled
    notes = db.Column(db.String(300), default="")
    initiated_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    responded_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=func.now())
    responded_at = db.Column(db.DateTime, nullable=True)

    tool = db.relationship("Tool", backref="transfers", lazy=True)
    initiator = db.relationship("Users", foreign_keys=[initiated_by], lazy=True)
    responder = db.relationship("Users", foreign_keys=[responded_by], lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "from_facility": self.from_facility,
            "to_facility": self.to_facility,
            "tool_id": self.tool_id,
            "tool_name": self.tool.name if self.tool else None,
            "quantity": self.quantity,
            "status": self.status,
            "notes": self.notes or "",
            "initiated_by": self.initiator.first_name if self.initiator else None,
            "initiated_by_id": self.initiated_by,
            "responded_by": self.responder.first_name if self.responder else None,
            "responded_by_id": self.responded_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "responded_at": self.responded_at.isoformat() if self.responded_at else None,
        }


# ---------- Notification Read Tracker ----------
class NotificationRead(db.Model):
    """Tracks which delivery notifications each user has marked as read"""
    __tablename__ = 'notification_read'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    delivery_id = db.Column(db.Integer, db.ForeignKey('delivery.id'), nullable=False)
    read_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint('user_id', 'delivery_id', name='uq_user_delivery_read'),)
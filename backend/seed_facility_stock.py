"""
seed_facility_stock.py
Reads 'Facility Stock.xlsb' from the project root, populates FacilityStock for all
64 facilities, and creates users for any facility that doesn't have one yet.
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))

from pyxlsb import open_workbook
from app import create_app
from models import db, Users, Tool, FacilityStock
from werkzeug.security import generate_password_hash

XLSB_PATH = os.path.join(os.path.dirname(__file__), '..', 'Facility Stock.xlsb')

def _hash_pw(pw):
    return generate_password_hash(pw, method='pbkdf2:sha256')
DEFAULT_PASSWORD = 'Password1@'

def normalize(name):
    return re.sub(r'\s+', ' ', str(name or '')).strip().lower()

def best_match(query, options_map):
    """Exact (case-insensitive) first, then partial, then None."""
    q = normalize(query)
    for key, val in options_map.items():
        if normalize(key) == q:
            return val
    for key, val in options_map.items():
        if q in normalize(key) or normalize(key) in q:
            return val
    return None

def run():
    app = create_app()
    with app.app_context():
        # ── 1. Load DB tools ──────────────────────────────────────────────────
        all_tools = Tool.query.all()
        tool_map = {t.name: t for t in all_tools}

        # ── 2. Load DB users by facility ────────────────────────────────────
        all_users = Users.query.all()
        facility_user_map = {}  # facility_name → first user
        for u in all_users:
            if u.facility and u.roles != 'admin':
                facility_user_map.setdefault(u.facility, u)

        # ── 3. Read xlsb ────────────────────────────────────────────────────
        rows = []
        with open_workbook(XLSB_PATH) as wb:
            with wb.get_sheet('Distributed') as ws:
                for row in ws.rows():
                    rows.append([c.v for c in row])

        if not rows:
            print("ERROR: No rows found in 'Distributed' sheet")
            return

        header = rows[0]
        facility_col = header[0]  # first column header (e.g., "Facility")
        tool_headers = header[1:]  # rest are tool names

        print(f"Sheet has {len(rows)-1} facility rows and {len(tool_headers)} tool columns")

        # Map spreadsheet tool names → DB Tool objects
        tool_col_map = {}
        unmatched_tools = []
        for i, th in enumerate(tool_headers):
            match = best_match(th, tool_map)
            if match:
                tool_col_map[i] = match
            else:
                unmatched_tools.append(th)

        if unmatched_tools:
            print(f"\nWARNING: {len(unmatched_tools)} unmatched tool columns:")
            for t in unmatched_tools:
                print(f"  - {repr(t)}")

        print(f"\nMatched {len(tool_col_map)}/{len(tool_headers)} tool columns to DB tools")

        # ── 4. Process each facility row ─────────────────────────────────────
        new_users = []
        stock_created = 0
        stock_updated = 0

        for row in rows[1:]:
            if not row or row[0] is None:
                continue
            xlsb_facility = str(row[0]).strip()
            if not xlsb_facility:
                continue

            # Match facility name to existing DB facility
            db_facility = best_match(xlsb_facility, {f: f for f in facility_user_map.keys()})
            if not db_facility:
                # Use the xlsb name directly; we'll create a user for it
                db_facility = xlsb_facility

            # Create user if this facility has no user
            if db_facility not in facility_user_map:
                # Generate a clean username from facility name
                uname = re.sub(r'[^a-z0-9]', '_', normalize(db_facility))
                uname = re.sub(r'_+', '_', uname).strip('_')[:30]
                # Ensure uniqueness
                base = uname
                counter = 2
                while Users.query.filter_by(username=uname).first():
                    uname = f"{base}_{counter}"
                    counter += 1

                new_user = Users(
                    username=uname,
                    email=f"{uname}@ecews.org",
                    facility=db_facility,
                    roles='user',
                    first_name=db_facility,
                    password=_hash_pw(DEFAULT_PASSWORD),
                )
                db.session.add(new_user)
                db.session.flush()  # get ID
                facility_user_map[db_facility] = new_user
                new_users.append((db_facility, uname, DEFAULT_PASSWORD))
                print(f"  [NEW USER] {db_facility} -> username: {uname}")

            # Populate FacilityStock for each tool column
            for col_idx, tool in tool_col_map.items():
                raw_val = row[col_idx + 1] if (col_idx + 1) < len(row) else None
                try:
                    qty = int(float(raw_val)) if raw_val is not None and raw_val != '' else 0
                except (ValueError, TypeError):
                    qty = 0

                if qty <= 0:
                    continue  # skip zeros

                existing = FacilityStock.query.filter_by(
                    facility=db_facility, tool_id=tool.id
                ).first()

                if existing:
                    existing.quantity = qty
                    existing.opening_balance = qty
                    existing.qty_received = qty
                    stock_updated += 1
                else:
                    fs = FacilityStock(
                        facility=db_facility,
                        tool_id=tool.id,
                        quantity=qty,
                        opening_balance=qty,
                        qty_received=qty,
                    )
                    db.session.add(fs)
                    stock_created += 1

        db.session.commit()

        print(f"\n{'='*60}")
        print(f"DONE: {stock_created} stock records created, {stock_updated} updated")
        print(f"      {len(new_users)} new facility users created")

        if new_users:
            print(f"\n{'='*60}")
            print("NEW FACILITY LOGIN CREDENTIALS")
            print(f"{'='*60}")
            print(f"{'Facility':<50} {'Username':<35} {'Password'}")
            print(f"{'-'*50} {'-'*35} {'-'*12}")
            for fac, uname, pwd in sorted(new_users):
                print(f"{fac:<50} {uname:<35} {pwd}")

if __name__ == '__main__':
    run()

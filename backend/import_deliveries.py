"""
Import historical delivery notes from delivery_seed.xlsx.
- Auto-fixes NHIMS→NHMIS typos
- Creates users for facilities without accounts
- Creates Request + RequestedTool + Delivery records
- Does NOT modify Tool.quantity or FacilityStock
"""
import pandas as pd
import sys
from datetime import datetime

sys.path.insert(0, 'c:/ECEWS_ToolsApp_FinalDev/backend')
from app import create_app
from extensions import db
from models import Users, Tool, ToolCategory, Request, RequestedTool, Delivery
from werkzeug.security import generate_password_hash

EXCEL_PATH = 'c:/ECEWS_ToolsApp_FinalDev/delivery_seed.xlsx'
SHEET = 'Delivery Notes'
DEFAULT_PASSWORD = 'Password1@'
ADMIN_ID = 5  # Isaac / Gscientist64

# ── Facility name → username mapping ──
def make_username(facility_name):
    """Create a simple username from facility name."""
    # Lowercase, replace spaces with underscores, remove special chars
    u = facility_name.lower().strip()
    u = u.replace(' ', '_').replace('(', '').replace(')', '').replace("'", '')
    return u

def run():
    app = create_app()
    with app.app_context():
        # ── Load Excel ──
        df = pd.read_excel(EXCEL_PATH, sheet_name=SHEET)
        print(f"Loaded {len(df)} rows from '{SHEET}' sheet")

        # ── Fix known issues ──
        # 1. NHIMS → NHMIS
        df['Tool Name'] = df['Tool Name'].str.replace('NHIMS ', 'NHMIS ', regex=False)
        # 2. Fix row 81: Police Hospital → Facility Care & Support Screening Checklist
        mask = (df['Facility'] == 'University of Calabar Teaching Hospital') & (df['Tool Name'] == 'Police Hospital')
        if mask.any():
            df.loc[mask, 'Tool Name'] = 'Facility Care and Support Screening Checklist'
            df.loc[mask, 'Quantity Requested'] = 1
            df.loc[mask, 'Quantity Received'] = 1
            print("Fixed row 81: Police Hospital → Facility Care and Support Screening Checklist")

        # ── Normalize date column ──
        df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')

        # ── Load DB references ──
        db_tools = {t.name.lower().strip(): t for t in Tool.query.all()}
        db_users_all = Users.query.all()
        db_facility_users = {}
        for u in db_users_all:
            if u.facility:
                db_facility_users[u.facility.lower().strip()] = u

        # ── Find missing facilities & create users ──
        excel_facilities = set(str(f).strip() for f in df['Facility'].unique())
        missing = []
        for fac in sorted(excel_facilities):
            if fac.lower().strip() not in db_facility_users:
                missing.append(fac)

        if missing:
            print(f"\nCreating {len(missing)} new facility users...")
            for fac in missing:
                username = make_username(fac)
                # Ensure unique username
                existing = Users.query.filter_by(username=username).first()
                if existing:
                    username = username + '_facility'

                u = Users(
                    first_name=fac,
                    other_name='',
                    email=f'{username}@ecews.local',
                    facility=fac,
                    username=username,
                    password=generate_password_hash(DEFAULT_PASSWORD, method='pbkdf2:sha256'),
                    roles='user',
                    is_active_flag=True
                )
                db.session.add(u)
                db.session.flush()
                db_facility_users[fac.lower().strip()] = u
                print(f"  ✓ Created: {username} (ID={u.id}) for {fac}")
            db.session.commit()
            print("  Users committed.")
        else:
            print("\nAll facilities already have users ✓")

        # ── Validate all rows now ──
        errors = []
        for i, row in df.iterrows():
            fac = str(row['Facility']).strip()
            tool_name = str(row['Tool Name']).strip()
            if fac.lower() not in db_facility_users:
                errors.append(f'Row {i}: Facility "{fac}" - no user found (should not happen)')
            if tool_name.lower() not in db_tools:
                errors.append(f'Row {i}: Tool "{tool_name}" not found in DB')

        if errors:
            print(f'\n❌ {len(errors)} errors remain - aborting:')
            for e in errors:
                print(f'  {e}')
            return

        # ── Delete any previously created users if this is a re-run ──
        # (skip - we'll rely on DB unique constraints)

        print(f"\nAll {len(df)} rows validated ✓ - starting import...")

        # ── Import deliveries ──
        created_requests = 0
        created_deliveries = 0
        skipped = 0

        for i, row in df.iterrows():
            fac = str(row['Facility']).strip()
            tool_name = str(row['Tool Name']).strip()
            qty_req = int(row['Quantity Requested'])
            qty_rec = int(row['Quantity Received'])
            date_str = str(row['Date']).strip()

            # Parse date (already normalized to YYYY-MM-DD above)
            delivery_date = datetime.strptime(date_str[:10], '%Y-%m-%d')

            user = db_facility_users[fac.lower()]
            tool = db_tools[tool_name.lower()]

            # Create Request
            req = Request(
                user_id=user.id,
                status='Approved',
                date_requested=delivery_date,
                date_approved=delivery_date,
                approved_by_id=ADMIN_ID
            )
            db.session.add(req)
            db.session.flush()

            # Create RequestedTool
            rt = RequestedTool(
                request_id=req.id,
                tool_id=tool.id,
                quantity=qty_req,
                status='Approved'
            )
            db.session.add(rt)
            db.session.flush()

            # Create Delivery
            delivery = Delivery(
                request_id=req.id,
                tool_id=tool.id,
                requested_tool_id=rt.id,
                quantity_supplied=qty_rec,
                basic_unit='unit',
                received_by=user.id,
                distributed_by=ADMIN_ID,
                is_delivered=True,
                delivery_date=delivery_date,
                delivery_confirmed_at=delivery_date,
                created_at=delivery_date,
                updated_at=delivery_date
            )
            db.session.add(delivery)

            created_requests += 1
            created_deliveries += 1

            if (i + 1) % 20 == 0:
                db.session.commit()
                print(f"  ... {i + 1}/{len(df)} committed")

        db.session.commit()
        print(f"\n✅ DONE!")
        print(f"   Requests created:   {created_requests}")
        print(f"   Deliveries created: {created_deliveries}")
        print(f"   Skipped:            {skipped}")
        print(f"   Tool.quantity NOT modified")
        print(f"   FacilityStock NOT modified")

if __name__ == '__main__':
    run()

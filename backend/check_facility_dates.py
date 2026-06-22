import sys, json
sys.path.insert(0, 'c:/ECEWS_ToolsApp_FinalDev/backend')
from app import create_app
from models import Delivery, Users
from extensions import db
from datetime import datetime

app = create_app()
app.app_context().push()

# Check a few facilities to see what deliveries they have
print("=== Deliveries by Facility ===")
results = db.session.query(
    Users.facility,
    Delivery.delivery_date,
    Delivery.tool_id
).join(Users, Delivery.received_by == Users.id)\
 .filter(Delivery.is_delivered == True)\
 .order_by(Users.facility, Delivery.delivery_date).all()

from collections import defaultdict
by_fac = defaultdict(list)
for fac, dt, tid in results:
    month = dt.strftime('%b') if dt else '?'
    by_fac[fac].append(month)

# Show facilities with delivery months
for fac in sorted(by_fac):
    months = by_fac[fac]
    from collections import Counter
    counts = Counter(months)
    print(f"  {fac}: {dict(counts)}")

print("\n=== All unique months in DB ===")
all_months = set()
for dt, in db.session.query(Delivery.delivery_date).filter(Delivery.is_delivered == True).all():
    if dt:
        all_months.add(dt.strftime('%B %Y'))
print(f"  {sorted(all_months)}")

import sys
sys.path.insert(0, 'c:/ECEWS_ToolsApp_FinalDev/backend')
from app import create_app
from models import Delivery, Request
from extensions import db
from sqlalchemy import func, extract

app = create_app()
app.app_context().push()

# Check delivery dates distribution
print("=== Deliveries by Month ===")
results = db.session.query(
    func.date_trunc('month', Delivery.delivery_date).label('month'),
    func.count(Delivery.id)
).filter(Delivery.is_delivered == True).group_by('month').order_by('month').all()

for month, count in results:
    print(f"  {month.strftime('%B %Y') if month else 'NULL'}: {count} deliveries")

print("\n=== Sample deliveries (first 10) ===")
for d in Delivery.query.filter(Delivery.is_delivered == True).order_by(Delivery.delivery_date).limit(10).all():
    print(f"  ID={d.id} req_id={d.request_id} date={d.delivery_date} created={d.created_at}")

print("\n=== Request date_requested distribution ===")
results2 = db.session.query(
    func.date_trunc('month', Request.date_requested).label('month'),
    func.count(Request.id)
).group_by('month').order_by('month').all()

for month, count in results2:
    print(f"  {month.strftime('%B %Y') if month else 'NULL'}: {count} requests")

"""
backfill_delivered.py
Update requests that already have all lines confirmed (is_delivered=True)
but still have status="Approved" — set them to "Delivered".

Run:  python backfill_delivered.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app import create_app
from extensions import db
from models import Request, RequestedTool, Delivery


def main():
    app = create_app()
    with app.app_context():
        approved = Request.query.filter(
            db.func.lower(Request.status) == "approved"
        ).all()

        print(f"Checking {len(approved)} approved requests...")
        updated = 0

        for req in approved:
            lines = RequestedTool.query.filter_by(
                request_id=req.id, status="Approved"
            ).all()
            if not lines:
                continue

            # All lines must have a confirmed delivery
            all_delivered = all(
                Delivery.query.filter_by(
                    requested_tool_id=ln.id, is_delivered=True
                ).first() is not None
                for ln in lines
            )

            if all_delivered:
                req.status = "Delivered"
                updated += 1

        db.session.commit()
        print(f"Done — marked {updated} request(s) as Delivered.")


if __name__ == "__main__":
    main()

"""
mass_confirm.py  —  Confirm all approved requests on behalf of facilities.

Run from the backend/ directory:
    python mass_confirm.py          # dry-run (prints what will happen, no DB changes)
    python mass_confirm.py --run    # actually commits the changes

What it does:
  - Finds every Request with status = "Approved"
  - For each approved line item, creates a Delivery record (is_delivered=True)
    and updates / creates the facility's FacilityStock record
  - Skips requests whose lines already have a confirmed delivery
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime
from app import create_app
from extensions import db
from models import Request, RequestedTool, Delivery, FacilityStock, Users

DRY_RUN = "--run" not in sys.argv


def main():
    app = create_app()
    with app.app_context():
        now = datetime.utcnow()

        approved_requests = Request.query.filter(
            db.func.lower(Request.status) == "approved"
        ).all()

        print(f"\n{'[DRY RUN] ' if DRY_RUN else ''}Found {len(approved_requests)} approved request(s).\n")

        confirmed = 0
        skipped   = 0
        stock_updates = 0

        for req in approved_requests:
            requester = Users.query.get(req.user_id)
            if not requester or not requester.facility:
                print(f"  SKIP  Request #{req.id} — requester has no facility")
                skipped += 1
                continue

            facility = requester.facility

            lines = RequestedTool.query.filter_by(
                request_id=req.id, status="Approved"
            ).all()

            if not lines:
                print(f"  SKIP  Request #{req.id} — no approved line items")
                skipped += 1
                continue

            # Check if already fully confirmed
            already_done = all(
                Delivery.query.filter_by(
                    requested_tool_id=ln.id, is_delivered=True
                ).first() is not None
                for ln in lines
            )
            if already_done:
                print(f"  SKIP  Request #{req.id} ({facility}) — all lines already confirmed")
                skipped += 1
                continue

            print(f"  CONFIRM Request #{req.id} ({facility}) — {len(lines)} line(s)")
            confirmed += 1

            if DRY_RUN:
                for ln in lines:
                    print(f"          tool_id={ln.tool_id}  qty={ln.quantity}")
                continue

            for ln in lines:
                qty = int(ln.quantity or 0)
                if qty <= 0:
                    continue

                existing = Delivery.query.filter_by(requested_tool_id=ln.id).first()
                if existing:
                    if existing.is_delivered:
                        continue
                    existing.is_delivered         = True
                    existing.delivery_confirmed_at = now
                    existing.quantity_supplied     = qty
                else:
                    d = Delivery(
                        request_id        = req.id,
                        tool_id           = ln.tool_id,
                        requested_tool_id = ln.id,
                        quantity_supplied  = qty,
                        basic_unit         = "unit",
                        distributed_by     = req.approved_by_id,
                        received_by        = req.user_id,
                        witnessed_by       = "Mass-confirmed by admin",
                        delivery_date      = now,
                        delivery_confirmed_at = now,
                        is_delivered       = True,
                    )
                    db.session.add(d)

                # Update FacilityStock
                fs = FacilityStock.query.filter_by(
                    facility=facility, tool_id=ln.tool_id
                ).first()
                if fs:
                    fs.quantity     += qty
                    fs.qty_received += qty
                else:
                    db.session.add(FacilityStock(
                        facility        = facility,
                        tool_id         = ln.tool_id,
                        quantity        = qty,
                        opening_balance = 0,
                        qty_received    = qty,
                    ))
                stock_updates += 1

        if DRY_RUN:
            print(f"\n[DRY RUN] Would confirm {confirmed} request(s), skip {skipped}.")
            print("Run with --run to apply changes.\n")
        else:
            db.session.commit()
            print(f"\nDone! Confirmed {confirmed} request(s), {stock_updates} stock update(s), skipped {skipped}.\n")


if __name__ == "__main__":
    main()

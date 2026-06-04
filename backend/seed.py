# backend/seed.py
"""Seed new tools after a clean sweep with proper categories."""

from app import create_app
from models import *
from extensions import db

# (name, quantity, category_name)
NEW_TOOLS = [
    # ── Register ──
    ("National PMTCT Register", 21, "Register"),
    ("National PMTCT Child Follow Up Register", 50, "Register"),
    ("HTS Register", 187, "Register"),
    ("National ART register", 27, "Register"),
    ("Pharmacovigilance register", 1, "Register"),
    ("Integrated Laboratory Monitoring Register", 1, "Register"),
    ("Enhanced Adherence Counselling monitoring register", 46, "Register"),
    ("HIV tracking register", 44, "Register"),
    ("PrEP/PEP register", 37, "Register"),
    ("NHMIS ANC Register", 46, "Register"),
    ("NHMIS L&D Register", 41, "Register"),
    ("VH Laboratory Register", 43, "Register"),
    ("VH Treatment Register", 0, "Register"),
    ("STI Register", 29, "Register"),
    ("Referral Register", 49, "Register"),
    ("Post Violence Care Register", 11, "Register"),
    ("PMTCT Spoke Register", 49, "Register"),
    ("CMP Register", 28, "Register"),
    ("Appointment Diary (PMTCT)", 0, "Register"),
    ("Pharmacy Daily worksheet", 62, "Register"),
    ("Biometric Confirmation Slip", 14, "Register"),

    # ── Card ──
    ("Mother Infant Pair card", 206, "Card"),
    ("Care/ART Card", 2497, "Card"),
    ("PrEP/PEP card", 426, "Card"),
    ("VH Client Enrollment & Follow Up Card", 36, "Card"),

    # ── Form ──
    ("PMTCT Monthly Summary Form (Addendum)", 2, "Form"),
    ("National HTS form", 182, "Form"),
    ("Index Contact Testing Form", 180, "Form"),
    ("Combined Pharmacy Order Form", 1023, "Form"),
    ("Integrated Laboratory Order and Result Form", 307, "Form"),
    ("Client contact revalidation form", 5470, "Form"),
    ("Enhanced Adherence Counselling form", 41, "Form"),
    ("HIV Care & Treatment Transfer form", 27, "Form"),
    ("PrEP/PEP screening and eligibility form", 44, "Form"),
    ("BIometric Incidence Form", 11, "Form"),
    ("Client Referral Form", 14, "Form"),
    ("GBV Service Delivery Form", 2, "Form"),
    ("GBV Incidence Form", 14, "Form"),
    ("Informed Consent Form", 6, "Form"),
    ("NAFDAC Pharmacovigilance Form", 45, "Form"),
    ("Internal Requisition Form", 89, "Form"),
    ("Client Records Verification Form", 421, "Form"),
    ("Site Visit Reporting Form", 18, "Form"),
    ("Sample Transfer Form", 11, "Form"),
    ("Facility Care and Support Screening Checklist", 289, "Form"),
    ("Records for Transferring and Returning Commodities", 148, "Form"),
    ("Monthly Stock Status Tracker", 93, "Form"),
    ("Patient Per Regimen", 6, "Form"),
    # CRRF forms
    ("CRRF Laboratory", 52, "Form"),
    ("CRRF Rapid Test Kit", 35, "Form"),
    ("CRRF ARVs and OIs", 83, "Form"),

    # ── MSF ──
    ("National PMTCT MSF", 96, "MSF"),
    ("HTS MSF", 24, "MSF"),
    ("Index Testing MSF (Addendum)", 2, "MSF"),
    ("National ART MSF", 24, "MSF"),
    ("PrEP/PEP MSF", 24, "MSF"),
    ("VH MSF", 24, "MSF"),
    ("STI MSF", 19, "MSF"),
    ("TB/HIV MSF revised", 4, "MSF"),
    ("Post Violence Care MSF", 27, "MSF"),
    ("PMTCT Spoke MSF", 80, "MSF"),

    # ── Charts ──
    ("Temperature Charts (Room and Fridge)", 694, "Charts"),
]


def run():
    app = create_app()
    with app.app_context():
        # 1. Delete dependent records → tools → old unwanted categories
        print("Deleting all related records...")
        ToolUsage.query.delete()
        RequestedTool.query.delete()
        Delivery.query.delete()
        FacilityStock.query.delete()
        DepartmentDistribution.query.delete()
        PhysicalStockCount.query.delete()
        db.session.flush()
        Tool.query.delete()
        db.session.flush()
        db.session.commit()
        print("Deleted all tools and related records.")

        # 2. Remove old default categories (Office Supplies, Furniture, Cleaning)
        for old_name in ["Office Supplies", "Furniture", "Cleaning"]:
            cat = ToolCategory.query.filter_by(name=old_name).first()
            if cat:
                db.session.delete(cat)
        db.session.commit()
        print("Removed old default categories.")

        # 3. Ensure new categories exist
        category_names = ["Register", "Card", "Form", "MSF", "Others", "Charts"]
        cats = {}
        for name in category_names:
            cat = ToolCategory.query.filter_by(name=name).first()
            if not cat:
                cat = ToolCategory(name=name)
                db.session.add(cat)
                db.session.flush()
            cats[name] = cat
        db.session.commit()
        print(f"Ensured categories: {list(cats.keys())}")

        # 4. Seed new tools
        for tool_name, qty, cat_name in NEW_TOOLS:
            tool = Tool(
                name=tool_name,
                quantity=qty,
                category_id=cats[cat_name].id
            )
            db.session.add(tool)
        db.session.commit()

        print(f"Seeded {len(NEW_TOOLS)} new tools.")


if __name__ == "__main__":
    run()
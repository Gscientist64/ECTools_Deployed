# backend/create_user.py
from app import create_app
from extensions import db
from models import Users
from werkzeug.security import generate_password_hash

# ====== EDIT THESE ======
EMAIL      = "ecews.admin@example.com"
USERNAME   = "ecewsadmin"
PASSWORD   = "Admin#2024"
FIRST_NAME = "ECEWS Admin"
FACILITY   = "State Office Team"     # pick any facility you use
ROLE       = "admin"                 # "admin" or "user"
# ========================

app = create_app()
with app.app_context():
    # find existing by email OR username (if column exists)
    q = Users.query
    if hasattr(Users, "username"):
        u = q.filter((Users.email == EMAIL) | (Users.username == USERNAME)).first()
    else:
        u = q.filter(Users.email == EMAIL).first()

    if not u:
        u = Users()
        print("Creating new user…")
    else:
        print("Updating existing user…")

    # required/basic fields
    if hasattr(u, "email"):       u.email = EMAIL
    if hasattr(u, "username"):    u.username = USERNAME
    if hasattr(u, "first_name"):  u.first_name = FIRST_NAME
    if hasattr(u, "facility"):    u.facility = FACILITY
    if hasattr(u, "roles"):       u.roles = ROLE
    if hasattr(u, "role"):        u.role  = ROLE

    # Hash password properly — always use pbkdf2 for compatibility
    if hasattr(u, "password"):        u.password = generate_password_hash(PASSWORD, method="pbkdf2:sha256")
    if hasattr(u, "password_hash"):   u.password_hash = generate_password_hash(PASSWORD, method="pbkdf2:sha256")

    db.session.add(u)
    db.session.commit()

    # show result
    print("Done. User:")
    print("  id:", u.id)
    print("  email:", getattr(u, "email", None))
    print("  username:", getattr(u, "username", None))
    print("  roles:", getattr(u, "roles", getattr(u, "role", None)))

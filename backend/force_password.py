# force_password.py
from app import create_app
from extensions import db
from models import Users
from werkzeug.security import generate_password_hash

IDENT = "admin@example.com"   # or "admin"
NEW_PASSWORD = "Password1@"     # set what you want

app = create_app()
with app.app_context():
    q = Users.query.filter((Users.email == IDENT) | (Users.username == IDENT))
    u = q.first()
    if not u:
        print("No user found for", IDENT)
    else:
        u.password = generate_password_hash(NEW_PASSWORD, method="pbkdf2:sha256")
        db.session.commit()
        print("Password reset for:", IDENT)

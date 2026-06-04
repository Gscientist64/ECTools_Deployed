# force_password.py
from app import create_app
from extensions import db
from models import Users

IDENT = "admin@example.com"   # or "admin"
NEW_PASSWORD = "Password1@"     # set what you want

app = create_app()
with app.app_context():
    q = Users.query.filter((Users.email == IDENT) | (Users.username == IDENT))
    u = q.first()
    if not u:
        print("No user found for", IDENT)
    else:
        u.password = NEW_PASSWORD   # your schema uses plaintext 'password'
        db.session.commit()
        print("Password reset for:", IDENT)

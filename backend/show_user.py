# show_user.py
from app import create_app
from models import Users

IDENT = "admin@example.com"  # or "admin"

app = create_app()
with app.app_context():
    u = Users.query.filter((Users.email == IDENT) | (Users.username == IDENT)).first()
    if not u:
        print("No user found for:", IDENT)
    else:
        pw = getattr(u, "password", None)
        ph = getattr(u, "password_hash", None)
        def preview(v):
            if v is None: return None
            s = str(v)
            return (s[:12] + "...", len(s))
        print("User:", u.id, u.username, u.email)
        print("roles:", getattr(u, "roles", None))
        print("password column:", preview(pw))
        print("password_hash column:", preview(ph))

# backend/diagnose_login.py
from app import create_app
from extensions import db
from models import Users
from werkzeug.security import check_password_hash

IDENT_TRY = ["admin@example.com", "admin"]  # try both email & username
INPUT_PASSWORD = "admin123"                  # what you're typing on login

def looks_like_hash(v: str) -> bool:
    if not v: return False
    v = v.lower()
    return v.startswith(("pbkdf2:", "scrypt:", "argon2:", "bcrypt$", "sha256$", "sha1$"))

app = create_app()
with app.app_context():
    print("=== Diagnose login ===")
    for ident in IDENT_TRY:
        u = Users.query.filter(
            (Users.email == ident) | (getattr(Users,"username", Users.email) == ident)
        ).first()
        print(f"\nLookup by: {ident!r}")
        if not u:
            print(" -> NO USER FOUND")
            continue

        pw_col = getattr(u, "password", None)
        ph_col = getattr(u, "password_hash", None)

        def prev(x):
            if x is None: return None
            s = str(x)
            return s[:32] + ("..." if len(s) > 32 else "")

        print(" -> Found user:", u.id, getattr(u,"username",None), getattr(u,"email",None))
        print(" -> password column preview:", prev(pw_col))
        print(" -> password looks like hash?:", bool(looks_like_hash(pw_col or "")))
        print(" -> password_hash column present?:", ph_col is not None)

        # Try all verification paths your API might use
        ok_hash_col = check_password_hash(ph_col, INPUT_PASSWORD) if ph_col else False
        ok_pw_hash  = check_password_hash(pw_col, INPUT_PASSWORD) if looks_like_hash(pw_col or "") else False
        ok_plain    = (pw_col == INPUT_PASSWORD)

        print(" -> check against password_hash:", ok_hash_col)
        print(" -> check against password (as HASH):", ok_pw_hash)
        print(" -> check against password (PLAINTEXT):", ok_plain)

        if ok_hash_col or ok_pw_hash or ok_plain:
            print(" ==> DIAGNOSIS: These credentials SHOULD succeed if your /api/login accepts this path.")
        else:
            print(" ==> DIAGNOSIS: The stored password does NOT match 'admin123'. You need to reset it.")

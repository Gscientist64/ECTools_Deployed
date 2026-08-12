# backend/config.py
import os
import sys
from dotenv import load_dotenv

def _find_env_path() -> str:
    """
    Dev: backend/.env
    PyInstaller EXE: look next to the executable first, then inside _MEIPASS (if bundled)
    """
    # If running as a bundled EXE, prefer the folder containing the exe
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        p1 = os.path.join(exe_dir, ".env")
        if os.path.isfile(p1):
            return p1

        # If bundled as data into _MEIPASS
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            p2 = os.path.join(meipass, ".env")
            if os.path.isfile(p2):
                return p2

        # last resort: current working dir
        p3 = os.path.join(os.getcwd(), ".env")
        return p3

    # Normal python run: backend/.env
    return os.path.join(os.path.dirname(__file__), ".env")


load_dotenv(dotenv_path=_find_env_path(), override=False)


def _normalize_db_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("postgres://"):
        url = "postgresql+psycopg2://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me")

    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL environment variable is required and cannot be empty.")

    SQLALCHEMY_DATABASE_URI = _normalize_db_url(DATABASE_URL)
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Aiven free tier allows ~25 total connections (system overhead uses ~5).
    # Keep pool_size + max_overflow well under 20 so concurrent users don't exhaust the limit.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping":  True,   # test connections before use to catch dead ones early
        "pool_recycle":   180,    # recycle connections every 3 min (Aiven drops idle after ~5 min)
        "pool_size":      5,      # keep 5 persistent connections in the pool
        "max_overflow":   10,     # allow up to 10 extra burst connections (15 total max)
        "pool_timeout":   10,     # fail fast if no connection available after 10s
        "echo_pool":      False,
    }

    FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

    # SMTP for email notifications
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM = os.getenv("SMTP_FROM", "noreply@ecews.org")

    # Resend HTTP email API (preferred over SMTP when a key is set)
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    RESEND_FROM = os.getenv("RESEND_FROM", "TIMS <onboarding@resend.dev>")

    if os.getenv("PRODUCTION", "0") == "1":
        SESSION_COOKIE_SAMESITE = "None"
        SESSION_COOKIE_SECURE = True
    else:
        SESSION_COOKIE_SAMESITE = "Lax"
        SESSION_COOKIE_SECURE = False

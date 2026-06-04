# backend/app.py
import os
import sys
import threading
import time
import webbrowser
from datetime import datetime
from flask import Flask, send_from_directory, abort, jsonify, redirect, url_for, request
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, current_user, login_required, login_user, logout_user
from sqlalchemy.orm import joinedload
from flask_cors import CORS

from extensions import db, migrate
from models import Users, Request, Tool, ToolCategory, RequestedTool, ToolUsage
from config import Config
from api import api_bp


def _resolve_dist_folder() -> str:
    """
    Find the React build folder both in dev and in the frozen .exe.
    - Dev/normal: ../frontend/dist
    - Frozen (.exe): inside sys._MEIPASS at frontend/dist (because of --add-data)
    """
    if hasattr(sys, "_MEIPASS"):  # running from a frozen bundle
        return os.path.join(sys._MEIPASS, "frontend", "dist")
    here = os.path.dirname(__file__)
    return os.path.abspath(os.path.join(here, "..", "frontend", "dist"))


def create_app():
    DIST_FOLDER = _resolve_dist_folder()

    # IMPORTANT: use /static so top-level routes like /__routes aren't shadowed
    app = Flask(__name__, static_folder=DIST_FOLDER, static_url_path="/static")
    app.config.from_object(Config)
    app.config.setdefault("SESSION_COOKIE_SAMESITE", "Lax")
    app.config.setdefault("SESSION_COOKIE_SECURE", False)
    app.config.setdefault("REMEMBER_COOKIE_SAMESITE", "Lax")
    app.config.setdefault("REMEMBER_COOKIE_SECURE", False)
    app.config.setdefault("SESSION_COOKIE_HTTPONLY", True)

    # --- Extensions ---
    db.init_app(app)
    migrate.init_app(app, db)

    # CORS not needed when same-origin; enable only if you dev with Vite on 5173
    is_dev = os.getenv("FLASK_ENV") == "development" or os.getenv("ALLOW_DEV_CORS", "0") == "1"

    if is_dev:
        CORS(
            app,
            resources={r"/api/*": {
                "origins": [
                    getattr(Config, "FRONTEND_ORIGIN", "http://localhost:5173"),
                    "http://localhost:5173",
                    "http://127.0.0.1:5173",
                ],
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "Authorization"],
                "supports_credentials": True,
            }}
        )

    # --- Login manager ---
    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'login'

    @login_manager.user_loader
    def load_user(user_id):
        return Users.query.get(int(user_id))

    @login_manager.unauthorized_handler
    def _unauthorized():
        if request.path.startswith('/api/'):
            return jsonify({"error": "Unauthorized"}), 401
        return redirect(url_for('login'))

    # --- One-time DB setup / seeding ---
    with app.app_context():
        db.create_all()
        default_categories = ["Office Supplies", "Cleaning", "Furniture"]
        for name in default_categories:
            if not ToolCategory.query.filter_by(name=name).first():
                db.session.add(ToolCategory(name=name))
        db.session.commit()

    # --- API under /api ---
    app.register_blueprint(api_bp, url_prefix="/api")

    # --- Helpers for SPA ---
    def _dist_exists() -> bool:
        index_path = os.path.join(DIST_FOLDER, "index.html")
        return os.path.isdir(DIST_FOLDER) and os.path.isfile(index_path)

    @app.get("/__routes")
    def __routes():
        return {"routes": sorted(str(r) for r in app.url_map.iter_rules())}, 200

    @app.get("/__dbinfo")
    def __dbinfo():
        from sqlalchemy.engine.url import make_url
        uri = app.config.get("SQLALCHEMY_DATABASE_URI", "")
        try:
            url = make_url(uri)
            masked = str(url).replace(url.password or "", "*****") if url.password else str(url)
        except Exception:
            masked = uri
        return {"db": masked}, 200

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_spa(path: str):
        # Don’t let the SPA claim API routes
        if path.startswith("api/"):
            abort(404)

        if not _dist_exists():
            return (
                "Frontend build not found. Run:\n"
                "  cd ../frontend\n"
                "  npm install\n"
                "  npm run build\n",
                500,
                {"Content-Type": "text/plain; charset=utf-8"},
            )

        # Serve existing files directly from the dist folder
        absolute_target = os.path.join(DIST_FOLDER, path)
        if path and os.path.exists(absolute_target) and os.path.isfile(absolute_target):
            return send_from_directory(DIST_FOLDER, path)

        # SPA fallback => index.html
        return send_from_directory(DIST_FOLDER, "index.html")

    return app


def _open_browser_when_ready(url: str, tries: int = 25, delay: float = 0.2):
    """Optional: open the browser after the server starts (useful for .exe with no console)."""
    import socket
    host, port = "127.0.0.1", 5000
    for _ in range(tries):
        s = socket.socket()
        try:
            s.settimeout(0.2)
            s.connect((host, port))
            s.close()
            webbrowser.open(url)
            return
        except Exception:
            time.sleep(delay)


if __name__ == "__main__":
    import threading, time, webbrowser, socket

    def wait_then_open():
        host, port = "127.0.0.1", 5000
        for _ in range(50):
            try:
                with socket.create_connection((host, port), timeout=0.3):
                    break
            except OSError:
                time.sleep(0.2)
        print(f"[INFO] Opening browser at http://{host}:{port}")
        try:
            webbrowser.open(f"http://{host}:{port}")
        except Exception as e:
            print(f"[WARN] Could not open browser automatically: {e}")

    print("[INFO] Starting EC Tools server…")
    print("[INFO] If a Windows Firewall prompt appears, click Allow.")
    print("[INFO] Frontend build should be at ../frontend/dist (index.html must exist).")
    print("[INFO] Then app will open at http://127.0.0.1:5000")

    from waitress import serve  # pip install waitress
    app = create_app()

    # Auto-open browser so you see it immediately:
    threading.Thread(target=wait_then_open, daemon=True).start()

    try:
        serve(app, host="127.0.0.1", port=5000)
    except OSError as e:
        print(f"[ERROR] Could not bind to 127.0.0.1:5000: {e}")
        print("[HINT] Another program might be using port 5000.")
        raise

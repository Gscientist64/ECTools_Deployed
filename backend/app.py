# backend/app.py
import os
import sys
import threading
import time
import logging
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


def _setup_file_logging(app):
    """Write logs to a file so the windowed .exe (no console) is diagnosable."""
    try:
        log_dir = os.path.join(
            os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "TIMS"
        )
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "tims.log")
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root = logging.getLogger()
        if not any(isinstance(h, logging.FileHandler) for h in root.handlers):
            root.addHandler(handler)
        root.setLevel(logging.INFO)
        app.logger.info("=== TIMS app started (log: %s) ===", log_path)
    except Exception:
        pass


def create_app():
    DIST_FOLDER = _resolve_dist_folder()

    # IMPORTANT: use /static so top-level routes like /__routes aren't shadowed
    app = Flask(__name__, static_folder=DIST_FOLDER, static_url_path="/static")
    _setup_file_logging(app)
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
        db.session.commit()

    # --- API under /api ---
    app.register_blueprint(api_bp, url_prefix="/api")

    # --- Global DB error handler ---
    # Catches connection-pool exhaustion and dead-connection errors so users get
    # a readable 503 instead of a raw 500 when the free-tier DB is under load.
    from sqlalchemy.exc import OperationalError, TimeoutError as SATimeoutError
    @app.errorhandler(OperationalError)
    def handle_db_operational(e):
        return jsonify({"error": "Database temporarily unavailable. Please try again in a few seconds."}), 503

    @app.errorhandler(SATimeoutError)
    def handle_db_timeout(e):
        return jsonify({"error": "Server is busy. Please try again in a few seconds."}), 503

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

    @app.route("/", defaults={"path": ""}, methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
    @app.route("/<path:path>", methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
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


if __name__ == "__main__":
    import socket
    import threading
    import time
    import webbrowser
    import sys

    def _msgbox(title, msg):
        """Show a Windows popup when there is no console window."""
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, str(msg), str(title), 0x10)
        except Exception:
            pass  # non-Windows or ctypes unavailable

    try:
        app = create_app()
    except Exception as exc:
        _msgbox(
            "EC Tools — Startup Error",
            f"The application could not start:\n\n{exc}\n\n"
            "Please check your internet connection and try again."
        )
        sys.exit(1)

    # Bind to ANY free local port (let the OS pick one) so the app never fails
    # because another service is already using port 5000/5001/… — the frontend
    # uses relative API URLs, so it works on whatever port waitress binds.
    from waitress.server import create_server
    try:
        server = create_server(app, host="127.0.0.1", port=0, threads=12)
        PORT = int(getattr(server, "effective_port", 0) or 0)
    except Exception as exc:
        _msgbox("EC Tools — Cannot Start", f"Could not start the local server:\n\n{exc}")
        sys.exit(1)

    if not PORT:
        _msgbox("EC Tools — Cannot Start", "Could not reserve a local port for the application.")
        sys.exit(1)

    URL = f"http://127.0.0.1:{PORT}"

    def _open_when_ready():
        time.sleep(1.0)  # give waitress a moment to start accepting requests
        for _ in range(60):
            try:
                with socket.create_connection(("127.0.0.1", PORT), timeout=0.3):
                    break
            except OSError:
                time.sleep(0.2)
        webbrowser.open(URL)

    threading.Thread(target=_open_when_ready, daemon=True).start()

    try:
        server.run()
    except Exception as exc:
        _msgbox("EC Tools — Server Error", str(exc))
        sys.exit(1)

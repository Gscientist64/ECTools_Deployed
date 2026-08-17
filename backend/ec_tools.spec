# ec_tools.spec  — PyInstaller build for EC Tools (Flask + React, onefile)

import os
import sys
from PyInstaller.utils.hooks import collect_submodules, collect_all

spec_dir     = os.path.dirname(os.path.abspath(SPEC))
project_root = os.path.abspath(os.path.join(spec_dir, ".."))
backend_dir  = spec_dir
app_entry    = os.path.join(backend_dir, "app.py")
frontend_dist = os.path.join(project_root, "frontend", "dist")
env_file     = os.path.join(backend_dir, ".env")
icon_file    = os.path.join(backend_dir, "ecews.ico")

# ── Collect full dependency trees ────────────────────────────────────────────

psycopg2_d,  psycopg2_b,  psycopg2_h  = collect_all("psycopg2")
sqlalchemy_d, sqlalchemy_b, sqlalchemy_h = collect_all("sqlalchemy")
flask_d,     flask_b,     flask_h     = collect_all("flask")
alembic_d,   alembic_b,   alembic_h   = collect_all("alembic")

hiddenimports = (
    psycopg2_h + sqlalchemy_h + flask_h + alembic_h
    + collect_submodules("flask_sqlalchemy")
    + collect_submodules("flask_login")
    + collect_submodules("flask_migrate")
    + collect_submodules("flask_cors")
    + collect_submodules("waitress")
    + collect_submodules("pandas")
    + collect_submodules("openpyxl")
    + collect_submodules("dotenv")
    + [
        # SQLAlchemy dialects we actually use
        "sqlalchemy.dialects.postgresql",
        "sqlalchemy.dialects.postgresql.psycopg2",
        # common runtime needs
        "pkg_resources.py2_warn",
        "email.mime.text",
        "email.mime.multipart",
    ]
)

all_datas = [
    (frontend_dist, "frontend/dist"),   # React build
    *psycopg2_d,
    *sqlalchemy_d,
    *flask_d,
    *alembic_d,
]

# Bundle .env so the exe is self-contained (DB creds embedded at _MEIPASS root)
if os.path.isfile(env_file):
    all_datas.append((env_file, "."))

all_binaries = psycopg2_b + sqlalchemy_b + flask_b + alembic_b

# ── Bundle base Python DLLs (venv builds miss _ctypes, _lzma, etc.) ──────────
base_prefix = getattr(sys, 'base_prefix', sys.prefix)
base_dlls_dir = os.path.join(base_prefix, "DLLs")
lib_bin_dir = os.path.join(base_prefix, "Library", "bin")

# Add .pyd files from base DLLs/ (the extension modules themselves)
if os.path.isdir(base_dlls_dir):
    for entry in os.listdir(base_dlls_dir):
        if entry.endswith(('.dll', '.pyd')):
            all_binaries.append((os.path.join(base_dlls_dir, entry), '.'))

# Add dependency DLLs from Library/bin/ (ffi.dll, liblzma.dll, sqlite3.dll, etc.)
if os.path.isdir(lib_bin_dir):
    needed = {'ffi.dll', 'liblzma.dll', 'sqlite3.dll', 'libexpat.dll',
              'libmpdec-4.dll', 'libffi-8.dll', 'LIBBZ2.dll'}
    for entry in os.listdir(lib_bin_dir):
        if entry.lower() in needed:
            all_binaries.append((os.path.join(lib_bin_dir, entry), '.'))

# ── Analysis ─────────────────────────────────────────────────────────────────

a = Analysis(
    [app_entry],
    pathex=[backend_dir],
    binaries=all_binaries,
    datas=all_datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # trim size — not used
        "tkinter", "matplotlib", "scipy", "sklearn",
        "IPython", "notebook", "jupyter",
        "numba", "llvmlite", "sphinx", "docutils",
        "botocore", "boto3", "tables", "pyarrow",
        "babel", "pytest", "hypothesis", "sympy",
        "PIL.ImageQt", "PIL.ImageTk",
        "pandas.tests",  # strip all pandas test modules
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="EC_Tools",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=False,          # no CMD window — errors shown via MessageBox
    icon=icon_file if os.path.isfile(icon_file) else None,
    onefile=True,
    uac_admin=False,        # does not need admin rights
    version_file=None,
)

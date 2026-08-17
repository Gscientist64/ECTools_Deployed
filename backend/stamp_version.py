"""Stamp the publisher/version resource onto the built EC_Tools.exe.

PyInstaller's in-spec `version_file` hook is not reliable in the installed
version, so we stamp the resource AFTER the build. Run after PyInstaller:

    cd backend
    python stamp_version.py          # stamps backend\\dist\\EC_Tools.exe

Then optionally sign:  .\\sign_exe.ps1
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PyInstaller.utils.win32.versioninfo import (  # noqa: E402
    load_version_info_from_text_file,
    write_version_info_to_executable,
)

HERE = os.path.dirname(os.path.abspath(__file__))
EXE = os.path.join(HERE, "dist", "EC_Tools.exe")
VERSION_FILE = os.path.join(HERE, "file_version_info.txt")


def main():
    if not os.path.isfile(EXE):
        print(f"ERROR: {EXE} not found. Build first (pyinstaller ec_tools.spec).")
        return 1
    vi = load_version_info_from_text_file(VERSION_FILE)
    write_version_info_to_executable(EXE, vi)
    print(f"Stamped version/publisher resource on {EXE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# v1.0.12 — Updates Always Apply Now

## 🐛 Fix
- **Updates now always take effect.** Some users' apps were installed in a folder the app can't write to (e.g. `Program Files`), so the update was downloaded but **never replaced the old app** — it kept showing the previous version and prompting again.
- The updater now **detects this automatically** and, when the app folder can't be written to, it **installs the new version into your user folder** (`%LOCALAPPDATA%\TIMS\`) and updates your desktop / Start-menu shortcut to point there.
- Also keeps all the reliability fixes from **v1.0.11** (waits for Windows security, kills lingering instances, auto-retries the relaunch).

## 📋 What's included
- Everything from **v1.0.10** (Tools Utilization, email resend, S.I. approved quantities, and more) is included.
- No new features — this release makes sure every user actually gets the update.

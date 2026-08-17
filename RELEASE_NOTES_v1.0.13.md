# v1.0.13 — Fixes "App deleted by antivirus" & "port 5000 in use"

## 🐛 Fixes

- **No more "port 5000 is in use":** The app now automatically uses **any free port** on the computer (it asks Windows for one), so it can always start even when other software is using port 5000. The window always opens correctly.

- **Less likely to be flagged/deleted by antivirus:** The app now carries **real publisher & version information** (ECEWS), and no longer uses UPX compression (which antivirus often flags).

## 📋 Important for IT / Admin

The **permanent** fix for Windows Defender deleting the app is **code-signing** the EXE (standard for all Windows software). We've prepared everything you need:

- `backend\sign_exe.ps1` — signs the EXE with your code-signing certificate (one command).
- `CODE_SIGNING.md` — step-by-step: get a certificate, sign, and submit the signed EXE to **VirusTotal + Microsoft** so Defender trusts it permanently.

Please read `CODE_SIGNING.md` and sign the next release with a real certificate. Until then, this release already embeds proper publisher metadata, which reduces false positives.

## 📋 What's included
- Everything from v1.0.10–v1.0.12 (Tools Utilization, email resend, S.I. approved quantities, reliable auto-update that installs to your user folder, and more).

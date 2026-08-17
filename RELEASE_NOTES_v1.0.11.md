# v1.0.11 — Auto-Update Reliability

## 🐛 Fix
- **Auto-update made more reliable:** When the app updates itself, it now:
  - waits for Windows security to finish scanning before relaunching,
  - removes any "downloaded from internet" block on the new file,
  - makes sure the old app is fully closed before replacing it,
  - and **retries the relaunch automatically** if the app doesn't start on the first attempt.

This fixes the "Failed to load Python DLL" error some users saw after updating.

## 📋 What's included
- Everything from **v1.0.10** (Tools Utilization, email resend, S.I. approved quantities, and more) is still included.
- No new features in this release — just a smoother, more reliable update experience.

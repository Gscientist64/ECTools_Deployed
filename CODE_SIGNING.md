# Permanent fixes: Antivirus deletion & port 5000 conflicts

This document explains the two problems reported by facility users and the
**permanent** solutions.

---

## 1) Windows Defender / antivirus deletes the app

### Why it happens
`EC_Tools.exe` is a **PyInstaller one-file executable that is NOT code-signed**.
Windows Defender (and other antivirus) frequently flags unsigned Python/PyInstaller
apps as suspicious because:

- they have **no digital signature / unknown publisher**,
- the one-file runtime **extracts itself to a temp folder at launch** (a pattern
  malware also uses),
- after a few days, Defender's *cloud-delivered protection* re-scans the file and
  can quarantine/delete it (the "deleted after some days" behaviour).

### The permanent fix (3 steps)

#### Step 1 — Get a code-signing certificate
Buy an **OV or EV code-signing certificate** from a reputable CA (e.g. DigiCert,
Sectigo, SSL.com, GlobalSign). EV is best (higher trust, less flagging).
*Note: a certificate is a yearly cost — this is the standard, industry-wide fix
for exactly this problem.*

#### Step 2 — Sign the EXE during the build
Run this after building with PyInstaller:

```powershell
cd backend
.\sign_exe.ps1 -Exe dist\EC_Tools.exe -CertThumbprint "<your-cert-sha1>"
# or, with a .pfx file:
.\sign_exe.ps1 -Exe dist\EC_Tools.exe -CertFile mycert.pfx -CertPassword "***"
```

`signtool` must be installed (Windows SDK / Visual Studio Build Tools). The
script signs with SHA-256 + timestamping and verifies the signature.

#### Step 3 — Build reputation (free, do this once per release)
Even after signing, new files need reputation. Upload the **signed** exe to:

1. **VirusTotal** – https://www.virustotal.com  (scan the signed exe)
2. **Microsoft Security Intelligence** – https://www.microsoft.com/wdsi/filesubmission
   (submit the signed exe so Defender whitelists it)

After a short reputation period, Defender will trust the signed, well-known file.

### Also done in this release (reduces false positives)
- The EXE now embeds real **publisher/version metadata** (company = ECEWS, product
  name, description, version) via `backend/file_version_info.txt`.
- **UPX compression is disabled** (`upx=False`) — UPX-packed files are flagged far
  more often by antivirus.

### Optional mitigation for IT (for facility machines)
If you manage facility PCs, push a Defender exclusion for the app folder via Group
Policy / Intune (does not apply to the user's machine):

```powershell
Add-MpPreference -ExclusionPath "C:\<app install folder>"
```

> We intentionally do NOT have the app silently disable Windows Defender — that
> would itself be seen as malicious. Use a signed exe + reputation instead.

---

## 2) "Port 5000 is in use" — app can't start

### Why it happens
The app used to try fixed ports `5000–5009`. On some facility machines another
service already occupies those ports, so the app failed to start.

### The permanent fix (already implemented in this release)
The app now binds to **ANY free local port** — it asks the OS for a free port
(`port=0`) instead of guessing. The browser window always opens on the correct
port and the API uses relative URLs, so everything works no matter which port is
assigned.

No facility user will ever see "port 5000 in use" again.

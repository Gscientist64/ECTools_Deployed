# v1.0.10 — Tools Utilization, Email Resend & More

## 🚀 New Features

- **Tools Utilization (all users):** New "Tools Utilization" page comparing what each facility was **given** vs what they **used** (from RADET / HTS / PrEP program reports), flagging facilities under **70%** as under-utilized. Admins can upload the monthly reports and view **state-wide** utilization with a date range (State tab) plus a **per-facility** drill-down (Facilities tab).
- **Clickable State cards:** On the admin State tab, click any tool card to see the facilities and their individual utilization (given, used, %) that make up the state total.
- **Booklets & sheets shown:** Stat cards now display both units, e.g. **"68 booklets (6,800 sheets)"**, so quantities are easy to understand.
- **Admin email resend:** When a supervisor / S.I. notification email fails, admins see a **red "email failed"** indicator and can **resend** it. All email deliveries are now logged.
- **State-stock request prompts:** Users are warned (and blocked where needed) when the requested tool is out of stock or short at the state level.
- **S.I. Management approved quantities:** S.I. reviewers can set a per-tool **approved quantity** on approval; admins can edit both the **requested** and **approved** quantities on any request.
- **Admin reminder every 60 minutes:** The pending-request notification for admins now reminds **once an hour** (was every 15 minutes).

## 🐛 Bug Fixes & Improvements

- **Auto-update fixed:** Reliable progress bar, green **"Update Successful"** confirmation, and dependable automatic restart after updating.
- **State utilization count fixed:** The state "used" now counts **all facilities** in the uploaded reports (e.g. 32,268 pharmacy refills from April 1) instead of only facilities with delivery records.
- **"Given" = approved requests:** A facility counts as having been given a tool the moment admin **approves** it — even if the delivery was never confirmed.
- **Tools Utilization now visible to every user** (previously admin-only).

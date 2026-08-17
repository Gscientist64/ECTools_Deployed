"""Email notification utilities for TIMS (Tools Inventory Management System)."""
import smtplib
import json
import hashlib
import hmac
import os
import time
import logging
import urllib.request
import urllib.error
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import Config
from extensions import db

logger = logging.getLogger("mailer")

# Dedicated secret for approve/reject link signatures. This is intentionally NOT
# tied to SECRET_KEY: the desktop .exe and Render can have different SECRET_KEY
# values, which previously made valid links fail with "Invalid signature".
ACTION_TOKEN_SECRET = os.getenv(
    "ACTION_TOKEN_SECRET", "tims-action-token-v1-2024-shared-secret"
).encode("utf-8")


def _send_via_brevo(to_emails, subject, html_body, text_body):
    """Send email via the Brevo (Sendinblue) HTTP API. Returns True on success.

    Works from any network (including Render) and needs no verified domain —
    only a verified sender email.
    """
    payload = json.dumps({
        "sender": {
            "name": Config.BREVO_SENDER_NAME or "TIMS",
            "email": Config.BREVO_SENDER_EMAIL,
        },
        "to": [{"email": e} for e in to_emails],
        "subject": subject,
        "htmlContent": html_body,
        "textContent": text_body or "",
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=payload,
        method="POST",
        headers={
            "api-key": Config.BREVO_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "TIMS/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status == 201:
            logger.info("Brevo OK: %s", resp.read().decode("utf-8", "ignore")[:120])
            return True
        logger.warning("Brevo returned status %s", resp.status)
        return False


def _send_via_resend(to_emails, subject, html_body, text_body):
    """Send email via the Resend HTTP API. Returns True on success.

    Works from any network (including Render, which blocks SMTP). Uses the
    standard library only so it bundles cleanly into the .exe.
    """
    from_email = Config.RESEND_FROM or "TIMS <onboarding@resend.dev>"
    payload = json.dumps({
        "from": from_email,
        "to": list(to_emails),
        "subject": subject,
        "html": html_body,
        "text": text_body or "",
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {Config.RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "TIMS/1.0 (Resend mailer)",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status == 200:
            body = resp.read().decode("utf-8", "ignore")
            logger.info("Resend OK (%s): %s", resp.status, body[:120])
            return True
        logger.warning("Resend returned status %s", resp.status)
        return False


def send_email(to_emails, subject, html_body, text_body=None):
    """Send email to a list of recipients. Returns True on success.

    Tries the Resend HTTP API first (when configured), then falls back to SMTP.
    """
    if not to_emails:
        return False

    # Plain text alternative (anti-spam: always include text version)
    if not text_body:
        import re
        text_body = re.sub(r'<[^>]+>', '', html_body)
        text_body = re.sub(r'\s+', ' ', text_body).strip()

    # 1. Preferred: Brevo HTTP API (no domain needed, works from .exe and Render)
    if Config.BREVO_API_KEY and Config.BREVO_SENDER_EMAIL:
        try:
            if _send_via_brevo(to_emails, subject, html_body, text_body):
                return True
            logger.warning("Brevo failed — trying next provider")
        except urllib.error.HTTPError as e:
            logger.warning("Brevo HTTP error %s: %s — trying next provider",
                           e.code, e.read().decode("utf-8", "ignore")[:200])
        except Exception as e:
            logger.warning("Brevo exception %s — trying next provider", e)

    # 2. Resend HTTP API (when configured)
    if Config.RESEND_API_KEY:
        try:
            if _send_via_resend(to_emails, subject, html_body, text_body):
                return True
            logger.warning("Resend failed — falling back to SMTP")
        except urllib.error.HTTPError as e:
            logger.warning("Resend HTTP error %s: %s — falling back to SMTP",
                           e.code, e.read().decode("utf-8", "ignore")[:200])
        except Exception as e:
            logger.warning("Resend exception %s — falling back to SMTP", e)

    # 3. Fallback: SMTP
    if not Config.SMTP_USER or not Config.SMTP_PASSWORD:
        logger.warning("SMTP not configured — skipping email")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"TIMS <{Config.SMTP_FROM}>"
    msg["To"] = ", ".join(to_emails)
    msg["Date"] = time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime())
    msg["Message-ID"] = f"<tims-{int(time.time())}-{hashlib.md5(subject.encode()).hexdigest()[:8]}@{Config.SMTP_FROM.split('@')[-1]}>"
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    # Retry up to 3 times (Gmail SMTP occasionally drops connections)
    last_error = None
    for attempt in range(1, 4):
        try:
            if Config.SMTP_PORT == 465:
                # Implicit SSL/TLS on port 465 (works on networks that block 587)
                with smtplib.SMTP_SSL(Config.SMTP_HOST, Config.SMTP_PORT, timeout=15) as server:
                    server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
                    server.sendmail(Config.SMTP_FROM, to_emails, msg.as_string())
            else:
                with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=15) as server:
                    server.starttls()
                    server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
                    server.sendmail(Config.SMTP_FROM, to_emails, msg.as_string())
            logger.info("Email sent to %s recipient(s): %s", len(to_emails), subject)
            return True
        except Exception as e:
            last_error = e
            logger.warning("Attempt %d failed: %s", attempt, e)
            if attempt < 3:
                time.sleep(2)  # brief pause before retry

    logger.error("Failed to send email after 3 attempts: %s", last_error)
    return False


def _make_action_token(request_id, reviewer_email, role, action, expiry=None):
    """Create a time-limited HMAC-signed token for approve/reject actions.
    `expiry` is a unix timestamp; defaults to 7 days from now. Passing the same
    expiry as an existing token reproduces the exact same token (used to recreate
    the sibling approve/reject link from one link)."""
    if expiry is None:
        expiry = int(time.time()) + (7 * 24 * 3600)  # 7 days
    payload = f"{request_id}|{reviewer_email}|{role}|{action}|{expiry}"
    signature = hmac.new(ACTION_TOKEN_SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token = f"{payload}|{signature}"
    return token


def _verify_action_token(token):
    """Verify a supervisor action token. Returns (request_id, email, role, action) or (None, error)."""
    parts = token.split("|")
    if len(parts) != 6:
        return None, "Invalid token format"

    request_id, reviewer_email, role, action, expiry_str, signature = parts
    payload = f"{request_id}|{reviewer_email}|{role}|{action}|{expiry_str}"

    expected_sig = hmac.new(ACTION_TOKEN_SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, signature):
        return None, "Invalid signature"

    if int(expiry_str) < int(time.time()):
        return None, "Token has expired (valid for 7 days)"

    return int(request_id), reviewer_email, role, action


def _esc(text):
    """Escape a value for safe insertion into HTML."""
    if text is None:
        return ""
    return (str(text)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;'))


def _get_server_url():
    import os, socket
    url = (
        os.getenv("SERVER_URL")
        or os.getenv("RENDER_EXTERNAL_URL")
        or f"http://{socket.gethostname()}:5000"
    )
    if not url.startswith("http"):
        url = f"http://{url}"
    return url.rstrip("/")


def _available_stock(facility_name, tool_id, source="facility"):
    """Return available stock for a tool.
    source='facility' -> that facility's stock; source='state' -> central/state stock (Tool.quantity)."""
    if not tool_id:
        return None
    try:
        if source == "state":
            from models import Tool
            t = Tool.query.get(int(tool_id))
            return t.quantity if t is not None else None
        if not facility_name:
            return None
        from models import FacilityStock
        fs = FacilityStock.query.filter_by(facility=facility_name, tool_id=int(tool_id)).first()
        return fs.quantity if fs is not None else None
    except Exception:
        return None


def _render_tools_table(tools_list, facility_name=None, show_stock=True, stock_source="facility"):
    """Render a modern table of requested tools with an Available Stock column.
    stock_source='facility' shows the facility's stock; 'state' shows central state stock.
    If a tool dict carries a 'utilization' dict, a utilization line is shown under its name."""
    stock_col = '<th style="padding:12px 16px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Available</th>' if show_stock else ""
    rows = []
    for t in tools_list:
        name = _esc(t.get("name", "Unknown"))
        qty = t.get("quantity", 0)
        stock = "&mdash;"
        if show_stock:
            st = _available_stock(facility_name, t.get("tool_id"), source=stock_source)
            stock = (str(st) if st is not None else "&mdash;")
        stock_td = f'<td style="padding:12px 16px;text-align:center;color:#64748b;font-size:14px;">{stock}</td>' if show_stock else ""

        name_cell = name
        util = t.get("utilization")
        if util:
            pct = util.get("utilization_pct")
            given = util.get("given")
            achieved = util.get("achieved")
            under = bool(util.get("under_utilized"))
            color = "#b45309" if under else "#047857"
            if util.get("kind") == "form":
                g_text = f"{util.get('given_units', given / 100)} booklets ({given} sheets)"
                a_text = f"{util.get('achieved_units', achieved / 100)} booklets ({achieved} sheets)"
            else:
                g_text = f"{given} cards"
                a_text = f"{achieved} cards"
            note = f"Utilization: {pct}% (used {a_text} of {g_text})"
            if under:
                note += " &mdash; under-utilized"
            name_cell += (
                f'<div style="font-size:11px;color:{color};margin-top:4px;font-weight:600;line-height:1.4;">'
                f"{note}</div>"
            )

        rows.append(
            f"<tr style=\"border-bottom:1px solid #f1f5f9;\">"
            f'<td style="padding:12px 16px;color:#334155;font-size:14px;">{name_cell}</td>'
            f'<td style="padding:12px 16px;text-align:center;color:#334155;font-size:14px;font-weight:600;">{qty}</td>'
            f"{stock_td}"
            "</tr>"
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin:16px 0 24px;">'
        '<thead><tr style="background:#f8fafc;">'
        '<th style="padding:12px 16px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Tool / Item</th>'
        '<th style="padding:12px 16px;text-align:center;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Requested</th>'
        f"{stock_col}"
        '</tr></thead><tbody>'
        f"{''.join(rows)}"
        '</tbody></table>'
    )


def _action_buttons(approve_url, reject_url, approve_label="Approve Request", reject_label="Reject Request"):
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr>'
        f'<td align="center" style="padding:0 6px;"><a href="{approve_url}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:12px;font-weight:600;font-size:14px;">&#10003;&nbsp; {approve_label}</a></td>'
        f'<td align="center" style="padding:0 6px;"><a href="{reject_url}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:12px;font-weight:600;font-size:14px;">&#10007;&nbsp; {reject_label}</a></td>'
        '</tr></table>'
    )


def _base_email_template(title, subtitle, content_html, action_buttons_html=""):
    """Shared modern branded HTML email wrapper."""
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0f172a,#1e3a8a);padding:36px 40px;">
          <div style="font-size:12px;color:#93c5fd;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">ECEWS Tools Inventory</div>
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;line-height:1.3;">{title}</h1>
          <p style="margin:8px 0 0;color:#bfdbfe;font-size:14px;">{subtitle}</p>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          {content_html}
          {action_buttons_html}
        </td></tr>
        <tr><td style="padding:20px 40px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;color:#94a3b8;font-size:12px;line-height:1.6;">
          This is an automated message from the <strong>TIMS</strong> &mdash; Tools Inventory Management System.<br/>
          This link is valid for 7 days and can only be used once.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def notify_facility_supervisor_of_request(request_id, facility_name, requester_name, tools_list, supervisor_email):
    """Send email to facility supervisor with APPROVE/REJECT buttons."""
    if not supervisor_email:
        return False

    from models import SupervisorAction

    approve_token = _make_action_token(request_id, supervisor_email, "facility_supervisor", "approved")
    reject_token = _make_action_token(request_id, supervisor_email, "facility_supervisor", "rejected")

    for token in [approve_token, reject_token]:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        if not SupervisorAction.query.filter_by(token_hash=token_hash).first():
            sa = SupervisorAction(
                request_id=request_id,
                reviewer_email=supervisor_email,
                reviewer_role="facility_supervisor",
                action="pending",
                token_hash=token_hash
            )
            db.session.add(sa)
    db.session.commit()

    server_url = _get_server_url()
    approve_url = f"{server_url}/api/supervisor/action?token={approve_token}"
    reject_url = f"{server_url}/api/supervisor/action?token={reject_token}"

    content = f"""
        <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">
            <strong>{_esc(requester_name)}</strong> from <strong>{_esc(facility_name)}</strong> has submitted a request.
            Please review the items below and approve or reject.
        </p>
        {_render_tools_table(tools_list, facility_name, show_stock=True)}
    """

    html = _base_email_template(
        title="New Request Requires Your Review",
        subtitle=f"Request #{request_id} &mdash; {_esc(facility_name)}",
        content_html=content,
        action_buttons_html=_action_buttons(approve_url, reject_url, "Approve Request", "Reject Request"),
    )

    return send_email([supervisor_email], f"[TIMS] Action Required: Request #{request_id} &mdash; {facility_name}", html)


def notify_si_management_of_request(request_id, facility_name, requester_name, tools_list, supervisor_name):
    """Send email to ALL S.I Management entries after facility supervisor has approved."""
    from models import SystemSetting
    si_entries_setting = SystemSetting.query.filter_by(key="si_management_entries").first()
    entries = []
    if si_entries_setting and si_entries_setting.value:
        try:
            entries = json.loads(si_entries_setting.value)
        except Exception:
            pass
    # Fall back to legacy single email
    if not entries:
        legacy = SystemSetting.query.filter_by(key="si_management_email").first()
        if legacy and legacy.value:
            entries = [{"email": legacy.value.strip(), "name": "S.I Management"}]
    if not entries:
        return False

    # Deduplicate S.I. entries case-insensitively (email addresses are case-insensitive)
    seen = set()
    unique_entries = []
    for entry in entries:
        em = (entry.get("email") or "").strip()
        if not em:
            continue
        key = em.lower()
        if key in seen:
            continue
        seen.add(key)
        unique_entries.append(entry)
    entries = unique_entries

    from models import SupervisorAction

    # Send to each S.I Management entry
    for entry in entries:
        si_email = entry["email"].strip()
        si_name = entry.get("name", "S.I Management")

        approve_token = _make_action_token(request_id, si_email, "si_management", "approved")
        reject_token = _make_action_token(request_id, si_email, "si_management", "rejected")

        for token in [approve_token, reject_token]:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            if not SupervisorAction.query.filter_by(token_hash=token_hash).first():
                sa = SupervisorAction(
                    request_id=request_id,
                    reviewer_email=si_email,
                    reviewer_role="si_management",
                    action="pending",
                    token_hash=token_hash
                )
                db.session.add(sa)

        server_url = _get_server_url()
        approve_url = f"{server_url}/api/supervisor/action?token={approve_token}"
        reject_url = f"{server_url}/api/supervisor/action?token={reject_token}"

        content = f"""
            <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6;">
                A request from <strong>{_esc(requester_name)}</strong> at <strong>{_esc(facility_name)}</strong>
                has been <span style="color:#059669;font-weight:600;">approved</span> by the facility supervisor
                ({_esc(supervisor_name)}). Please review for final sign-off.
            </p>
            <p style="margin:0 0 16px;color:#64748b;font-size:13px;line-height:1.6;">
                On the review page you can adjust the <strong>approved quantity</strong> for each item
                before approving.
            </p>
            {_render_tools_table(tools_list, facility_name, show_stock=True, stock_source="state")}
        """

        html = _base_email_template(
            title="S.I Management Review Required",
            subtitle=f"Request #{request_id} &mdash; Approved by Facility Supervisor",
            content_html=content,
            action_buttons_html=_action_buttons(approve_url, reject_url, "Approve", "Reject"),
        )

        send_email([si_email], f"[TIMS] S.I Review: Request #{request_id} &mdash; {facility_name}", html)

    db.session.commit()
    return True


def get_supervisors_for_facility(facility_name):
    """Collect all supervisor emails for a given facility (case-insensitive dedup)."""
    from models import Users

    emails = []
    seen = set()

    def _add(email):
        if not email:
            return
        norm = email.strip().lower()
        if norm in seen:
            return
        seen.add(norm)
        emails.append(email.strip())

    supervisors = Users.query.filter_by(is_supervisor=True).all()
    for sup in supervisors:
        facilities = json.loads(sup.supervised_facilities or "[]")
        if not facilities or facility_name in facilities:
            _add(sup.email)

    facility_users = Users.query.filter_by(facility=facility_name).all()
    for u in facility_users:
        _add(u.supervisor_email)

    return emails

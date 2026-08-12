"""Email notification utilities for TIMS (Tools Inventory Management System)."""
import smtplib
import json
import hashlib
import hmac
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import Config
from extensions import db


def send_email(to_emails, subject, html_body, text_body=None):
    """Send email to a list of recipients. Returns True on success."""
    if not Config.SMTP_USER or not Config.SMTP_PASSWORD:
        print("[mailer] SMTP not configured — skipping email")
        return False
    if not to_emails:
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"TIMS <{Config.SMTP_FROM}>"
    msg["To"] = ", ".join(to_emails)
    msg["Date"] = time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime())
    msg["Message-ID"] = f"<tims-{int(time.time())}-{hashlib.md5(subject.encode()).hexdigest()[:8]}@{Config.SMTP_FROM.split('@')[-1]}>"

    # Plain text alternative (anti-spam: always include text version)
    if not text_body:
        import re
        text_body = re.sub(r'<[^>]+>', '', html_body)
        text_body = re.sub(r'\s+', ' ', text_body).strip()
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    # Retry up to 3 times (Gmail SMTP occasionally drops connections)
    last_error = None
    for attempt in range(1, 4):
        try:
            with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
                server.sendmail(Config.SMTP_FROM, to_emails, msg.as_string())
            print(f"[mailer] Email sent to {len(to_emails)} recipient(s): {subject}")
            return True
        except Exception as e:
            last_error = e
            print(f"[mailer] Attempt {attempt} failed: {e}")
            if attempt < 3:
                time.sleep(2)  # brief pause before retry

    print(f"[mailer] Failed to send email after 3 attempts: {last_error}")
    return False


def _make_action_token(request_id, reviewer_email, role, action):
    """Create a time-limited HMAC-signed token for approve/reject actions."""
    secret = Config.SECRET_KEY.encode("utf-8") if Config.SECRET_KEY else b"tims-default-secret"
    expiry = int(time.time()) + (7 * 24 * 3600)  # 7 days
    payload = f"{request_id}|{reviewer_email}|{role}|{action}|{expiry}"
    signature = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token = f"{payload}|{signature}"
    return token


def _verify_action_token(token):
    """Verify a supervisor action token. Returns (request_id, email, role, action) or (None, error)."""
    secret = Config.SECRET_KEY.encode("utf-8") if Config.SECRET_KEY else b"tims-default-secret"
    parts = token.split("|")
    if len(parts) != 6:
        return None, "Invalid token format"

    request_id, reviewer_email, role, action, expiry_str, signature = parts
    payload = f"{request_id}|{reviewer_email}|{role}|{action}|{expiry_str}"

    expected_sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, signature):
        return None, "Invalid signature"

    if int(expiry_str) < int(time.time()):
        return None, "Token has expired (valid for 7 days)"

    return int(request_id), reviewer_email, role, action


def _base_email_template(title, subtitle, content_html, action_url=None, action_text=None):
    """Shared branded HTML email wrapper."""
    action_block = ""
    if action_url and action_text:
        action_block = f"""
        <div style="text-align:center;margin:24px 0;">
            <a href="{action_url}" style="display:inline-block;background:#1a237e;color:white;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:600;font-size:15px;">
                {action_text}
            </a>
        </div>
        """

    return f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5;">
    <div style="max-width:560px;margin:20px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <div style="background:linear-gradient(135deg,#1a237e,#283593);padding:28px 32px;">
            <h2 style="color:white;margin:0;font-size:20px;">{title}</h2>
            <p style="color:#c5cae9;margin:8px 0 0;font-size:14px;">{subtitle}</p>
        </div>
        <div style="padding:24px 32px;">
            {content_html}
            {action_block}
            <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">
                This is an automated notification from <strong>TIMS</strong>.<br>
                This link is valid for 7 days and can only be used once.
            </p>
        </div>
    </div>
    </body>
    </html>
    """


def notify_facility_supervisor_of_request(request_id, facility_name, requester_name, tools_list, supervisor_email):
    """Send email to facility supervisor with APPROVE/REJECT buttons."""
    if not supervisor_email:
        return False

    from models import SupervisorAction

    tools_html = "".join(
        f"""<tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">{t['name']}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;">{t['quantity']}</td>
        </tr>"""
        for t in tools_list
    )

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

    import os, socket
    server_url = (
        os.getenv("SERVER_URL")
        or os.getenv("RENDER_EXTERNAL_URL")
        or f"http://{socket.gethostname()}:5000"
    )
    if not server_url.startswith("http"):
        server_url = f"http://{server_url}"

    approve_url = f"{server_url}/api/supervisor/action?token={approve_token}"
    reject_url = f"{server_url}/api/supervisor/action?token={reject_token}"

    content = f"""
        <p style="color:#374151;font-size:15px;line-height:1.6;">
            <strong>{requester_name}</strong> from <strong>{facility_name}</strong> has submitted a request.
            Please review and approve or reject.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <thead>
                <tr style="background:#f3f4f6;">
                    <th style="padding:12px 14px;text-align:left;font-size:13px;color:#6b7280;text-transform:uppercase;">Tool / Item</th>
                    <th style="padding:12px 14px;text-align:center;font-size:13px;color:#6b7280;text-transform:uppercase;">Qty</th>
                </tr>
            </thead>
            <tbody>{tools_html}</tbody>
        </table>
        <div style="display:flex;gap:12px;margin:20px 0;">
            <a href="{approve_url}" style="flex:1;display:block;text-align:center;background:#059669;color:white;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:600;font-size:14px;">
                &#x2705; Approve Request
            </a>
            <a href="{reject_url}" style="flex:1;display:block;text-align:center;background:#dc2626;color:white;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:600;font-size:14px;">
                &#x274C; Reject Request
            </a>
        </div>
    """

    html = _base_email_template(
        title="&#x1F4CB; New Request Requires Your Review",
        subtitle=f"Request #{request_id} &mdash; {facility_name}",
        content_html=content
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

    tools_html = "".join(
        f"""<tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">{t['name']}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;">{t['quantity']}</td>
        </tr>"""
        for t in tools_list
    )

    from models import SupervisorAction
    import os

    # Send to each S.I Management entry
    for entry in entries:
        si_email = entry["email"].strip()
        si_name = entry.get("name", "S.I Management")

        approve_token = _make_action_token(request_id, si_email, "si_management", "approved")
        reject_token = _make_action_token(request_id, si_email, "si_management", "rejected")

        for token in [approve_token, reject_token]:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            sa = SupervisorAction(
                request_id=request_id,
                reviewer_email=si_email,
                reviewer_role="si_management",
                action="pending",
                token_hash=token_hash
            )
            db.session.add(sa)

        import os, socket
        server_url = (
            os.getenv("SERVER_URL")
            or os.getenv("RENDER_EXTERNAL_URL")
            or f"http://{socket.gethostname()}:5000"
        )
        if not server_url.startswith("http"):
            server_url = f"http://{server_url}"
        approve_url = f"{server_url}/api/supervisor/action?token={approve_token}"
        reject_url = f"{server_url}/api/supervisor/action?token={reject_token}"

        content = f"""
            <p style="color:#374151;font-size:15px;line-height:1.6;">
                A request from <strong>{requester_name}</strong> at <strong>{facility_name}</strong>
                has been <span style="color:#059669;font-weight:600;">approved</span> by the facility supervisor
                ({supervisor_name}). Please review for final sign-off.
            </p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <thead>
                    <tr style="background:#f3f4f6;">
                        <th style="padding:12px 14px;text-align:left;font-size:13px;color:#6b7280;">Tool / Item</th>
                        <th style="padding:12px 14px;text-align:center;font-size:13px;color:#6b7280;">Qty</th>
                    </tr>
                </thead>
                <tbody>{tools_html}</tbody>
            </table>
            <div style="display:flex;gap:12px;margin:20px 0;">
                <a href="{approve_url}" style="flex:1;display:block;text-align:center;background:#059669;color:white;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:600;font-size:14px;">
                    &#x2705; Approve
                </a>
                <a href="{reject_url}" style="flex:1;display:block;text-align:center;background:#dc2626;color:white;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:600;font-size:14px;">
                    &#x274C; Reject
                </a>
            </div>
        """

        html = _base_email_template(
            title="&#x1F50D; S.I Management Review Required",
            subtitle=f"Request #{request_id} &mdash; Approved by Facility Supervisor",
            content_html=content
        )

        send_email([si_email], f"[TIMS] S.I Review: Request #{request_id} &mdash; {facility_name}", html)

    db.session.commit()
    return True


def get_supervisors_for_facility(facility_name):
    """Collect all supervisor emails for a given facility."""
    from models import Users

    emails = []

    supervisors = Users.query.filter_by(is_supervisor=True).all()
    for sup in supervisors:
        facilities = json.loads(sup.supervised_facilities or "[]")
        if not facilities or facility_name in facilities:
            if sup.email:
                emails.append(sup.email)

    facility_users = Users.query.filter_by(facility=facility_name).all()
    for u in facility_users:
        if u.supervisor_email and u.supervisor_email not in emails:
            emails.append(u.supervisor_email)

    return list(set(emails))

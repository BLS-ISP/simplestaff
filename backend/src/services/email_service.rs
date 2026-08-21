//! Email service — handles asynchronous transactional emails via SMTP (Lettre)
//! with fallback to logging when SMTP is unconfigured.

use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use tracing::{error, info};

use crate::config::Config;

/// Base HTML wrapper for branded SimpleStaff notification emails
fn wrap_html(title: &str, content_html: &str, app_url: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }}
    .card {{ background-color: #ffffff; max-width: 560px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }}
    .header {{ background: linear-gradient(135deg, #6d28d9 0%, #4338ca 100%); padding: 24px; color: #ffffff; text-align: center; }}
    .header h1 {{ margin: 0; font-size: 22px; font-weight: 800; }}
    .body {{ padding: 28px; line-height: 1.5; font-size: 15px; }}
    .btn {{ display: inline-block; background: #6d28d9; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 18px; }}
    .footer {{ padding: 18px; background-color: #f1f5f9; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }}
    .badge {{ display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 700; }}
    .badge-approved {{ background: #d1fae5; color: #065f46; }}
    .badge-rejected {{ background: #fee2e2; color: #991b1b; }}
    .badge-pending {{ background: #fef3c7; color: #92400e; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>SimpleStaff</h1>
    </div>
    <div class="body">
      {content_html}
      <div style="text-align: center; margin-top: 24px;">
        <a href="{app_url}" class="btn">Im SimpleStaff Portal öffnen &rarr;</a>
      </div>
    </div>
    <div class="footer">
      Dies ist eine automatische Benachrichtigung von SimpleStaff.<br>
      &copy; 2026 SimpleStaff &bull; BLS-ISP Solutions
    </div>
  </div>
</body>
</html>"#
    )
}

/// Send a raw email via SMTP asynchronously.
pub async fn send_email(
    config: &Config,
    to: &str,
    subject: &str,
    html_body: &str,
) -> Result<(), String> {
    if !config.smtp_enabled {
        info!(
            "SMTP disabled in config. Skipping email to '{}' [Subject: '{}']",
            to, subject
        );
        return Ok(());
    }

    let host = match &config.smtp_host {
        Some(h) if !h.trim().is_empty() => h.clone(),
        _ => {
            info!("No SMTP_HOST configured. Skipping email to '{}' [Subject: '{}']", to, subject);
            return Ok(());
        }
    };

    let raw_from = config
        .smtp_from
        .as_deref()
        .unwrap_or("")
        .trim();

    let user_email = config
        .smtp_user
        .as_deref()
        .unwrap_or("")
        .trim();

    let from_formatted = if raw_from.contains('@') {
        raw_from.to_string()
    } else if !raw_from.is_empty() && user_email.contains('@') {
        format!("{raw_from} <{user_email}>")
    } else if user_email.contains('@') {
        format!("SimpleStaff <{user_email}>")
    } else {
        "SimpleStaff <noreply@bls-isp.net>".to_string()
    };

    let email = Message::builder()
        .from(
            from_formatted
                .parse()
                .map_err(|e| format!("Invalid from address '{from_formatted}': {e}"))?,
        )
        .to(to.parse().map_err(|e| format!("Invalid to address '{to}': {e}"))?)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html_body.to_string())
        .map_err(|e| format!("Failed to build email message: {e}"))?;

    let port = config.smtp_port.unwrap_or(587);

    info!(
        "Connecting to SMTP relay at '{}:{}' to send email to '{}'...",
        host, port, to
    );

    let mut transport_builder = if port == 25 {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host).port(port)
    } else {
        use lettre::transport::smtp::client::{Tls, TlsParameters};
        let tls_params = TlsParameters::builder(host.clone())
            .dangerous_accept_invalid_certs(true)
            .dangerous_accept_invalid_hostnames(true)
            .build()
            .map_err(|e| format!("TLS parameter error: {e}"))?;

        if port == 465 {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host)
                .port(port)
                .tls(Tls::Wrapper(tls_params))
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host)
                .port(port)
                .tls(Tls::Required(tls_params))
        }
    };

    if let (Some(user), Some(pass)) = (&config.smtp_user, &config.smtp_password) {
        if !user.trim().is_empty() && !pass.trim().is_empty() {
            transport_builder =
                transport_builder.credentials(Credentials::new(user.clone(), pass.clone()));
        }
    }

    let transport = transport_builder.build();

    match transport.send(email).await {
        Ok(_) => {
            info!("Email successfully delivered to '{}' [Subject: '{}']", to, subject);
            Ok(())
        }
        Err(e) => {
            error!("Failed to send email to '{}' via '{}:{}': {e}", to, host, port);
            Err(e.to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// High-Level Notification Triggers (Spawns in background via tokio::spawn)
// ---------------------------------------------------------------------------

use std::sync::Arc;

/// 1. Notify managers that a new vacation request was submitted.
pub fn notify_vacation_requested(
    config: Arc<Config>,
    manager_emails: Vec<String>,
    employee_name: String,
    start_date: String,
    end_date: String,
    notes: Option<String>,
) {
    tokio::spawn(async move {
        let subject = format!("Neuer Urlaubsantrag von {employee_name} ({start_date} – {end_date})");
        let notes_html = notes
            .map(|n| format!("<p><strong>Notiz:</strong> {}</p>", n))
            .unwrap_or_default();

        let content = format!(
            r#"<h2 style="margin-top:0; color:#0f172a;">Neuer Urlaubsantrag zur Prüfung</h2>
            <p><strong>{employee_name}</strong> hat einen neuen Urlaubsantrag eingereicht:</p>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>Zeitraum:</strong> {start_date} bis {end_date}</p>
              <p style="margin:4px 0;"><strong>Status:</strong> <span class="badge badge-pending">Eingereicht</span></p>
              {notes_html}
            </div>
            <p>Bitte öffne das SimpleStaff Portal, um den Antrag zu genehmigen oder abzulehnen.</p>"#
        );

        let html = wrap_html(&subject, &content, &format!("{}/vacations", config.app_base_url));

        for mgr_email in manager_emails {
            let _ = send_email(&config, &mgr_email, &subject, &html).await;
        }
    });
}

/// 2. Notify employee that their vacation request was approved or rejected.
pub fn notify_vacation_decided(
    config: Arc<Config>,
    employee_email: String,
    employee_name: String,
    status: String,
    start_date: String,
    end_date: String,
) {
    tokio::spawn(async move {
        let is_approved = status == "approved";
        let status_de = if is_approved { "genehmigt" } else { "abgelehnt" };
        let badge_class = if is_approved { "badge-approved" } else { "badge-rejected" };

        let subject = format!("Dein Urlaubsantrag ({start_date} – {end_date}) wurde {status_de}");

        let content = format!(
            r#"<h2 style="margin-top:0; color:#0f172a;">Urlaubsantrag {status_de}</h2>
            <p>Hallo {employee_name},</p>
            <p>dein Urlaubsantrag für den Zeitraum <strong>{start_date} bis {end_date}</strong> wurde soeben von deiner Führungskraft bearbeitet:</p>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>Zeitraum:</strong> {start_date} bis {end_date}</p>
              <p style="margin:4px 0;"><strong>Neuer Status:</strong> <span class="badge {badge_class}">{status_de}</span></p>
            </div>
            <p>Den aktuellen Stand deines Urlaubskontos kannst du jederzeit im Mitarbeiterportal einsehen.</p>"#
        );

        let html = wrap_html(&subject, &content, &format!("{}/vacations", config.app_base_url));
        let _ = send_email(&config, &employee_email, &subject, &html).await;
    });
}

/// 3. Notify managers that a shift swap takeover was proposed.
pub fn notify_swap_proposed(
    config: Arc<Config>,
    manager_emails: Vec<String>,
    requesting_emp_name: String,
    backup_emp_name: String,
    shift_date: String,
    shift_name: String,
) {
    tokio::spawn(async move {
        let subject = format!("Schichtübernahme zur Freigabe: {backup_emp_name} für {requesting_emp_name} ({shift_date})");

        let content = format!(
            r#"<h2 style="margin-top:0; color:#0f172a;">Schichtübernahme wartet auf Freigabe</h2>
            <p>In der Schichttauschbörse wurde eine Vertretung gefunden:</p>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>Datum:</strong> {shift_date}</p>
              <p style="margin:4px 0;"><strong>Schicht:</strong> {shift_name}</p>
              <p style="margin:4px 0;"><strong>Ursprünglich eingeteilt:</strong> {requesting_emp_name}</p>
              <p style="margin:4px 0;"><strong>Übernimmt die Schicht:</strong> {backup_emp_name}</p>
            </div>
            <p>Bitte prüfe die Arbeitszeitgesetz-Konformität und gib den Tausch im Portal frei.</p>"#
        );

        let html = wrap_html(&subject, &content, &format!("{}/shift-swaps", config.app_base_url));

        for mgr_email in manager_emails {
            let _ = send_email(&config, &mgr_email, &subject, &html).await;
        }
    });
}

/// 4. Notify both employees that their shift swap was approved or rejected.
pub fn notify_swap_decided(
    config: Arc<Config>,
    recipient_emails: Vec<String>,
    status: String,
    shift_date: String,
    shift_name: String,
) {
    tokio::spawn(async move {
        let is_approved = status == "approved";
        let status_de = if is_approved { "genehmigt" } else { "abgelehnt" };
        let badge_class = if is_approved { "badge-approved" } else { "badge-rejected" };

        let subject = format!("Schichttausch für den {shift_date} ({shift_name}) wurde {status_de}");

        let content = format!(
            r#"<h2 style="margin-top:0; color:#0f172a;">Schichttausch {status_de}</h2>
            <p>Der Tauschantrag für die Schicht <strong>{shift_name}</strong> am <strong>{shift_date}</strong> wurde bearbeitet:</p>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>Datum:</strong> {shift_date}</p>
              <p style="margin:4px 0;"><strong>Schicht:</strong> {shift_name}</p>
              <p style="margin:4px 0;"><strong>Status:</strong> <span class="badge {badge_class}">{status_de}</span></p>
            </div>
            <p>Der Dienstplan und dein Smartphone-Kalender wurden entsprechend aktualisiert.</p>"#
        );

        let html = wrap_html(&subject, &content, &format!("{}/shift-swaps", config.app_base_url));

        for email in recipient_emails {
            let _ = send_email(&config, &email, &subject, &html).await;
        }
    });
}

/// 5. Welcome email when employee login credentials are created.
pub fn notify_welcome_user(
    config: Arc<Config>,
    employee_email: String,
    employee_name: String,
    role: String,
    initial_password: Option<String>,
) {
    tokio::spawn(async move {
        let role_label = match role.as_str() {
            "admin" => "Betriebsleiter / Administrator",
            "planner" => "Schichtleiter / Führungskraft",
            _ => "Mitarbeiter",
        };

        let subject = "Dein Zugang zu SimpleStaff wurde freigeschaltet";

        let pw_info = initial_password
            .map(|p| format!("<p style=\"margin:4px 0;\"><strong>Startpasswort:</strong> <code>{}</code></p>", p))
            .unwrap_or_default();

        let content = format!(
            r#"<h2 style="margin-top:0; color:#0f172a;">Willkommen bei SimpleStaff!</h2>
            <p>Hallo {employee_name},</p>
            <p>dein persönlicher Zugang zur Dienstplan- und Mitarbeiterplattform SimpleStaff wurde freigeschaltet.</p>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>E-Mail / Login:</strong> {employee_email}</p>
              <p style="margin:4px 0;"><strong>Rolle & Berechtigung:</strong> {role_label}</p>
              {pw_info}
            </div>
            <p>Du kannst deine Schichten einsehen, Urlaube beantragen, Schichten mit Kollegen tauschen und deinen Kalender direkt auf deinem Smartphone abonnieren.</p>"#
        );

        let html = wrap_html(&subject, &content, &config.app_base_url);
        let _ = send_email(&config, &employee_email, &subject, &html).await;
    });
}

/// 6. Notification when employee's role is updated by admin.
pub fn notify_role_updated(
    config: Arc<Config>,
    employee_email: String,
    employee_name: String,
    new_role: String,
) {
    tokio::spawn(async move {
        let role_label = match new_role.as_str() {
            "admin" => "Betriebsleiter / Administrator",
            "planner" => "Schichtleiter / Führungskraft",
            _ => "Mitarbeiter (Viewer)",
        };

        let subject = format!("Deine Benutzerrolle wurde auf '{role_label}' aktualisiert");

        let content = format!(
            r#"<h2 style="margin-top:0; color:#0f172a;">Berechtigungsstufe aktualisiert</h2>
            <p>Hallo {employee_name},</p>
            <p>ein Administrator deines Betriebs hat deine Zugriffsrechte in SimpleStaff aktualisiert:</p>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>Neue Rolle:</strong> <span class="badge badge-approved">{role_label}</span></p>
            </div>
            <p>Deine neuen Berechtigungen sind ab sofort bei deiner nächsten Anmeldung aktiv.</p>"#
        );

        let html = wrap_html(&subject, &content, &config.app_base_url);
        let _ = send_email(&config, &employee_email, &subject, &html).await;
    });
}

/// 7. Notification when employee's password is reset / changed by admin.
pub fn notify_password_changed(
    config: Arc<Config>,
    employee_email: String,
    employee_name: String,
    new_password: Option<String>,
) {
    tokio::spawn(async move {
        let subject = "Dein SimpleStaff-Passwort wurde aktualisiert".to_string();

        let pw_info = new_password
            .map(|p| format!("<p style=\"margin:4px 0;\"><strong>Neues Passwort:</strong> <code>{}</code></p>", p))
            .unwrap_or_else(|| "<p style=\"margin:4px 0;\">Das Passwort wurde von der Betriebsleitung zurückgesetzt.</p>".to_string());

        let content = format!(
            r#"<h2 style="margin-top:0; color:#0f172a;">Passwort aktualisiert</h2>
            <p>Hallo {employee_name},</p>
            <p>dein Passwort für den Zugriff auf SimpleStaff wurde soeben aktualisiert:</p>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:14px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>E-Mail / Login:</strong> {employee_email}</p>
              {pw_info}
            </div>
            <p>Bitte melde dich mit den neuen Zugangsdaten an und ändere dein Passwort bei Bedarf im Profil.</p>"#
        );

        let html = wrap_html(&subject, &content, &config.app_base_url);
        let _ = send_email(&config, &employee_email, &subject, &html).await;
    });
}


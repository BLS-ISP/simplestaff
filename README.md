# SimpleStaff

**Intelligente Schichtplanung, Mitarbeiterverwaltung und ArbZG-Compliance-Plattform**

> **Lizenzhinweis:** SimpleStaff ist proprietäre Software der **BLS.ISP**. Die freie Nutzung ist ausgeschlossen. Der Einsatz der Software (Quellcode sowie Container-Images) ist ausschließlich im Rahmen eines gültigen Lizenzvertrags gegenüber der **BLS.ISP** gestattet. Details finden Sie in der Datei [`LICENSE`](./LICENSE).

---

## Überblick

**SimpleStaff** ist eine mandantenfähige Webanwendung zur digitalen Dienst- und Schichtplanung mit integrierter Prüfung nach dem deutschen Arbeitszeitgesetz (**ArbZG**). Die Lösung ist speziell für den Betrieb als Rootless-Container-Modul auf **NethServer 8 (NS8)** sowie für containerisierte Unternehmensumgebungen konzipiert.

### Kernfunktionen

- **Wochen- & Monats-Dienstplanung**
  - Übersichtliche Wochen- und Monatsansichten mit Klick-Zuweisung, **1-Klick-Vorwochenkopie** (`Vorwoche kopieren`), speicherbaren **Wochen-Vorlagen** (`🗂️ Vorlagen`), Live-Stundenauswertung und Druck-/PDF-Ansicht.
  - **Ist-Arbeitszeiterfassung, Lohnbuchhaltungs-CSV & Einzel-Stundenzettel:** Erfassung tatsächlicher Start-/Endzeiten, Pausen und Schichtstatus, detaillierter Monats-Export für die Lohnabrechnung sowie druckfertiger **Monats-Stundenzettel pro Mitarbeiter** (`📄 Stundenzettel (PDF)` gem. § 16 Abs. 2 ArbZG / § 17 MiLoG inkl. Unterschriftsfeldern).
  - **Lese-Ansicht für Mitarbeiter (`viewer`):** Mitarbeiter können den gesamten Team-Dienstplan einsehen, per Schnellfilter auf ihre eigenen Schichten umschalten und ihren eigenen Monats-Stundenzettel abrufen.
  - Automatische Kennzeichnung von genehmigten Urlauben, individuellen Sperrtagen, Betriebsferien und gesetzlichen Feiertagen.
- **Krankmeldung (Einzelschicht & Zeitraum) & Automatische Vertretungssuche**
  - 1-Klick-Krankmeldung direkt im Dienstplan oder als **mehrtägige Krankmeldung (`von – bis`)**: markiert alle betroffenen Schichten im Plan als `🤒 Krank`, nimmt sie aus der aktiven Besetzungszählung und dem Smartphone-Kalender heraus und erstellt automatisch offene Vertretungsgesuche in der Schichttauschbörse.
- **Automatischer Feiertags-Generator (alle 16 Bundesländer)**
  - In den Betriebseinstellungen können alle bundesweiten und landesspezifischen gesetzlichen Feiertage (`BW` bis `TH`, inkl. beweglicher Oster-/Pfingstfeiertage und Buß- und Bettag) für jedes beliebige Jahr per Klick importiert werden.
- **Integrierte ArbZG- & Regelprüfung**
  - Echtzeit-Validierung bei jeder Schichtzuweisung und beim Schichttausch:
    - Mindestruhezeit zwischen zwei Schichten (standardmäßig **11 Stunden** nach § 5 ArbZG, vorwärts- und rückwärtsgerichtet inkl. Nachtschichten).
    - Maximale tägliche Arbeitszeit (z. B. **10 Stunden** nach § 3 ArbZG) unter automatischer Berücksichtigung gestaffelter Pausenregeln (§ 4 ArbZG).
    - Maximale wöchentliche Arbeitszeit (individuelles Wochenstunden-Soll des Mitarbeiters sowie mandantenweite Obergrenze).
    - Prüfung auf genehmigten Urlaub, Sperrtage, Wochentags-Sperrzeiten, Feiertags-Modi und Mindest-/Maximalbesetzung pro Schichttyp.
- **Automatische Dienstplanbesetzung (Auto-Scheduler)**
  - Regelbasierter Greedy-Solver zur automatischen Besetzung offener Schichten (inkl. Nachbesetzung bei Krankmeldungen) für frei wählbare Zukunftszeiträume unter Einhaltung aller ArbZG-Vorgaben, Mitarbeiterpräferenzen und gleichmäßiger Stundenauslastung.
- **Schichttauschbörse, Urlaubsworkflow & Mitarbeiter-Self-Service**
  - Mitarbeiter können eigene Schichten zum Tausch freigeben (offen oder direkt an Kollegen adressiert) und Schichten übernehmen; Schichtleiter können sowohl Vorschläge freigeben als auch offene Vertretungsgesuche **direkt einem Ersatz-Mitarbeiter zuweisen** (inkl. ArbZG-Prüfung und automatischer Rücksetzung des Krank-Status).
  - Digitaler Urlaubsantrag mit Überlappungsschutz, Eigen-Storno für offene Anträge, **feiertagsbereinigter** Werktagsberechnung (Mo–Fr abzüglich gesetzlicher Feiertage/Betriebsschließungen), Resturlaubskonto und E-Mail-Benachrichtigung.
  - Vollständiger **Mitarbeiter-Self-Service** für Wunschfrei/Sperrtage (`📅 Wunschfrei / Sperrtage`), Wochentags-Schichtpräferenzen (`🌟 Schicht-Präferenzen`) und Krankmeldungen (`🤒 Krankmeldung (AU)`).
- **Kalender-Abonnement (iCal / WebCal)**
  - Persönlicher ICS-Download sowie kryptografisch signierte Langzeit-Abo-Links (`webcal://` / `https://`) für die Live-Synchronisation in Apple Kalender, Google Calendar, Outlook und Smartphones.
- **Mandantenfähigkeit (Multi-Tenancy), Sicherheit & Rollenmodell**
  - Strikte Mandantentrennung bis auf Datenbankebene durch PostgreSQL Row-Level Security (`RLS`).
  - Öffentliche Selbstregistrierung standardmäßig deaktiviert (`ALLOW_PUBLIC_REGISTRATION=false`); neue Mandanten werden kontrolliert über das Super-Admin-Panel bereitgestellt.
  - Integrierte Passwort-Selbstverwaltung (`🔑 Passwort ändern`) für alle Benutzerrollen.
  - Vierstufiges Berechtigungskonzept:
    - `super_admin`: Mandantenverwaltung und Festlegung von Mitarbeiter-Kontingenten (`max_employees`).
    - `admin`: Vollzugriff innerhalb des eigenen Betriebs (Mitarbeiter, Konten, Rollen, Arbeitszeitregeln, Dienstpläne).
    - `planner`: Schichtleiter-Zugriff für Dienstpläne, Urlaubsfreigaben und Schichttausch-Genehmigungen.
    - `viewer`: Mitarbeiter-Self-Service (Team-/Eigener Dienstplan im Lesemodus, 7-Tage-Vorschau im Dashboard, Kalender-Abo, Urlaubsanträge, Sperrtage, Schichttauschbörse).

---

## Architektur & Technologie-Stack

| Komponente | Technologie | Beschreibung |
| :--- | :--- | :--- |
| **Backend** (`backend/`) | Rust (Edition 2024), Axum 0.8, SeaORM 1.x, Tokio | REST-API, JWT-Authentifizierung, Argon2-Passwort-Hashing, ArbZG-Validierung, Auto-Scheduler, iCal-Generator, Lettre SMTP-Mailer |
| **Datenbank** | PostgreSQL 15 (Alpine) | Automatische SeaORM-Migrationen beim Start, mandantenweite Isolation über PostgreSQL Row-Level Security (`app.current_tenant`) |
| **Frontend** (`frontend/`) | React 19, TypeScript, Vite, React Router 7, i18next | Single-Page-Application (DE/EN), ausgeliefert über Nginx mit Reverse-Proxy für `/api/*` |
| **NS8-Modul** (`imageroot/`, `ui/`) | Rootless Podman, systemd User-Units, Vue 2 / Carbon UI | Vollständige NethServer-8-Integration inkl. Traefik-Routing (Let's Encrypt), SMTP-Konfiguration, Restic-Backup/Restore und Software-Center-Metadaten |

---

## Installation & Betrieb auf NethServer 8

> **Voraussetzung:** Für die Installation und Nutzung ist ein gültiger Lizenzvertrag mit der **BLS.ISP** erforderlich.

### 1. Über das NethServer 8 Software Center (Empfohlen)

1. Öffnen Sie im NethServer 8 Cluster-Admin die Seite **Einstellungen → Software-Repositorys**.
2. Fügen Sie das SimpleStaff-Repository hinzu:
   - **Name:** `bls-isp`
   - **URL:** `https://raw.githubusercontent.com/BLS-ISP/simplestaff/repomd/`
3. Installieren Sie **SimpleStaff** direkt über das **Software Center** und konfigurieren Sie anschließend in den Modul-Einstellungen den gewünschten Hostnamen (z. B. `time.ihre-domain.de`) sowie optional den SMTP-Versand.
4. Neue Versionen stehen automatisch als reguläres Update im NethServer 8 Software Center bereit.

### 2. Über die Kommandozeile (CLI)

```bash
add-module ghcr.io/bls-isp/ns8-simplestaff:latest 1
```

Zur Aktualisierung einer bestehenden Instanz (z. B. `ns8-simplestaff1`) über die CLI:

```bash
api-cli run update-module --data '{"module_url":"ghcr.io/bls-isp/ns8-simplestaff:1.1.4","instances":["ns8-simplestaff1"],"force":false}'
```

---

## Entwicklung & Lokaler Build

### Lokaler Start mit Docker Compose

```bash
cp .env.example .env   # falls vorhanden, oder Umgebungsvariablen setzen
docker compose up --build -d
```

### Manuelles Prüfen & Bauen

**Backend (Rust):**

```bash
cd backend
cargo test
cargo build --release
```

**Frontend (React / TypeScript):**

```bash
cd frontend
npm ci
npm run build
```

---

## Lizenz & Urheberrecht

**Copyright © 2026 BLS.ISP (BLS-ISP Solutions). Alle Rechte vorbehalten.**

Dieses Projekt unterliegt einer **proprietären Softwarelizenz**. Die freie Nutzung, Vervielfältigung, Modifikation oder Verbreitung ist **nicht gestattet**. Jeglicher Einsatz der Software setzt einen aktiven, schriftlichen Lizenzvertrag gegenüber der **BLS.ISP** voraus.

Den vollständigen Lizenztext finden Sie in der Datei [`LICENSE`](./LICENSE).

### Kontakt für Lizenzanfragen & Support

- **Unternehmen:** BLS.ISP (BLS-ISP Solutions)
- **E-Mail:** [info@bls-isp.net](mailto:info@bls-isp.net)
- **Web / Portal:** [https://time.bls-isp.net](https://time.bls-isp.net)

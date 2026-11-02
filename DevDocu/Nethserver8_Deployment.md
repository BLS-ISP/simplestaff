# NethServer 8 (NS8) – Bereitstellungshandbuch (Deployment Guide)

Dieses Handbuch beschreibt Schritt für Schritt, wie Sie die **SimpleStaff**-Anwendung als natives, rootless Container-Modul inklusive vollwertiger **NethServer 8 Cockpit Admin-Oberfläche** auf Ihrer NethServer 8 Produktivumgebung (z. B. unter **`time.bls-isp.net`**) installieren, konfigurieren und aktualisieren.

---

## 1. Systemarchitektur auf NethServer 8

SimpleStaff wird auf NethServer 8 als **rootless Podman-Pod** (`simplestaff-pod`) betrieben, der lokal auf `127.0.0.1:${TCP_PORT}` gebunden ist:
* **Datenbank (`simplestaff-db`):** PostgreSQL 15 (`docker.io/library/postgres:15-alpine`) mit persistentem Volume unter `~/state/postgres_data` und automatischer `pg_isready`-Readiness-Prüfung vor dem Backend-Start.
* **Backend API (`simplestaff-backend`):** Rust / Axum Server auf Port `8080` mit automatischer Datenbank-Verbindungs-Retry-Logik, SeaORM-Migrationen und automatischer Synchronisation der Super-Admin-Zugangsdaten aus den NS8-Einstellungen.
* **Frontend Proxy (`simplestaff-frontend`):** Nginx Webserver auf Port `80` (liefert das Vue 3 SPA aus und leitet `/api/`-Anfragen intern an `127.0.0.1:8080` weiter).
* **NS8 Cockpit UI (`/ui`):** Native NethServer 8 Carbon-Oberfläche (Status-Dashboard, Domain-/SSL-/Admin-Konfiguration, SMTP-Konfiguration mit Live-Test-E-Mail-Versand).
* **Ingress (Traefik):** Über die NS8-Action `configure-module` wird die Route automatisch bei `traefik@node` registriert (inkl. optionalem Let's Encrypt SSL-Zertifikat und HTTP→HTTPS-Weiterleitung).

---

## 2. GitHub Actions & Container Registry (GHCR)

Der Workflow `.github/workflows/build-and-publish.yml` baut und veröffentlicht bei jedem Push auf `main` oder einem Versions-Tag (`v*`) automatisch alle drei Images:
* **Backend:** `ghcr.io/bls-isp/simplestaff-backend:latest`
* **Frontend:** `ghcr.io/bls-isp/simplestaff-frontend:latest`
* **NS8 Modul-Installer:** `ghcr.io/bls-isp/ns8-simplestaff:latest`

### Authentifizierung auf NethServer 8 (falls Packages privat sind):
1. **GitHub Personal Access Token (PAT) erstellen:** Classic Token mit Scope **`read:packages`**.
2. **Podman auf dem NS8-Host einloggen:**
   ```bash
   podman login --authfile=/etc/nethserver/registry.json ghcr.io
   chmod -c a+rx /etc/nethserver
   chmod -c a+r /etc/nethserver/registry.json
   ```
   > [!WARNING]
   > Nach jedem `podman login` setzt Podman die Berechtigungen von `/etc/nethserver/registry.json` auf `600` zurück. Führen Sie die beiden `chmod`-Befehle nach jedem Login erneut aus.

---

## 3. Installation & Updates über das NethServer 8 Software Center (UI)

### 3.1 Software-Repository in der NS8 UI hinterlegen (Einmalig)
Damit SimpleStaff direkt im **NethServer 8 Software Center** installiert und über **Software Center → Updates** per Klick aktualisiert werden kann:
1. Öffnen Sie das **NethServer 8 Cluster-Admin-Panel**.
2. Navigieren Sie zu **Software center → Settings → Software repositories → Add repository**.
3. Tragen Sie folgende Daten ein:
   * **Name:** `bls-isp-simplestaff`
   * **URL:** `https://raw.githubusercontent.com/BLS-ISP/simplestaff/repomd/`
   * **Status:** Enabled
4. Künftig erscheint jedes neue Release (automatisch bei jedem Push auf `main` als neue SemVer-Version veröffentlicht) direkt unter **Software center → Updates**.

> [!TIP]
> Um den 1-Stunden-Repository-Cache von NethServer 8 sofort zu leeren, damit ein frisch gebautes Update augenblicklich in der UI erscheint:
> ```bash
> redis-cli del cluster/repository_cache/bls-isp-simplestaff
> ```

### 3.2 Bereits mit `:latest` installierte Instanz für UI-Updates freischalten (Einmalig)
Falls Ihre bestehende Instanz (`ns8-simplestaff1`) ursprünglich mit dem `:latest`-Tag installiert wurde, ignoriert das NS8 Software Center diese Instanz bei der Update-Suche, da NS8 für den Versionsvergleich eine echte SemVer-Versionsnummer (`X.Y.Z`) voraussetzt.
Führen Sie **einmalig** folgenden Befehl auf dem NS8-Host aus, um die bestehende Instanz auf die SemVer-Spur umzustellen (alle Daten bleiben vollständig erhalten):

```bash
api-cli run update-module --data '{"module_url":"ghcr.io/bls-isp/ns8-simplestaff:1.1.3","instances":["ns8-simplestaff1"],"force":true}'
```
Ab diesem Zeitpunkt lässt sich die Instanz bei jedem künftigen Release ganz normal in der **NethServer 8 UI unter Software center → Updates** aktualisieren.

### 3.3 Neuinstallation per CLI (Alternativ)
Führen Sie als **root** auf dem NethServer 8 Host folgenden Befehl mit einem SemVer-Tag aus:

```bash
add-module ghcr.io/bls-isp/ns8-simplestaff:1.1.3 1
```

*Was NethServer 8 dabei automatisch ausführt:*
1. Erstellt den rootless Systembenutzer (z. B. `ns8-simplestaff1`).
2. Lädt alle in `org.nethserver.images` definierten Container-Images (`postgres:15-alpine`, `simplestaff-backend`, `simplestaff-frontend`) herunter.
3. Extrahiert `/imageroot` und die Cockpit-UI (`/ui`).
4. Führt `create-module/20initialize` aus (erstellt `~/state/postgres_data` und generiert kryptografische Schlüssel für `DATABASE_PASSWORD` und `JWT_SECRET`).

---

## 4. Konfiguration über die NethServer 8 Cockpit UI (Empfohlen)

1. Öffnen Sie das **NethServer 8 Admin-Panel (Cockpit)** im Browser.
2. Navigieren Sie links zu **Anwendungen** → **SimpleStaff** → **Einstellungen**.
3. Tragen Sie unter **Allgemeine Einstellungen & Zugriff** folgende Werte ein:
   * **Domainname:** z. B. `time.bls-isp.net` (ohne `https://`)
   * **Super-Admin E-Mail:** z. B. `info@bls-isp.net`
   * **Super-Admin Passwort:** Mindestens 6 Zeichen (kann später jederzeit über dieses Feld geändert werden)
   * **Let's Encrypt SSL-Zertifikat** & **HTTP zu HTTPS Weiterleitung**
4. Optional: Aktivieren Sie **E-Mail & Benachrichtigungen (SMTP)**, tragen Sie Ihre SMTP-Zugangsdaten ein und prüfen Sie die Verbindung direkt mit dem Button **„Test-E-Mail senden“** (funktioniert sofort mit den eingegebenen Daten, auch vor dem Speichern).
5. Klicken Sie auf **„Änderungen speichern“**.

### Alternativ: Konfiguration per CLI
```bash
api-cli run configure-module --agent module/ns8-simplestaff1 --data '{
  "domain_name": "time.bls-isp.net",
  "super_admin_email": "info@bls-isp.net",
  "super_admin_password": "IhrSicheresPasswort",
  "lets_encrypt": true,
  "http2https": true,
  "smtp_enabled": false
}'
```

---

## 5. Status prüfen, Updates & Backups

### Status und Logs prüfen:
```bash
# Systemd-Status prüfen
runagent -m ns8-simplestaff1 systemctl --user status simplestaff.service

# Laufende Container im Pod prüfen
runagent -m ns8-simplestaff1 podman ps

# Backend-Logs einsehen
runagent -m ns8-simplestaff1 podman logs --tail 100 simplestaff-backend
```

### Modul auf eine neue Version aktualisieren:
```bash
api-cli run update-module --data '{"module_url":"ghcr.io/bls-isp/ns8-simplestaff:1.1.2","instances":["ns8-simplestaff1"],"force":true}'
```

### Manuelle Datenbanksicherung (SQL-Dump):
```bash
runagent -m ns8-simplestaff1 podman exec simplestaff-db pg_dump -U simplestaff simplestaff > simplestaff_backup_$(date +%F).sql
```

# Nethserver 8 (NS8) – Bereitstellungshandbuch (Deployment Guide)

Dieses Handbuch beschreibt Schritt für Schritt, wie Sie die **SimpleStaff**-Anwendung als natives, rootless Container-Modul auf Ihrer **Nethserver 8 (NS8)** Produktivumgebung unter der Domain **`time.bls-isp.net`** installieren und aktivieren.

---

## 1. Systemarchitektur auf Nethserver 8

SimpleStaff wird auf Nethserver 8 als **Podman-Pod** betrieben. Ein Pod gruppiert Container und teilt sich denselben Netzwerk-Namespace (inkl. `localhost`).
* **Datenbank:** PostgreSQL 15 (Läuft als Container `simplestaff-db`).
* **Backend API:** Axum Rust Server (Läuft als Container `simplestaff-backend` auf Port `8080`).
* **Frontend Proxy:** Nginx Webserver (Läuft als Container `simplestaff-frontend` auf Port `80`).
* **Ingress:** Nethserver 8 Traefik liest die Container-Labels aus, stellt automatisch ein **Let's Encrypt SSL-Zertifikat** aus und leitet den externen Traffic für `time.bls-isp.net` an den Frontend-Container weiter.

---

## 2. GitHub Actions & private Registry (GHCR)

Um das Kompilieren und Bereitstellen der Container-Images zu vereinfachen, nutzt dieses Repository einen GitHub Actions Workflow (`.github/workflows/build-and-publish.yml`).

### Funktionsweise:
1. **Automatischer Build:** Sobald Sie Änderungen in Ihr privates GitHub-Repository auf den Branch `main` pushen, baut GitHub Actions automatisch beide Container-Images (Backend und Frontend) und lädt sie in die **GitHub Container Registry (GHCR)** hoch.
2. **Image-Pfade:**
   * Backend: `ghcr.io/bls-isp/simplestaff-backend:latest`
   * Frontend: `ghcr.io/bls-isp/simplestaff-frontend:latest`

### Authentifizierung auf Nethserver 8:
Da es sich um ein **privates Repository** handelt, müssen Sie dem Nethserver-Host Leserechte auf die Registry gewähren:

1. **GitHub Personal Access Token (PAT) erstellen:**
   * Gehen Sie auf GitHub in Ihre Profileinstellungen -> *Developer Settings* -> *Personal Access Tokens* -> *Tokens (classic)*.
   * Erzeugen Sie einen neuen Token (Klassisch) mit dem Scope **`read:packages`**. Kopieren Sie den Token.

2. **Podman einloggen:**
   * Loggen Sie sich als **root** auf der Nethserver-Konsole ein.
   * Führen Sie den Login-Befehl mit der offiziellen Nethserver-Registry-Konfiguration aus:
     ```bash
     podman login --authfile=/etc/nethserver/registry.json ghcr.io
     # Username: BLS-ISP
     # Password: <Dein GitHub Personal Access Token (PAT)>
     ```

3. **Berechtigungen vergeben (WICHTIG):**
   * Damit der spätere rootless Anwendungsbenutzer die Anmeldeinformationen lesen und die Images herunterladen kann, müssen Sie Leserechte vergeben:
     ```bash
     chmod -c a+rx /etc/nethserver
     chmod -c a+r /etc/nethserver/registry.json
     ```
   * > [!WARNING]
     > **WICHTIGER HINWEIS:** Jedes Mal, wenn Sie `podman login` ausführen, setzt Podman die Dateiberechtigungen von `/etc/nethserver/registry.json` aus Sicherheitsgründen automatisch wieder auf `600` (nur für root lesbar) zurück. Sie **müssen** die `chmod`-Befehle nach jedem Login/Änderung zwingend erneut ausführen!

4. **Vorkonfiguration:**
   * Die Image-Pfade in `/home/simplestaff1/.config/systemd/user/simplestaff.service` sind bereits fest auf Ihre Organisation `bls-isp` vorkonfiguriert. Es ist keine manuelle Pfad-Anpassung nötig.

---

## 3. Modul auf Nethserver 8 installieren (App-Bundle)

Da wir die App-Struktur in ein Container-Bundle verpackt haben, entfällt das manuelle Anlegen von Benutzern oder Kopieren von Dateien komplett. Nethserver 8 erledigt das automatisch über den `add-module`-Agenten.

Führen Sie als **root-Benutzer** auf dem Nethserver-Host folgenden Befehl aus:

```bash
# Modul auf Node 1 aus der GitHub Registry erstellen
add-module ghcr.io/bls-isp/ns8-simplestaff:latest 1
```

*Was Nethserver jetzt im Hintergrund tut:*
* Erstellt den rootless System-User `simplestaff1`.
* Lädt das Scratch-Image `ns8-simplestaff:latest` herunter.
* Extrahiert die `imageroot`-Dateistruktur direkt in das Home-Verzeichnis des Benutzers.
* Registriert die systemd-Dienste und berechtigt die Ausführung.

---

## 4. Konfiguration & Aktivierung

Nach der Installation konfigurieren wir die Umgebungsvariablen (wie Passwörter, Domäne, E-Mail-Adressen). Die Steuerung erfolgt über das Nethserver-Werkzeug `runagent`, welches Befehle sicher im Namespace der App-Instanz ausführt:

1. **Konfigurationsskript ausführen (JSON übergeben):**
   Geben Sie die Ziel-Domain `time.bls-isp.net` und die Admin-Daten an. Sichere Datenbankpasswörter und Verschlüsselungs-Schlüssel werden automatisch erzeugt.
   ```bash
   echo '{"domain_name":"time.bls-isp.net", "super_admin_email":"admin@test.local", "super_admin_password":"admin123"}' | runagent -m simplestaff1 .config/bin/configure-module
   ```

2. **Dienst starten (falls nicht bereits aktiv):**
   ```bash
   runagent -m simplestaff1 systemctl --user enable --now simplestaff.service
   ```

3. **Status und Logs einsehen:**
   ```bash
   # Systemd-Status der App prüfen:
   runagent -m simplestaff1 systemctl --user status simplestaff.service
   
   # Container-Status prüfen:
   runagent -m simplestaff1 podman ps
   ```

4. **SSL & Ingress:**
   Der Nethserver-Traefik-Proxy erkennt die Labels des Containers `simplestaff-frontend` und fordert automatisch ein kostenloses SSL-Zertifikat (Let's Encrypt) für **`https://time.bls-isp.net`** an. Die App ist direkt im Web erreichbar.

---

## 5. Demo-Zugang aktivieren (Postgres Seeding)

Um die Demo-Zugangsdaten (Manager und Mitarbeiter) auf der Loginseite der App freizuschalten, führen Sie das Seeding-Tool im laufenden Backend-Container aus:

```bash
# Seeding-Binary über runagent im Backend-Container starten
runagent -m simplestaff1 podman exec simplestaff-backend /app/seed_demo
```

### Logins auf `time.bls-isp.net`:
* **Manager-Zugang:** `admin@test.local` (Passwort: `admin123`)
* **Mitarbeiter-Zugang:** `peter@test.local` (Passwort: `start123`)

---

## 6. Backups & Modul-Updates

* **Daten-Backup:** Der persistente Zustand (Datenbank-Dateien und Konfigurationsumgebung) liegt im Ordner `/home/simplestaff1/.config/state/`. Dieser wird automatisch durch die Standard-Datensicherung von Nethserver 8 erfasst.
* **Modul aktualisieren:** 
  Wenn Sie Änderungen in GitHub pushen und GitHub Actions neue Images baut, aktualisieren Sie das Modul auf dem Nethserver einfach über:
  ```bash
  runagent -m simplestaff1 .config/update-module.d/10_restart
  ```
  Podman zieht dabei die neuesten Container-Images aus Ihrer privaten GHCR und startet die Dienste neu.


# SimpleStaff – Handbuch für Manager & Planer

Dieses Handbuch führt Sie durch alle administrativen und planerischen Funktionen von **SimpleStaff**. Es hilft Ihnen, Mitarbeiter effizient zu verwalten, rechtskonforme Dienstpläne zu erstellen und Urlaubsanträge sowie Schichttäusche zu steuern.

---

## 1. Dashboard (Übersicht)
Nach dem Login landen Sie auf dem zentralen Dashboard. Hier sehen Sie:
* **Heutige Schichten:** Alle für den heutigen Tag eingeteilten Mitarbeiter im Überblick.
* **Offene Urlaubsanträge:** Anzahl der Anträge, die auf Ihre Freigabe warten.
* **Statistiken:** Aktuelle Auswertungen zu aktiven Mitarbeitern, definierten Schichttypen und Mandanteneinstellungen.

---

## 2. Mitarbeiterverwaltung & Onboarding

### Mitarbeiter anlegen
1. Navigieren Sie zu **Mitarbeiter** in der Sidebar und klicken Sie auf **+ Mitarbeiter hinzufügen**.
2. Tragen Sie Vorname, Nachname, E-Mail-Adresse und wöchentliche Vertragsstunden ein.
3. Klicken Sie auf **Erstellen**.

### 🔑 Login freischalten (Mitarbeiter-Zugang einrichten)
Damit sich Ihre Mitarbeiter eigenständig im Portal anmelden können:
1. Öffnen Sie das Profil des Mitarbeiters in der Mitarbeiterliste.
2. Scrollen Sie im ersten Tab **Stammdaten** nach unten zum Bereich **Benutzerkonto (Login)**.
3. Tragen Sie ein sicheres Wunschpasswort für den Mitarbeiter ein (mindestens 6 Zeichen, z. B. `start123`).
4. Klicken Sie auf **Login freischalten**.
5. Der Mitarbeiter kann sich ab sofort mit seiner E-Mail-Adresse und diesem Passwort anmelden (Rolle `viewer`).

---

## 3. Wunsch- & Sperrzeiten (Verfügbarkeiten)
Um die Wünsche Ihrer Mitarbeiter bei der Dienstplanung zu berücksichtigen:
1. Öffnen Sie die Detailseite des Mitarbeiters und wechseln Sie zum Tab **Präferenzen**.
2. Sie sehen eine Matrix aus allen Schichttypen (Zeilen) und Wochentagen (Spalten).
3. Wählen Sie für die einzelnen Slots aus:
   * 🌟 **Wunschzeit** (Grün): Der Mitarbeiter arbeitet hier bevorzugt.
   * ⚪ **Standard** (Grau): Neutrale Verfügbarkeit.
   * 🚫 **Sperrzeit** (Rot): Der Mitarbeiter kann hier absolut nicht arbeiten.
4. Klicken Sie am Ende der Tabelle auf **Präferenzen speichern**.

*Hinweis: Der Auto-Scheduler beachtet diese Angaben automatisch.*

---

## 4. Dienstplanerstellung (Woche & Monat)
Navigieren Sie zum Menüpunkt **Schichtplan**. Sie können über die Tabs oben zwischen der **Wochenansicht** und der **Monatsansicht (31-Tage-Matrix)** wechseln.

### Manuelle Schichtzuweisung
1. Klicken Sie in der Tabelle auf die leere Zelle in der Zeile des Mitarbeiters und der Spalte des gewünschten Tages.
2. Ein ablenkungsfreies Planungs-Modal öffnet sich.
3. Wählen Sie den **Schichttyp** aus.
4. Das System führt im Hintergrund eine **Echtzeit-ArbZG-Prüfung** durch.
5. Gibt es Konflikte, wird Ihnen ein Warnungsprotokoll angezeigt:
   * **Kritischer Fehler (z. B. Urlaubskollision):** Zuweisung wird komplett blockiert.
   * **Warnung (z. B. Ruhezeit < 11h oder Sperrzeit):** Sie werden darauf hingewiesen, können die Warnung aber per Klick auf **Trotzdem zuweisen** übersteuern.
6. Klicken Sie auf **Speichern**. Die Zuweisung wird sofort im Hintergrund aktualisiert.

### 🤖 Der Auto-Scheduler (Automatische Besetzung)
1. Klicken Sie im Schichtplan auf das **Zauberstab-Symbol** (Dienstplan generieren).
2. Wählen Sie den Zeitraum aus (z. B. die aktuelle Woche oder den gesamten Monat).
3. Klicken Sie auf **Generieren**.
4. Der Algorithmus besetzt alle offenen Schichten in Sekunden. Er stellt sicher, dass:
   * Keinerlei ArbZG-Gesetzeskonflikte erzeugt werden.
   * Mitarbeiter entsprechend ihrer vertraglichen Soll-Stunden gleichmäßig ausgelastet sind.
   * Wunschzeiten bevorzugt und Sperrzeiten zu 100% ignoriert werden.

---

## 5. Schließtage & Feiertage (Einstellungen)
Unter **Einstellungen** verwalten Sie die betrieblichen Rahmenbedingungen:
* **Betriebsdaten:** Name und Kürzel des Mandanten bearbeiten.
* **ArbZG-Richtlinien:** Festlegen von Maximalarbeitszeit (z. B. 10h/Tag), Ruhezeiten (z. B. 11h) und Pausen-Schwellenwerten.
* **Schließtage hinzufügen:** Fügen Sie gesetzliche Feiertage oder Betriebsferien hinzu. An diesen Tagen wird die Dienstplanung automatisch blockiert.

---

## 6. Urlaubs- & Tauschfreigaben

### Urlaubsanträge genehmigen
1. Navigieren Sie zu **Urlaub** (Review-Cockpit).
2. Sie sehen alle offenen Anträge mit Zeitraum, Notizen und dem berechneten Urlaubstage-Abzug (Wochenenden und Feiertage werden automatisch herausgerechnet).
3. Klicken Sie auf **Genehmigen** (Häkchen) oder **Ablehnen** (Kreuz). Das System sperrt den Mitarbeiter im genehmigten Zeitraum automatisch für Schichtplanungen.

### Schichttäusche freigeben (Tauschbörse)
1. Navigieren Sie zur **Tauschbörse** in der Sidebar.
2. Unter **Vorgeschlagene Täusche** sehen Sie Schichten, die von Mitarbeitern angeboten und von Kollegen beansprucht wurden.
3. Das System prüft beim Freigabeversuch automatisch, ob der Tausch beim neuen Mitarbeiter gegen das ArbZG verstößt.
4. Klicken Sie auf **Tausch genehmigen** oder **Tausch ablehnen**. Bei Freigabe wird der Schichtplan im Hintergrund automatisch aktualisiert.

---

## 7. Export & Lohnbuchhaltung
Am Ende des Planungszeitraums können Sie die Daten mit einem Klick exportieren:
* **PDF-Druck:** Klicken Sie auf **Drucken**. Die Seite blendet Sidebar und Bedienelemente aus und skaliert die gesamte Tabelle (inklusive einer Schichtlegende und des Erstellungs-Zeitstempels) perfekt auf ein A4-Blatt im Querformat.
* **Excel-CSV-Export:** Klicken Sie auf **Export (CSV)**. Das System lädt eine Excel-kompatible CSV-Datei herunter. Diese enthält neben den Tabellendaten auch Metadaten (Zeitraum, Mandantenname) und eine Legende der Schichtzeiten am Ende.
* **Live-Zeitanalyse:** Nutzen Sie die einklappbare Tabelle unterhalb des Dienstplans, um Soll-Stunden, Ist-Stunden und Abweichungen für jeden Mitarbeiter in Echtzeit einzusehen.

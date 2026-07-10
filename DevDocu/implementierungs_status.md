# Validierungsbericht: Soll- vs. Ist-Zustand (SimpleStaff)

Dieses Dokument vergleicht den aktuellen Implementierungsstand des Projekts **SimpleStaff** mit den Vorgaben und Phasen aus der [implementation_scaffolding.md](file:///d:/projekt/SimpleStaff/DevDocu/implementation_scaffolding.md).

---

## 1. Zusammenfassung des aktuellen Stands

Die Implementierung von **SimpleStaff** ist vollständig abgeschlossen und alle Kern- sowie Zusatzfunktionen wurden produktionsreif realisiert. 

*   **Backend (Rust/Axum):** Baut und läuft fehlerfrei. Alle APIs für Mandanten, Mitarbeiter, Schichttypen, Schließtage, Urlaube und Schichtzuweisungen sind vollständig integriert.
*   **Regelvalidierung (ArbZG-Prüfung):** Vollständig implementiert. Der `validation_service.rs` prüft Pausenzeiten, 11-Stunden-Mindestruhezeiten, Höchstarbeitszeiten, Urlaubskollisionen, gesperrte Tage und Wochenstundenlimits. Zuweisungsversuche triggern automatische Checks, die im Frontend als Warnungen oder kritische Fehler angezeigt werden (mit optionaler Planer-Freigabe "Trotzdem zuweisen").
*   **Auto-Scheduling:** Der intelligente Greedy-Scheduling-Algorithmus besetzt freie Dienstpläne im Zukunftszeitraum unter Berücksichtigung von Vertragsstunden, Schicht-Wochentagsgültigkeiten, Schließ-/Feiertagsregeln, Urlaubszeiten und Mitarbeiter-Schichtpräferenzen.
*   **Druck- & Exportoptimierungen:** Hochwertiger PDF-Farbdruck über CSS-Druckmedien-Abfragen für Woche und Monat. Inklusive Erstellungsdatum und -uhrzeit (Zeitstempel), Betriebsname und Schichtlegende im Tabellen-Fußbereich. Der CSV-Export ist Excel-kompatibel und beinhaltet ebenfalls Metadaten und die Legende.
*   **QR-Code-Abonnements:** Integrierte, offline-fähige QR-Code-Erzeugung direkt auf der Kalenderseite. Scannt ein Mitarbeiter den Code mit seinem Smartphone, wird die URL automatisch über das `webcal://`-Protokoll verarbeitet und der Dienstplan ohne manuelles Tippen direkt in der Kalender-App abonniert.

---

## 2. Abgleich nach Projektphasen

### Phase 1 (MVP) – *100% abgeschlossen*
*   **Backend-Infrastruktur:** Axum-Server mit Fehlerbehandlung (`errors.rs`), Middleware für JWT-Auth und RLS-Tenant-Isolation ist vorhanden.
*   **Datenbank-Schema & Migrationen:** Alle 12 Migrationsschritte (inkl. RLS-Policies und closed_days-Tabelle) sind implementiert.
*   **Super-Admin-Seeding:** Die automatische Generierung des System-Tenants und des Super-Admins bei Server-Start funktioniert über direkte SQL-Statements zur Umgehung von RLS.
*   **CRUD-APIs:** Endpunkte für Tenants, Employees, ShiftTypes, BlockedDays, Vacations und Assignments sind vollständig vorhanden.
*   **Super-Admin Dashboard:** `/super-admin` ermöglicht die Mandantenverwaltung (CRUD) und validiert Mitarbeiterlimits pro Mandant.

### Phase 2 (Frontend) – *100% abgeschlossen*
*   **Hauptseiten:** Login, Register, Dashboard, Mitarbeiter, Schichttypen und Einstellungen sind umgesetzt.
*   **Schichtplan-UI:** Die Wochenansicht ist als Grid-Tabelle aufgebaut (Zeilen = Mitarbeiter, Spalten = Wochentage) und bietet eine intuitive Bedienung.
*   **Divergenz (Zuweisungs-Modal statt Drag & Drop):** Die Zuweisung wurde über ein zentriertes, ablenkungsfreies Planungsmodal gelöst. Dies vermeidet Anzeigefehler und Verschiebe-Bugs auf mobilen Endgeräten und bietet eine deutlich stabilere Benutzererfahrung als herkömmliches Drag & Drop.

### Phase 3 (Regelvalidierung & ArbZG) – *100% abgeschlossen*
*   **Backend-Service:** Der `validation_service.rs` ist voll integriert.
*   **Integration:** Bei `POST /api/assignments` wird die Validierung ausgeführt. Eventuelle Warnungen werden an das Frontend übergeben.
*   **Frontend-Warnungsmodal:** Versucht der Planer, eine ungültige Schicht zuzuweisen, öffnet sich ein Warnungsdialog, der die verletzten Kriterien anzeigt und bei unkritischen Verstößen das Übersteuern ("Trotzdem zuweisen") ermöglicht.

### Phase 4 (Dashboard & Kalender-Abo) – *100% abgeschlossen*
*   **Kalender-Abonnement:** Funktioniert per langlebigen JWT-Tokens (`/api/calendar/subscribe/{token}`).
*   **Dashboard:** Zeigt heutige Schichten, offene Urlaubsanträge und allgemeine Statistiken an.
*   **QR-Code-Unterstützung:** QR-Codes werden direkt auf der Kalenderseite per SVG gerendert und unterstützen das `webcal://`-Protokoll zur automatischen, klickfreien Einrichtung.

### Phase 5 (Auto-Scheduling & Reporting) – *100% abgeschlossen*
*   **Auto-Scheduling-Service:** Backend-Kernalgorithmus in Rust (`scheduler_service.rs`) und Route `/api/assignments/auto-schedule` sind implementiert.
*   **Auto-Planungs-UI:** Zauberstab-Schaltfläche und Datumsbereichs-Modal in der Wochen- und Monatsansicht zur automatischen Besetzung.
*   **Detaillierte Monatsansicht:** Vollständige 30/31-Tage-Mitarbeiter-Matrix (`ShiftPlanMonthPage.tsx`) mit flackerfreiem Neuladen im Hintergrund und direktem Planungs-Modal.
*   **Reporting & Druck:** Excel-CSV-Downloads mit UTF-8 BOM, Kopfbereichs-Metadaten und Schicht-Legende. Skalierter Farbdruck (Querformat) mit rechtlichen Zeitstempeln und Legenden.
*   **Live-Arbeitszeit-Auswertung:** Einklappbare, interaktive Zusammenfassungs-Tabelle im Planungs-Frontend (Woche & Monat), die Ist-Stunden, Soll-Stunden, geplante Schichten, Urlaubstage und Stunden-Differenzen pro Mitarbeiter live bilanziert. Ein entsprechend formatierter Auswertungs-Block wird am Fußende der gedruckten Dienstpläne ausgegeben (Arbeitsrechts- und Abrechnungshilfe).

### Phase 6 (Mitarbeiter-Portal & Urlaubs-Self-Service) – *100% abgeschlossen*
*   **Benutzer-Mitarbeiter-Verknüpfung:** Automatisches Matching zwischen Anmeldedaten und Planungsdaten über die E-Mail-Adresse.
*   **Rollenbasierte Ansicht (Sidebar-Filterung):** Mitarbeiter (Rolle `viewer`) erhalten einen stark vereinfachten, abgesicherten Navigationsbaum ohne planerische Funktionen.
*   **Self-Service-Urlaub (`VacationsPage.tsx`):** Mitarbeiter beantragen Urlaub (mit Notizen & automatischer Tagesberechnung) und sehen ihr Saldo; Planer genehmigen/lehnen Anträge im Review-Cockpit mit einem Klick ab.
*   **Personalisiertes Dashboard:** Direkte Übersicht für Mitarbeiter über eigene heutige Schichten, Resturlaub und Antragsstatus.
*   **Kalender-Abonnement-Sicherheit:** Backend-Prüfung in `calendar.rs`, damit Mitarbeiter Kalender-Feeds ausschließlich für ihr eigenes Profil abrufen können.

---

## 3. Technische Divergenzen & Detailunterschiede

| Vorgabe (Soll) | Aktueller Zustand (Ist) | Bewertung / Auswirkung |
| :--- | :--- | :--- |
| **utoipa (OpenAPI / Swagger)** | Nicht integriert. | Durch die direkte Typsynchronisierung in `types.ts` und die sauberen API-Client-Methoden ist der Abstimmungsaufwand minimal. Auf Swagger wurde zur Vermeidung von Cargo-Dependency-Overhead im MVP verzichtet. |
| **icalendar Crate** | In `Cargo.toml` deklariert, aber in `calendar_service.rs` ungenutzt. | Die Generierung der `.ics`-Dateien erfolgt über leichtgewichtiges, manuelles String-Formatting. Dies spart Dependency-Overhead und reicht aus, macht die Crate jedoch überflüssig. |
| **Drag & Drop im Frontend** | Schichten werden per zentriertem Planungs-Modal in Grid-Zellen zugewiesen. | Höhere Stabilität, keine Layout-Sprünge, vollwertiger mobiler Support und bessere darstellende Warnungs-Details als bei Drag & Drop. |

---

## 4. Empfohlene Maßnahmen (Nächste Schritte)

1.  **Produktions-Deployment:** Das System ist vollständig bereit für den Übergang auf Staging- und Produktivumgebungen.

---

## 5. Zukünftige Produkt-Roadmap (Backlog)

Die folgenden Features wurden als nächste strategische Ausbaustufen identifiziert, um SimpleStaff zu einer vollwertigen HR- und Abrechnungs-Suite auszubauen:

1. **Schicht-Tauschbörse:**
   * Mitarbeiter können geplante Schichten freigeben. Andere qualifizierte Mitarbeiter können sich darauf bewerben.
   * Automatische Zuweisung nach Freigabe durch den Administrator zur Reduzierung des manuellen Umplanungsaufwands.
2. **Digitale Zeiterfassung (Soll- vs. Ist-Vergleich):**
   * Digitales Ein-/Ausstempeln der Mitarbeiter zu Schichtbeginn und -ende.
   * Dashboard-Gegenüberstellung für Planer zur Erkennung von Arbeitszeit-Abweichungen als direkte Grundlage für die Lohnabrechnung.
3. **Feiertags-Integration & Zuschläge:**
   * Automatischer Import der gesetzlichen Feiertage je nach Bundesland.
   * Visuelle Kennzeichnung im Gitter, Validierung von Beschäftigungsverboten und automatische Berechnung steuerfreier Feiertagszuschläge in der Lohn-Zusammenfassung.
4. **Mitarbeiter-Verfügbarkeiten (Wunschzeiten):**
   * Mitarbeiter können wöchentliche Ausschlusszeiten (z. B. "Mittwochvormittag gesperrt") oder Wunschschichten im Portal hinterlegen.
   * Direkte Berücksichtigung im Auto-Scheduling-Algorithmus zur Steigerung der Zuweisungs-Qualität.

---
name: nethserver8-module
description: >-
  Comprehensive guide, architecture rules, and validation checklist for building,
  debugging, and maintaining NethServer 8 (NS8) rootless container modules
  (imageroot, systemd user units, Podman pods, Traefik routes, Restic backup/restore,
  and Cockpit Vue/Carbon UI).
---

# NethServer 8 (NS8) Module Development & Audit Skill

Activate this skill whenever creating, modifying, or auditing a **NethServer 8 (NS8)** application module (`imageroot/`, `ui/`, `Dockerfile`/`Containerfile`, `build-images.sh`).

---

## 1. Critical NS8 Architectural Rules (Do's & Don'ts)

1. **NEVER Override `imageroot/actions/get-status`:**
   - NethServer 8 provides a built-in core `get-status` action (`/usr/local/agent/actions/get-status/20read`).
   - Creating a custom `imageroot/actions/get-status/` conflicts with the core schema (`node` as integer, `images[].size` in integer bytes for the `byteFormat` filter, `services[]` with `{ name, active, failed, enabled }`) and breaks `Status.vue`.
   - Always fetch custom module state (such as `domain_name`, `app_url`, `lets_encrypt`, `smtp_enabled`) via `get-configuration` instead.

2. **ALWAYS Call `agent.dump_env()` After `agent.set_env()`:**
   - In Python action scripts (`create-module/20initialize`, `configure-module/20configure`, `restore-module/06copyenv`), `agent.set_env(key, value)` does **not** flush `~/.config/state/environment` to disk until the action exits or `agent.dump_env()` is explicitly called.
   - Because `80start_services` runs inside `configure-module` *before* the action exits, omitting `agent.dump_env()` causes `systemctl --user restart` to read stale or empty environment files!

3. **Bind Podman Ports strictly to `127.0.0.1:${TCP_PORT}`:**
   - Rootless modules behind Traefik must publish their HTTP port to localhost only: `-p 127.0.0.1:${TCP_PORT}:80`.
   - Register the route via `agent.tasks.run(agent_id=traefik_id, action='set-route', data={'instance': os.environ['MODULE_ID'], 'url': f'http://127.0.0.1:{tcp_port}', 'host': domain_name, 'lets_encrypt': lets_encrypt, 'http2https': http2https})`.

4. **Validate Traefik Hostname Collisions (`01hostname-validation`):**
   - In `imageroot/actions/configure-module/01hostname-validation`, check `agent.http_route_in_use(domain=domain_name)` when the domain changes.
   - If in use, call `agent.set_status("validation-failed")`, print the validation error JSON array to `sys.stdout`, and exit with `sys.exit(2)`.

5. **Avoid `--pull=always` in Systemd Units:**
   - Never use `--pull=always` in `ExecStartPre`/`ExecStart` inside `imageroot/systemd/user/*.service`. Network delays or registry rate limits during service restarts will exceed systemd's `TimeoutStartSec`.
   - Use `--pull=missing` in `.service` files, list all required images (including databases like `docker.io/library/postgres:15-alpine`) in the `org.nethserver.images` label in `Dockerfile`, and pull updated images in `imageroot/update-module.d/`.

6. **Multi-Container Pod Startup Ordering:**
   - When running a database container and an application container inside a shared Podman pod, `podman run -d` returns as soon as the container process is spawned—before the database is ready to accept connections.
   - Always include both:
     - A readiness wait loop in `ExecStartPre` (e.g. `podman exec <db-container> pg_isready ...`), and
     - Connection retry logic with backoff in the application backend, plus `--restart=on-failure` on detached containers.

7. **Backup, Restore & Clone Support:**
   - Define `imageroot/etc/state-include.conf` listing persistent state files/directories or volumes to include in Restic cluster backups.
   - Provide `imageroot/bin/module-dump-state` (e.g. `pg_dump` or SQLite online backup) and `imageroot/bin/module-cleanup-state`.
   - Provide `imageroot/actions/restore-module/` (`06copyenv`, `50configure`) and `imageroot/actions/clone-module/50configure`.

8. **Line Endings (LF) & Executable Permissions (`chmod +x`):**
   - Windows CRLF (`\r\n`) breaks Linux shebangs (`#!/usr/bin/env python3\r` -> `env: 'python3\r': No such file or directory`).
   - Enforce `imageroot/** text eol=lf` in `.gitattributes` AND strip `\r` + run `chmod +x` inside the `Dockerfile`:
     ```dockerfile
     RUN find /imageroot -name "__pycache__" -type d -exec rm -rf {} + && \
         find /imageroot -name "*.pyc" -delete && \
         find /imageroot -type f -exec sed -i 's/\r$//' {} + && \
         chmod +x /imageroot/actions/*/[0-9]* /imageroot/update-module.d/* /imageroot/bin/*
     ```

---

## 2. NS8 Cockpit UI (`@nethserver/ns8-ui-lib`) Rules

1. **Notification API Signatures in `TaskService`:**
   - `this.createErrorNotificationForApp(err, message)` takes **2 arguments**.
   - `this.createNotificationForApp(notification)` takes a notification object.
   - **Never** call `this.createSuccessNotificationForApp(...)` — that method does **not** exist in `@nethserver/ns8-ui-lib` and throws a `TypeError`!
   - For task completion notifications, either let NS8 core show the task banner (by omitting `isNotificationHidden: true` in `extra`) or render an `<NsInlineNotification kind="success" ... />` in the view.

2. **Carbon Icons Registration:**
   - Any `@carbon/icons-vue` icon used as a tag in `<template>` (e.g. `<Launch20 />`, `<Globe20 />`) **must** be registered in `components: { ... }`.
   - Icons passed as props (`:icon="Save20"`) must be exposed in `data()`.

3. **VueI18n Initialization (`ui/src/main.js`):**
   - Always load `en` alongside the active locale (`messages: { de: deMessages, en: enMessages }`) so `fallbackLocale: "en"` works when keys are missing.
   - Ensure `action.list-installed-modules`, `task.cannot_create_task`, `error.cannot_retrieve_installed_modules`, and `error.cannot_retrieve_module_info` exist in `public/i18n/*/translation.json`.

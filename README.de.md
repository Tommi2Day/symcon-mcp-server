# Symcon MCP Server 🏠

Verbindet KI-Assistenten mit [IP-Symcon](https://www.symcon.de) über das Model Context Protocol (MCP).

[![CI](https://github.com/tommi2day/symcon-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/tommi2day/symcon-mcp-server/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/tommi2day/symcon-mcp-server/graph/badge.svg)](https://codecov.io/gh/tommi2day/symcon-mcp-server)
[![GitHub release](https://img.shields.io/github/v/release/tommi2day/symcon-mcp-server)](https://github.com/tommi2day/symcon-mcp-server/releases)
[![Docker Image](https://img.shields.io/docker/pulls/tommi2day/symcon-mcp-server?logo=docker&label=docker%20pulls)](https://hub.docker.com/r/tommi2day/symcon-mcp-server)

Stellt die Symcon JSON-RPC-API als MCP-Tools zur Verfügung, damit KI-Assistenten (Claude, Cursor, VS Code Copilot, …) Ihr Smart Home lesen und steuern können.

> [!IMPORTANT]
> Die Symcon JSON-RPC-API **erfordert eine Authentifizierung**. Sie müssen sowohl `SYMCON_API_USER` (Ihre Lizenz-E-Mail) als auch `SYMCON_API_PASSWORD` angeben.

[English version of README](README.md)

## Übersicht

| Modus | Transport | Verwendung |
|-------|-----------|-------------|
| Lokal (Node.js) | stdio | Entwicklung, kein Docker |
| Docker / Remote | HTTP oder HTTPS | Anderer Host im Netzwerk |

---

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
|----------|---------|-------------------------------------------------------|
| `MCP_PORT` | `4096` | Port, auf dem der Server lauscht |
| `MCP_HOST_PORT` | `4096` | Docker-Host-Port |
| `MCP_TRANSPORT` | `streamable` | `streamable`, `sse` oder `stdio` |
| `MCP_AUTH_TOKEN` | *(leer)* | Bearer-Token; [Wie erstellen?](#token-authentifizierung) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `SYMCON_API_URL` | `http://host.docker.internal:3777/api/` | Symcon [JSON-RPC-Endpunkt](https://www.symcon.de/service/dokumentation/entwicklerbereich/datenaustausch/) |
| `SYMCON_API_USER` | *(leer)* | Symcon Lizenz-Benutzername (erforderlich) |
| `SYMCON_API_PASSWORD` | *(leer)* | Symcon Passwort (erforderlich) |
| `SYMCON_TLS_VERIFY` | `true` | Auf `false` setzen für selbstsignierte Zertifikate |

---

## Docker Hub

Das Image ist auf Docker Hub verfügbar:

```bash
docker pull tommi2day/symcon-mcp-server:latest
```

### Schnellstart über Hub (HTTP)

```bash
docker run -d --name symcon-mcp-server \
  -p 4096:4096 \
  -e SYMCON_API_URL=http://192.168.1.100:3777/api/ \
  -e SYMCON_API_USER=ihre-lizenz-email@example.com \
  -e SYMCON_API_PASSWORD=ihr-symcon-passwort \
  -e MCP_AUTH_TOKEN=mein-geheimes-token \
  tommi2day/symcon-mcp-server:latest
```

### In docker-compose.yml

```yaml
services:
  symcon-mcp-server:
    image: tommi2day/symcon-mcp-server:latest
    ports:
      - "4096:4096"
    environment:
      - SYMCON_API_URL=http://192.168.1.100:3777/api/
      - SYMCON_API_USER=ihre-lizenz-email@example.com
      - SYMCON_API_PASSWORD=ihr-symcon-passwort
      - MCP_AUTH_TOKEN=mein-geheimes-token
```

---

## Token-Authentifizierung

Wenn der MCP-Server als HTTP/SSE-Dienst ausgeführt wird, wird empfohlen, ein starkes `MCP_AUTH_TOKEN` zu setzen, um unbefugten Zugriff auf Ihre Symcon-Instanz zu verhindern.

### Automatische Erstellung

Wenn Sie das mitgelieferte Skript `./scripts/run.sh` zum Starten des Servers verwenden, wird beim ersten Durchlauf automatisch ein starkes 32-Byte-Hex-Token für Sie generiert und in einer Datei namens `auth_token` im Projektverzeichnis gespeichert.

### Manuelle Erstellung

Sie können ein sicheres Token manuell mit `openssl` generieren (verfügbar unter Linux, macOS und Git Bash für Windows):

```bash
openssl rand -hex 32
```

Setzen Sie diesen Wert dann als Umgebungsvariable `MCP_AUTH_TOKEN` in Ihrer `.env`-Datei oder im `docker run`-Befehl.

### Verwendung

Wenn die Authentifizierung aktiviert ist, müssen alle Anfragen an den MCP-Server den folgenden Header enthalten:

```http
Authorization: Bearer <ihr-mcp-auth-token>
```

---

## 1 · Lokal (stdio)

Setzen Sie `MCP_TRANSPORT=stdio` und führen Sie den Server über Node.js oder Docker aus.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "symcon": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "tommi2day/symcon-mcp-server"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "SYMCON_API_URL": "http://192.168.1.100:3777/api/",
        "SYMCON_API_USER": "ihre-lizenz-email@example.com",
        "SYMCON_API_PASSWORD": "ihr-symcon-passwort"
      }
    }
  }
}
```

---

## 2 · Docker (HTTP/SSE)

In diesem Modus läuft der MCP-Server als eigenständiger Container und stellt einen HTTP-Endpunkt für jeden kompatiblen Client zur Verfügung.

### Ausführen mit Docker

Wenn Sie eine Symcon-Instanz an anderer Stelle laufen haben, starten Sie nur den MCP-Server:

```bash
docker run -d --name symcon-mcp-server \
  -p 4096:4096 \
  -e SYMCON_API_URL=http://192.168.1.100:3777/api/ \
  -e SYMCON_API_USER=ihre-lizenz-email@example.com \
  -e SYMCON_API_PASSWORD=ihr-symcon-passwort \
  -e MCP_AUTH_TOKEN=mein-geheimes-token \
  tommi2day/symcon-mcp-server:latest
```

### Zugriff mit `mcp.json`

Um den Server von einem MCP-Client (wie Cursor oder VS Code) aus zu nutzen, fügen Sie ihn zu Ihrer `mcp.json`-Konfiguration hinzu:

```json
{
  "mcpServers": {
    "symcon": {
      "url": "http://localhost:4096/mcp",
      "headers": {
        "Authorization": "Bearer mein-geheimes-token"
      }
    }
  }
}
```

---

## 3 · Docker Compose (Full Stack)

Verwenden Sie dies, wenn Sie sowohl **IP-Symcon** als auch den **MCP-Server** zusammen in einem Stack ausführen möchten (z. B. zum Testen oder Evaluieren).

1. **Klonen und Konfigurieren**
   ```bash
   git clone https://github.com/tommi2day/symcon-mcp-server.git
   cd symcon-mcp-server
   cp .env.example .env
   ```
   Editieren Sie die `.env` und setzen Sie `SYMCON_API_URL`, `SYMCON_API_USER`, `SYMCON_API_PASSWORD` und `MCP_AUTH_TOKEN`.

2. **Starten**
   ```bash
   # Startet beide Dienste
   docker compose up -d
   ```

3. **Verifizieren**
   ```bash
   curl http://localhost:4096/health
   ```

4. **Symcon GUI aufrufen**
   Öffnen Sie [http://localhost:3777](http://localhost:3777) in Ihrem Browser, um auf die IP-Symcon-Konsole zuzugreifen.

---

## Architektur

```
KI-Client (Claude / Cursor / …)
        │  HTTP POST /mcp
        ▼
┌─────────────────────────┐
│   symcon-mcp-server     │  :4096
│   (Docker-Container)    │
│                         │
│  MCP-Tools              │
│   ├─ get_value          │
│   ├─ set_value          │
│   ├─ request_action     │
│   ├─ get_variable       │
│   ├─ get_object         │
│   ├─ get_children       │
│   ├─ get_object_by_name │
│   ├─ get_variable_path  │
│   ├─ run_script         │
│   ├─ run_script_text    │
│   ├─ snapshot_variables │
│   ├─ diff_variables     │
│   ├─ script_create      │
│   └─ script_set_content │
└────────────┬────────────┘
             │ [JSON-RPC](https://www.symcon.de/service/dokumentation/entwicklerbereich/datenaustausch/)
             ▼
    IP-Symcon  :3777/api/
```

---

## Verfügbare MCP-Tools

| Tool | Beschreibung |
|------|-------------|
| `symcon_get_value` | Aktuellen Wert einer Variablen lesen |
| `symcon_set_value` | Wert direkt in eine Variable schreiben |
| `symcon_request_action` | Geräteaktion auslösen (für echte Geräte verwenden) |
| `symcon_get_variable` | Variablen-Metadaten abrufen (Typ, Profil, Zeitstempel) |
| `symcon_get_object` | Metadaten für ein beliebiges Objekt abrufen (Kategorie, Instanz, …) |
| `symcon_get_children` | IDs der Kinderobjekte auflisten (0 = Wurzel) |
| `symcon_get_object_id_by_name` | Objekt-ID anhand des Namens finden |
| `symcon_get_variable_by_path` | Variable über einen durch Schrägstriche getrennten Pfad auflösen |
| `symcon_run_script` | Vorhandenes Symcon-Skript per ID ausführen |
| `symcon_run_script_text` | Beliebigen PHP-Code in Symcon ausführen |
| `symcon_snapshot_variables` | Momentaufnahme aller Variablenwerte unter einer Wurzel erstellen |
| `symcon_diff_variables` | Änderungen seit einer vorherigen Momentaufnahme erkennen |
| `symcon_script_create` | Neues PHP-Skript in Symcon erstellen |
| `symcon_script_set_content` | PHP-Inhalt eines bestehenden Skripts aktualisieren |
| `symcon_script_delete` | Skript per ID löschen |

---

## Tipps zur Gerätesteuerung

### Schalter & Relais
```
Verwenden Sie symcon_request_action mit dem Wert true (an) oder false (aus)
```

### Philips Hue Helligkeit
```
Verwenden Sie symcon_request_action mit Werten von 0–254 (0 = aus, 254 = volle Helligkeit)
```

### Variablen-IDs finden
Fragen Sie den KI-Assistenten:
> "Finde die Objekt-ID meiner Wohnzimmerlampe"

### Snapshot & Diff (Geräteerkennung)
1. Die KI ruft `symcon_snapshot_variables` für den relevanten Raum auf.
2. Die KI fragt: *"Bitte betätigen Sie das Gerät, das Sie zuweisen möchten, und geben Sie mir dann Bescheid"*
3. Der Benutzer betätigt das Gerät.
4. Die KI ruft `symcon_diff_variables` auf, um zu identifizieren, welche Variable sich geändert hat.

---

## Endpunkte

| Endpunkt | Methode | Beschreibung |
|----------|--------|-------------|
| `/` | GET | Server-Info und verfügbare Endpunkte |
| `/health` | GET | Health-Check (Symcon-Status, Uptime, Version) |
| `/info` | GET | Detaillierte Serverkonfiguration und Symcon-Version |
| `/mcp` | POST/GET/DELETE | MCP Streamable HTTP-Transport |
| `/sse` | GET | MCP SSE-Transport (wenn `MCP_TRANSPORT=sse`) |
| `/messages` | POST | SSE-Nachrichten-Handler |
| Stdio | N/A | MCP Stdio-Transport (wenn `MCP_TRANSPORT=stdio`) |

---

## Entwicklung & Testen

### Tests lokal ausführen

```bash
# Installieren
npm install

# Unit-Tests
npm test

# Integrationstests (startet einen echten Symcon-Docker-Container)
npm run test:integration

# Alle Tests
npm run test:all
```

### Verwendung von Docker-Skripten

```bash
./scripts/test.sh                     # Unit-Tests über Docker
./scripts/test.sh --integration       # Unit- + Integrationstests
./scripts/lint.sh                     # Linting
```

### Test-Architektur

| Test-Suite | Datei | Abhängigkeiten |
|-----------|------|-------------|
| Unit: SymconClient | `tests/symcon-client.test.ts` | MockSymconServer (prozessintern) |
| Unit: MCP-Tools | `tests/tools.test.ts` | MockSymconServer + InMemoryTransport |
| Unit: HTTP-Server | `tests/http-server.test.ts` | MockSymconServer + gestarteter Express-Server |
| Unit: Info-Endpunkt | `tests/info.test.ts` | MockSymconServer + gestarteter Express-Server (Auth, Maskierung & Symcon-Version) |
| Integration | `tests/integration.test.ts` | Echter `symcon/symcon-server` Docker-Container |

---

## CI/CD

Das Repository verwendet zwei primäre GitHub Actions-Workflows:

**`CI` (`ci.yml`)** – wird bei jedem Push und Pull-Request ausgeführt:
1. **Lint**: ESLint-Prüfungen.
2. **Test**: Unit-Tests auf Node 24.
3. **Coverage**: Berechnung der Unit-Test-Abdeckung.
4. **Integration Tests**: Führt Integrationstests gegen einen echten Symcon-Docker-Service-Container aus.
5. **Report**: Lädt die Abdeckungsergebnisse zu Codecov hoch.

**`Release` (`release.yml`)** – wird durch ein Semver-Tag oder manuelles Auslösen gestartet:
1. **Bump version** (nur manuell): Aktualisiert `package.json` und `openapi.json`, committet und pusht auf `main`.
2. **Lint & Test**: Führt Linting, Unit-Tests mit Abdeckung und Integrationstests aus.
3. **Build & Push**: Multi-Arch-Docker-Build und Push zu Docker Hub (`tommi2day/symcon-mcp-server`).
4. **Create Release**: Erstellt ein GitHub-Tag (falls manuell) und ein GitHub-Release mit automatisch generierten Notizen.

---

## Produktions-Checkliste

- [ ] Setzen Sie ein starkes `MCP_AUTH_TOKEN`
- [ ] Beschränken Sie Port 4096 über eine Firewall oder geben Sie ihn nur über einen Reverse-Proxy frei
- [ ] Verwenden Sie HTTPS über einen Reverse-Proxy (Traefik, nginx, Caddy) in der Produktion
- [ ] Prüfen Sie `/health` über Ihr Monitoring-System

---

## Lizenz

MIT

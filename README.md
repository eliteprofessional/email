# airepro.solutions — DNS & IP cutover

Outbound mail host: **`mail.airepro.solutions`**  
Sender: **`campaigns@airepro.solutions`**  
Postfix (Docker): host port **`2525`** → container `25`

When you move the VPS, update **Cloudflare**, **PTR**, and **server env** to the new public IP.

## Current / example VPS IP

Replace this everywhere it appears when the server IP changes:

```text
122.180.85.70
```

---

## Cloudflare DNS (`airepro.solutions`)

All mail records must be **DNS only** (grey cloud). Do **not** orange-cloud or put `mail` behind an HTTP Cloudflare Tunnel.

| Type    | Name              | Content                                                    | Proxy    | Notes                               |
| ------- | ----------------- | ---------------------------------------------------------- | -------- | ----------------------------------- |
| **A**   | `mail`            | `122.180.85.70`                                            | DNS only | Hostname for Postfix                |
| **MX**  | `@`               | `mail.airepro.solutions`                                   | —        | Priority **10**                     |
| **TXT** | `@`               | `v=spf1 ip4:122.180.85.70 -all`                            | —        | Must match the A record IP          |
| **TXT** | `_dmarc`          | `v=DMARC1; p=none; rua=mailto:campaigns@airepro.solutions` | —        | Tighten `p=` later if desired       |
| **TXT** | `mail._domainkey` | `v=DKIM1; h=sha256; k=rsa; s=email; p=…`                   | —        | Public key from Postfix (see below) |

### When the IP changes

1. Edit **A** `mail` → new IP
2. Edit **TXT** SPF `@` → `v=spf1 ip4:NEW_IP -all`
3. Ask the VPS provider to set **PTR**: `NEW_IP` → `mail.airepro.solutions`
4. Update app env `AIREPRO_SMTP_HOST` if the API is not on the same machine (see below)
5. Do **not** change DKIM unless you regenerate keys on the server

### DKIM (`mail._domainkey`)

Keys live in `./dkim/` (mounted into the container). Prefer **copying the same** `airepro.solutions.private` + `.txt` to the VPS so Cloudflare stays valid.

If you regenerate on the server:

```bash
docker compose up -d --force-recreate
docker exec airepro-postfix cat /etc/opendkim/keys/airepro.solutions.txt
```

Paste into Cloudflare as one TXT string, e.g.:

```text
v=DKIM1; h=sha256; k=rsa; s=email; p=MIIBIjANBg...IDAQAB
```

### What not to do in Cloudflare

- Do **not** create an HTTP Tunnel route `mail.airepro.solutions` → `localhost:2525` (SMTP is not HTTP)
- Do **not** proxy `mail` (orange cloud)
- Website `@` / `www` A/CNAME records are optional for send-only mail; ignore “visitors cannot reach” if you are not hosting a site

---

## Outside Cloudflare (required for inbox delivery)

| Item           | Where                   | Value                                                                              |
| -------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| **PTR / rDNS** | VPS / IP provider panel | `122.180.85.70` → `mail.airepro.solutions`                                         |
| Firewall       | VPS                     | Outbound **TCP 25** (delivery); inbound **2525** only if a remote app submits mail |

---

## Deploy Postfix on the VPS (`122.180.85.70`)

No Cloudflare Tunnel for this service. Docker on the VPS is enough.

### 1. Prerequisites on the VPS

```bash
# Ubuntu/Debian example
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
```

Confirm Cloudflare **A** `mail` → `122.180.85.70` (DNS only) and SPF already use that IP (see table above).

Ask the provider for **PTR**: `122.180.85.70` → `mail.airepro.solutions`.

### 2. Copy this project to the VPS

**Option A — git** (if the repo is reachable):

```bash
cd /opt
sudo git clone <YOUR_EMAIL_REPO_URL> email
cd /opt/email
```

**Option B — scp from your PC** (includes `dkim/` private key — required):

```powershell
# From Windows (PowerShell), in C:\Users\Amplify\email
scp -r .\docker-compose.yml .\dkim .\README.md user@122.180.85.70:/opt/email/
```

You **must** ship `dkim/airepro.solutions.private` and `airepro.solutions.txt`.  
If those files are missing on the VPS, Postfix will generate **new** keys and Cloudflare DKIM will stop matching.

### 3. Firewall

```bash
# Outbound SMTP to the internet (delivery) — usually allowed by default
# Inbound 2525 only if another server submits mail to this VPS:
sudo ufw allow 2525/tcp
sudo ufw allow OpenSSH
sudo ufw enable   # if not already
```

If the Email Management API runs **on the same VPS**, you can leave **2525 closed** to the public internet and use `127.0.0.1:2525`.

### 4. Start Postfix

```bash
cd /opt/email
sudo docker compose up -d
sudo docker ps --filter name=airepro-postfix
sudo docker logs airepro-postfix --tail 50
```

Healthy logs should mention `myhostname=mail.airepro.solutions`, DKIM for `airepro.solutions`, and listening on port 25 inside the container (mapped to host **2525**).

### 5. Point the Email API at Postfix

On the **same** VPS as Postfix:

```env
AIREPRO_SMTP_HOST=127.0.0.1
AIREPRO_SMTP_PORT=2525
AIREPRO_SMTP_SECURE=false
AIREPRO_FROM=campaigns@airepro.solutions
AIREPRO_FROM_NAME=Airepro
```

Restart the API, select **Airepro Mail** in Settings, click **Test connection**, then send a test to an `@airepro.in` address first (Gmail often rejects residential/new IPs until PTR + reputation are good).

### 6. Optional smoke test from the VPS

```bash
# SMTP banner / port open locally
sudo docker exec airepro-postfix postconf myhostname
nc -vz 127.0.0.1 2525
```

---

## This repo (Postfix on the VPS)

[`docker-compose.yml`](docker-compose.yml):

- `HOSTNAME=mail.airepro.solutions`
- `ALLOWED_SENDER_DOMAINS=airepro.solutions`
- Port `2525:25`
- Volume `./dkim:/etc/opendkim/keys`

```bash
docker compose up -d
```

Local mail-engine `.env` (sibling app that talks to Postfix), if used:

```env
SMTP_HOST=127.0.0.1
SMTP_PORT=2525
MAIL_FROM=campaigns@airepro.solutions
```

---

## Email Management API (`sendEmailProjects`)

On the API host, set:

```env
# Same VPS as Postfix:
AIREPRO_SMTP_HOST=127.0.0.1
AIREPRO_SMTP_PORT=2525
AIREPRO_SMTP_SECURE=false

# API on a different host:
# AIREPRO_SMTP_HOST=122.180.85.70

AIREPRO_FROM=campaigns@airepro.solutions
AIREPRO_FROM_NAME=Airepro
```

In the UI: **Email System → Settings → Airepro Mail → Save**, then **Test connection**.

DB (once per environment):

```bash
npm run db:migrate:airepro
```

---

## Quick verify after IP change

```bash
# DNS
nslookup mail.airepro.solutions 1.1.1.1
nslookup -type=TXT airepro.solutions 1.1.1.1
nslookup -type=TXT mail._domainkey.airepro.solutions 1.1.1.1

# Postfix up
docker ps --filter name=airepro-postfix
```

SPF string must contain the **same** IP as the `mail` A record. PTR must match `mail.airepro.solutions`.

---

## Jenkins deploy

[`Jenkinsfile`](Jenkinsfile) assumes **Jenkins runs on a different machine** than the mail host and deploys to the target VPS over **SSH**.

It rsyncs (or scp/tar-falls back to) the repo into `/opt/email` on the target (configurable), installs the DKIM private key from Jenkins credentials if present, then runs `docker compose up -d` and a smoke check — all via SSH.

### Target VPS

```bash
ssh airepro2@122.180.85.70
```

### SSH auth mode

The `SSH_AUTH_MODE` parameter picks how Jenkins authenticates — **`password`** (current default) or **`key`**. Switching back to the key later is just re-running the job with `SSH_AUTH_MODE=key`; nothing else needs to change.

> **Security note:** password auth to a VPS with SSH open to the internet is meaningfully weaker than key auth — it's brute-forceable. Prefer a strong password (not something like `146...`), and/or restrict inbound `22/tcp` in `ufw` to known source IPs. Switch back to `key` mode once convenient.

| Credential ID (default) | Type                          | Purpose                                                                                       | Used when                                                      |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `airepro2-vps-password` | Secret text                   | The `airepro2` SSH password                                                                   | `SSH_AUTH_MODE=password`                                       |
| `airepro2-vps-ssh`      | SSH Username with private key | Deploys to `airepro2@122.180.85.70` (username `airepro2`, private key authorized on that VPS) | `SSH_AUTH_MODE=key`                                            |
| `airepro-dkim-private`  | Secret file                   | `dkim/airepro.solutions.private` (gitignored)                                                 | always (optional — falls back to a file already on the target) |

The **Credentials Binding** plugin must be installed (provides the `string`/`file` bindings); the **SSH Credentials** plugin is only needed for `key` mode (`sshUserPrivateKey`).

**Agent-side tools required:**

- `password` mode: `sshpass` on a Unix agent, or PuTTY's `plink.exe`/`pscp.exe` (on `PATH`) on a Windows agent.
- `key` mode: a plain `ssh`/`scp` client (OpenSSH) on either OS.

### Pipeline job

1. Pipeline from SCM → this repo, script path `Jenkinsfile`
2. Add credential `airepro2-vps-password` (kind: **Secret text**, value = the `airepro2` password)
3. Agent OS auto-detected (`sh` / `powershell`) — the agent just needs the SSH tooling above, not Docker
4. Ensure Docker is installed on the **target VPS** and the `airepro2` user can run `docker` (add to the `docker` group)
5. First build: upload `airepro-dkim-private`, or pre-create `/opt/email/dkim/airepro.solutions.private` on the target

Parameters: `DEPLOY_HOST` default `airepro2@122.180.85.70`, `SSH_AUTH_MODE` default `password`, `SSH_PASSWORD_CREDENTIAL_ID` default `airepro2-vps-password`, `SSH_CREDENTIAL_ID` default `airepro2-vps-ssh`, `DEPLOY_PATH` default `/opt/email`.

SMTP is exposed on the target VPS as **host port 2525** (mapped to the container's port 25). Open inbound `2525/tcp` only if something outside the VPS submits mail directly to this port.

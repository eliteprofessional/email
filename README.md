# BillionMail server deployment

Mail host: **`mail.airepro.solutions`**  
Sending domain: **`airepro.solutions`**  
VPS: **`root@195.211.46.238`**  
Install path: **`/opt/BillionMail`**  
Repo: `git@github.com:eliteprofessional/email.git` (branch `BillionMail`)

BillionMail runs as Docker Compose on that VPS. Jenkins, when used, SSHes in as `root` and starts the stack there. It does not run the containers on the Jenkins agent.

## DNS (Cloudflare, zone `airepro.solutions`)

Every mail record must be **DNS only** (grey cloud). Do not orange-cloud `mail`. Do not put `mail.airepro.solutions` on an HTTP tunnel. SMTP is not HTTP, and the admin UI uses ports 80 and 443 on the same hostname. Proxying that name breaks mail.

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| **A** | `mail` | `195.211.46.238` | DNS only |
| **MX** | `@` | `mail.airepro.solutions` | Priority **10** |
| **TXT** | `@` | `v=spf1 +a +mx +ip4:195.211.46.238 -all` | — |
| **TXT** | `_dmarc` | `v=DMARC1;p=quarantine;rua=mailto:admin@airepro.solutions` | — |
| **TXT** | `default._domainkey` | `v=DKIM1; k=rsa; p=…` | — | Add after the first deploy (see DKIM below) |

Leave website `@` / `www` records alone. They are not required for mail.

Remove the previous mail IP **`122.180.85.70`** from the **A** record and from SPF. After `default._domainkey` is published and a test shows `dkim=pass`, delete the old **TXT** `mail._domainkey` (selector `mail`, used by the previous Postfix). BillionMail signs with selector **`default`**.

### PTR (not in Cloudflare)

Set this in the VPS provider panel:

```text
195.211.46.238  →  mail.airepro.solutions
```

SPF, the `mail` A record, and PTR must all use this same IP and hostname.

### Check DNS

```bash
nslookup mail.airepro.solutions 1.1.1.1
nslookup -type=MX airepro.solutions 1.1.1.1
nslookup -type=TXT airepro.solutions 1.1.1.1
nslookup -type=TXT _dmarc.airepro.solutions 1.1.1.1
nslookup -type=TXT default._domainkey.airepro.solutions 1.1.1.1
```

## Firewall on `195.211.46.238`

| Direction | Port | Purpose |
|-----------|------|---------|
| Inbound | **25** | SMTP delivery |
| Inbound | **465**, **587** | SMTPS and submission |
| Inbound | **80**, **443** | Admin UI and certificates |
| Inbound | **143**, **993**, **110**, **995** | IMAP/POP only if mailboxes are used |
| Inbound | **22** | SSH |
| Outbound | **25** | Sending mail to other servers |
| Localhost only | **25432**, **26379** | Postgres and Redis. Do not publish these |

```bash
ufw allow OpenSSH
ufw allow 25/tcp
ufw allow 465/tcp
ufw allow 587/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 143/tcp
ufw allow 993/tcp
ufw allow 110/tcp
ufw allow 995/tcp
ufw enable
```

## 1. Prepare the VPS

SSH in:

```bash
ssh root@195.211.46.238
```

Install Docker (Ubuntu/Debian):

```bash
apt update
apt install -y docker.io docker-compose-v2 git
systemctl enable --now docker
docker compose version
```

## 2. Install the app

```bash
mkdir -p /opt/BillionMail
cd /opt
git clone -b BillionMail git@github.com:eliteprofessional/email.git BillionMail
cd /opt/BillionMail
```

If the directory already exists, update it without deleting data:

```bash
cd /opt/BillionMail
git fetch origin BillionMail
git checkout BillionMail
git pull --ff-only origin BillionMail
```

Do not delete these directories. They hold the database, mailboxes, DKIM keys, certificates, and logs:

`postgresql-data`, `redis-data`, `rspamd-data`, `vmail-data`, `postfix-data`, `core-data`, `webmail-data`, `logs`, `ssl`, `ssl-self-signed`

## 3. Environment file

On the first install, copy the template and set the mail hostname. If `.env` already exists, do not replace it. Passwords and `SafePath` live there.

```bash
cd /opt/BillionMail
cp env_init .env
sed -i 's/^BILLIONMAIL_HOSTNAME=.*/BILLIONMAIL_HOSTNAME=mail.airepro.solutions/' .env
```

`BILLIONMAIL_HOSTNAME` must be `mail.airepro.solutions`. That value is Postfix `myhostname`.

Redis is started by `conf/redis/redis-conf.sh`. A Windows checkout can save that file with CRLF and the container will crash-loop. On the VPS:

```bash
sed -i 's/\r$//' /opt/BillionMail/conf/redis/redis-conf.sh
```

## 4. Start the stack

```bash
cd /opt/BillionMail
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

Container names (project name `billionmail` in `docker-compose.yml`):

| Container | Role |
|-----------|------|
| `billionmail-core-billionmail-1` | Admin UI on ports 80 and 443 |
| `billionmail-postfix-billionmail-1` | SMTP 25, 465, 587 |
| `billionmail-dovecot-billionmail-1` | IMAP and POP |
| `billionmail-pgsql-billionmail-1` | Postgres on `127.0.0.1:25432` |
| `billionmail-redis-billionmail-1` | Redis on `127.0.0.1:26379` |
| `billionmail-rspamd-billionmail-1` | Spam filter and DKIM |
| `billionmail-webmail-billionmail-1` | Roundcube |

Healthy check:

```bash
docker inspect -f '{{.State.Status}}' billionmail-core-billionmail-1
curl -fsS http://127.0.0.1/ | grep -o BillionMail
docker exec billionmail-postfix-billionmail-1 postconf myhostname
docker logs billionmail-redis-billionmail-1 --tail 20
```

`postconf` must print `myhostname = mail.airepro.solutions`. Redis logs must not repeat `/redis-conf.sh: line 2: not found`.

## 5. Log in and add the domain

Open the safe path first. It sets the session. Without it, login returns `access denied`.

```text
http://195.211.46.238/billion
```

Default values from `env_init` (change them in `.env` before the first start if this server is public):

| Setting | Default |
|---------|---------|
| Username | `billion` |
| Password | `billion` |
| Safe path | `billion` |

In the UI, add sending domain **`airepro.solutions`** with hostname **`mail.airepro.solutions`**.

Webmail, after the stack is up: `http://195.211.46.238/roundcube/`.

## 6. DKIM

BillionMail creates the key when the domain exists. The private key stays in the `rspamd-data` volume. Do not generate a second key if Cloudflare already has this one.

```bash
docker exec billionmail-rspamd-billionmail-1 cat /var/lib/rspamd/dkim/airepro.solutions/default.pub
```

Publish that file as one Cloudflare TXT record on **`default._domainkey`**, starting at `v=DKIM1`. Then send a test and confirm `dkim=pass` before removing `mail._domainkey`.

## 7. Jenkins

[`Jenkinsfile`](Jenkinsfile) checks out this repo on the Jenkins agent, then SSHes to the VPS. The agent needs an SSH key that `root@195.211.46.238` accepts. Docker is required on the VPS, not on the agent.

Job: Pipeline from SCM, repository `git@github.com:eliteprofessional/email.git`, branch `BillionMail`, script path `Jenkinsfile`.

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `DEPLOY_HOST` | `root@195.211.46.238` | SSH target |
| `DEPLOY_PATH` | `/opt/BillionMail` | Install directory |
| `SSH_CREDENTIAL_ID` | empty | Jenkins “SSH Username with private key” credential. Empty uses the agent’s default key |
| `FORCE_RECREATE` | false | `docker compose up -d --force-recreate` |

What the job does:

1. Sync the repo to `/opt/BillionMail`.
2. Leave an existing `.env` in place. If `.env` is missing, copy `env_init` and set `BILLIONMAIL_HOSTNAME=mail.airepro.solutions`.
3. Skip mail data, certificates, logs, and DKIM material so a deploy does not wipe them.
4. Strip CR from `conf/redis/redis-conf.sh`.
5. `docker compose pull` and `docker compose up -d`.
6. Smoke-check that the core container is running, `http://127.0.0.1/` contains `BillionMail`, and Postfix `myhostname` is `mail.airepro.solutions`.

## 8. Update later

From Jenkins, run the pipeline again. From the VPS:

```bash
cd /opt/BillionMail
git pull --ff-only origin BillionMail
sed -i 's/\r$//' conf/redis/redis-conf.sh
docker compose pull
docker compose up -d
docker compose ps
```

Do not copy a new `.env` over the server file.

## What not to do

- Do not orange-cloud or tunnel `mail.airepro.solutions`.
- Do not commit `.env`, `conf/postfix/conf/sasl_passwd`, or the data directories. They are local to the VPS.
- Do not set `myhostname` to `localhost`. It must stay `mail.airepro.solutions`.
- Do not keep SPF or the `mail` A record on `122.180.85.70` after cutover.

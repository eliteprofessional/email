pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(
      name: 'DEPLOY_HOST',
      defaultValue: 'airepro2@122.180.85.70',
      description: 'user@host for the BillionMail VPS (Jenkins deploys over SSH)'
    )
    choice(
      name: 'SSH_AUTH_MODE',
      choices: ['password', 'key'],
      description: 'How Jenkins authenticates to DEPLOY_HOST. "password" uses SSH_PASSWORD_CREDENTIAL_ID. "key" uses SSH_CREDENTIAL_ID (SSH Username with private key).'
    )
    string(
      name: 'SSH_PASSWORD_CREDENTIAL_ID',
      defaultValue: 'airepro2-vps-password',
      description: 'Secret text credential holding the DEPLOY_HOST SSH password (used when SSH_AUTH_MODE=password)'
    )
    string(
      name: 'SSH_CREDENTIAL_ID',
      defaultValue: 'airepro2-vps-ssh',
      description: '"SSH Username with private key" credential authorized on DEPLOY_HOST (used when SSH_AUTH_MODE=key)'
    )
    string(
      name: 'DEPLOY_PATH',
      defaultValue: '/opt/BillionMail',
      description: 'Install path on the VPS'
    )
    booleanParam(
      name: 'FORCE_RECREATE',
      defaultValue: false,
      description: 'docker compose up -d --force-recreate'
    )
  }

  environment {
    COMPOSE_PROJECT_NAME = 'billionmail'
    MAIL_HOSTNAME = 'mail.airepro.solutions'
    SERVER_IP = '122.180.85.70'
    SSH_OPTS = '-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Detect agent OS') {
      steps {
        script {
          echo "Jenkins agent OS: ${isUnix() ? 'Linux/Unix → sh' : 'Windows → powershell'}"
          echo "Remote deploy over SSH (${params.SSH_AUTH_MODE} auth) to ${params.DEPLOY_HOST}:${params.DEPLOY_PATH}"
        }
      }
    }

    stage('Validate compose') {
      steps {
        script {
          if (isUnix()) {
            sh '''
              set -eu
              test -f docker-compose.yml
              echo "docker-compose.yml present"
            '''
          } else {
            powershell '''
              if (-not (Test-Path 'docker-compose.yml')) { throw 'docker-compose.yml not found' }
              Write-Host 'docker-compose.yml present'
            '''
          }
        }
      }
    }

    stage('Sync to VPS') {
      steps {
        script {
          withCredentials(sshAuthCreds()) {
            if (isUnix()) {
              sh('''#!/bin/bash
                set -eu
                ''' + sshVarsUnix() + '''
                $SSH "$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH'"
                if command -v rsync >/dev/null 2>&1; then
                  rsync -a --delete -e "$RSH" \
                    --exclude '.git/' \
                    --exclude 'node_modules/' \
                    --exclude '.env' \
                    --exclude 'postgresql-data/' \
                    --exclude 'postgresql-socket/' \
                    --exclude 'redis-data/' \
                    --exclude 'rspamd-data/' \
                    --exclude 'vmail-data/' \
                    --exclude 'postfix-data/' \
                    --exclude 'core-data/' \
                    --exclude 'webmail-data/' \
                    --exclude 'logs/' \
                    --exclude 'ssl/' \
                    --exclude 'ssl-self-signed/' \
                    --exclude 'php-sock/' \
                    --exclude 'backup/' \
                    --exclude 'billionmail.conf' \
                    --exclude 'conf/postfix/sql/' \
                    --exclude 'conf/postfix/conf/extra.cf' \
                    --exclude 'conf/postfix/conf/vmail_ssl.map' \
                    --exclude 'conf/postfix/conf/vmail_ssl.map.db' \
                    --exclude 'conf/core/fail2ban/' \
                    --exclude 'conf/dovecot/conf.d/dovecot-sql.conf.ext' \
                    --exclude 'conf/dovecot/conf.d/extra.cf' \
                    --exclude 'conf/rspamd/local.d/dkim_signing.conf' \
                    --exclude 'conf/rspamd/local.d/redis.conf' \
                    ./ "$DEPLOY_HOST:$DEPLOY_PATH/"
                else
                  tar -cf - \
                    --exclude=.git \
                    --exclude=node_modules \
                    --exclude=.env \
                    --exclude=postgresql-data \
                    --exclude=postgresql-socket \
                    --exclude=redis-data \
                    --exclude=rspamd-data \
                    --exclude=vmail-data \
                    --exclude=postfix-data \
                    --exclude=core-data \
                    --exclude=webmail-data \
                    --exclude=logs \
                    --exclude=ssl \
                    --exclude=ssl-self-signed \
                    --exclude=php-sock \
                    --exclude=backup \
                    --exclude=billionmail.conf \
                    . | $SSH "$DEPLOY_HOST" "tar -xf - -C '$DEPLOY_PATH'"
                fi
                echo "Synced to ${DEPLOY_HOST}:${DEPLOY_PATH}"
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                Invoke-RemoteSsh @('mkdir', '-p', "'$deployPath'")

                $stage = Join-Path $env:TEMP ("billionmail-" + [guid]::NewGuid())
                New-Item -ItemType Directory -Path $stage | Out-Null
                try {
                  $skip = @(
                    '.git', 'node_modules', '.env',
                    'postgresql-data', 'postgresql-socket', 'redis-data', 'rspamd-data',
                    'vmail-data', 'postfix-data', 'core-data', 'webmail-data',
                    'logs', 'ssl', 'ssl-self-signed', 'php-sock', 'backup', 'billionmail.conf'
                  )
                  Get-ChildItem -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
                    Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
                  }
                  $tar = Join-Path $env:TEMP ("billionmail-" + [guid]::NewGuid() + '.tar')
                  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
                    throw 'tar is required on the Windows agent to sync the repo'
                  }
                  & tar -cf $tar -C $stage .
                  if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
                  Invoke-RemoteScp $tar "${deployHost}:/tmp/billionmail-src.tar"
                  Invoke-RemoteSsh @("tar -xf /tmp/billionmail-src.tar -C '$deployPath' && rm -f /tmp/billionmail-src.tar")
                  Remove-Item $tar -Force -ErrorAction SilentlyContinue
                } finally {
                  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
                }
                Write-Host "Synced to ${deployHost}:${deployPath}"
              ''')
            }
          }
        }
      }
    }

    stage('Docker compose up') {
      steps {
        script {
          withCredentials(sshAuthCreds()) {
            if (isUnix()) {
              sh('''#!/bin/bash
                set -eu
                ''' + sshVarsUnix() + '''
                $SSH "$DEPLOY_HOST" "DEPLOY_PATH='${DEPLOY_PATH}' MAIL_HOSTNAME='${MAIL_HOSTNAME}' FORCE_RECREATE='${FORCE_RECREATE}' bash -s" <<'REMOTE'
set -eu
cd "${DEPLOY_PATH}"
if [ ! -f .env ]; then
  cp env_init .env
  sed -i "s/^BILLIONMAIL_HOSTNAME=.*/BILLIONMAIL_HOSTNAME=${MAIL_HOSTNAME}/" .env
  echo "Created .env with BILLIONMAIL_HOSTNAME=${MAIL_HOSTNAME}"
else
  echo "Keeping existing .env"
fi
sed -i 's/\r$//' conf/redis/redis-conf.sh
if [ ! -f .env ]; then
  echo "ERROR: .env missing."
  exit 1
fi
UP_FLAGS="-d"
if [ "${FORCE_RECREATE}" = "true" ]; then UP_FLAGS="-d --force-recreate"; fi
docker compose -f docker-compose.yml config >/dev/null
docker compose pull
docker compose up ${UP_FLAGS}
docker compose ps
docker logs billionmail-core-billionmail-1 --tail 40 || true
REMOTE
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                $remote = @"
set -eu
cd "$($env:DEPLOY_PATH)"
if [ ! -f .env ]; then
  cp env_init .env
  sed -i "s/^BILLIONMAIL_HOSTNAME=.*/BILLIONMAIL_HOSTNAME=$($env:MAIL_HOSTNAME)/" .env
  echo "Created .env with BILLIONMAIL_HOSTNAME=$($env:MAIL_HOSTNAME)"
else
  echo "Keeping existing .env"
fi
sed -i 's/\r$//' conf/redis/redis-conf.sh
UP_FLAGS="-d"
if [ "$($env:FORCE_RECREATE)" = "true" ]; then UP_FLAGS="-d --force-recreate"; fi
docker compose -f docker-compose.yml config >/dev/null
docker compose pull
docker compose up `$UP_FLAGS
docker compose ps
docker logs billionmail-core-billionmail-1 --tail 40 || true
"@
                Invoke-RemoteBash $remote
              ''')
            }
          }
        }
      }
    }

    stage('Smoke check') {
      steps {
        script {
          withCredentials(sshAuthCreds()) {
            if (isUnix()) {
              sh('''#!/bin/bash
                set -eu
                ''' + sshVarsUnix() + '''
                $SSH "$DEPLOY_HOST" "MAIL_HOSTNAME='${MAIL_HOSTNAME}' bash -s" <<'REMOTE'
set -eu
docker inspect -f '{{.State.Status}}' billionmail-core-billionmail-1 | grep -q running
curl -fsS http://127.0.0.1/ | grep -q BillionMail
docker exec billionmail-postfix-billionmail-1 postconf myhostname | grep -F -q "${MAIL_HOSTNAME}"
echo "Smoke OK: core running, HTTP title BillionMail, myhostname ${MAIL_HOSTNAME}"
REMOTE
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                $remote = @"
set -eu
docker inspect -f '{{.State.Status}}' billionmail-core-billionmail-1 | grep -q running
curl -fsS http://127.0.0.1/ | grep -q BillionMail
docker exec billionmail-postfix-billionmail-1 postconf myhostname | grep -F -q "$($env:MAIL_HOSTNAME)"
echo "Smoke OK on VPS"
"@
                Invoke-RemoteBash $remote
              ''')
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo "BillionMail deployed to ${params.DEPLOY_HOST}:${params.DEPLOY_PATH}. Point DNS A/SPF/PTR at ${env.SERVER_IP}. Panel: http://${env.SERVER_IP}/billion"
    }
    failure {
      script {
        def authHint = params.SSH_AUTH_MODE == 'password'
          ? "Secret text credential '${params.SSH_PASSWORD_CREDENTIAL_ID}' with the ${params.DEPLOY_HOST} password"
          : "SSH credential '${params.SSH_CREDENTIAL_ID}' authorized on ${params.DEPLOY_HOST}"
        echo "Deploy failed. Needs: ${authHint}, Docker on the target VPS, and write access to ${params.DEPLOY_PATH}."
      }
    }
  }
}

// ---- SSH auth helpers (password today, private key later — see SSH_AUTH_MODE) ----

def sshAuthCreds() {
  if (params.SSH_AUTH_MODE == 'password') {
    return [string(credentialsId: params.SSH_PASSWORD_CREDENTIAL_ID, variable: 'SSHPASS')]
  }
  return [sshUserPrivateKey(credentialsId: params.SSH_CREDENTIAL_ID, keyFileVariable: 'SSH_KEY')]
}

def sshVarsUnix() {
  return '''
                if [ "$SSH_AUTH_MODE" = "password" ]; then
                  SSH="sshpass -e ssh $SSH_OPTS"
                  SCP="sshpass -e scp $SSH_OPTS"
                  RSH="sshpass -e ssh $SSH_OPTS"
                else
                  SSH="ssh -i $SSH_KEY $SSH_OPTS"
                  SCP="scp -i $SSH_KEY $SSH_OPTS"
                  RSH="ssh -i $SSH_KEY $SSH_OPTS"
                fi
'''
}

def sshVarsWindows() {
  return '''
                $ErrorActionPreference = 'Stop'
                $sshOpts = $env:SSH_OPTS -split ' '
                $deployHost = $env:DEPLOY_HOST
                $deployPath = $env:DEPLOY_PATH
                $usePassword = $env:SSH_AUTH_MODE -eq 'password'

                function Invoke-RemoteSsh([string[]]$remoteArgs) {
                  if ($usePassword) {
                    & plink -pw $env:SSHPASS -batch @sshOpts $deployHost @remoteArgs
                  } else {
                    & ssh -i $env:SSH_KEY @sshOpts $deployHost @remoteArgs
                  }
                  if ($LASTEXITCODE -ne 0) { throw "remote command failed: $remoteArgs" }
                }

                function Invoke-RemoteScp([string]$src, [string]$dst, [switch]$Recurse) {
                  $recurseFlag = @()
                  if ($Recurse.IsPresent) { $recurseFlag = @('-r') }
                  if ($usePassword) {
                    & pscp -pw $env:SSHPASS @sshOpts @recurseFlag $src $dst
                  } else {
                    & scp -i $env:SSH_KEY @sshOpts @recurseFlag $src $dst
                  }
                  if ($LASTEXITCODE -ne 0) { throw "remote copy failed: $src -> $dst" }
                }

                function Invoke-RemoteBash([string]$script) {
                  if ($usePassword) {
                    $script | & plink -pw $env:SSHPASS -batch @sshOpts $deployHost 'bash -s'
                  } else {
                    $script | & ssh -i $env:SSH_KEY @sshOpts $deployHost 'bash -s'
                  }
                  if ($LASTEXITCODE -ne 0) { throw 'remote bash script failed' }
                }
'''
}

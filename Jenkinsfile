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
      defaultValue: 'root@195.211.46.238',
      description: 'SSH target for the BillionMail VPS'
    )
    string(
      name: 'DEPLOY_PATH',
      defaultValue: '/opt/BillionMail',
      description: 'Install path on the VPS'
    )
    string(
      name: 'SSH_CREDENTIAL_ID',
      defaultValue: '',
      description: 'Optional Jenkins SSH private key credential. Empty uses the agent default key for root@195.211.46.238'
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
    SERVER_IP = '195.211.46.238'
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
          echo "Remote deploy: ${params.DEPLOY_HOST}:${params.DEPLOY_PATH}"
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
          def cred = params.SSH_CREDENTIAL_ID?.trim()
          def sync = {
            if (isUnix()) {
              sh '''
                set -eu
                SSH_OPTS="-o StrictHostKeyChecking=accept-new"
                if [ -n "${SSH_KEY:-}" ]; then
                  SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY} -o IdentitiesOnly=yes"
                fi
                ssh ${SSH_OPTS} "${DEPLOY_HOST}" "mkdir -p '${DEPLOY_PATH}'"
                if command -v rsync >/dev/null 2>&1; then
                  rsync -a --delete -e "ssh ${SSH_OPTS}" \
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
                    ./ "${DEPLOY_HOST}:${DEPLOY_PATH}/"
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
                    . | ssh ${SSH_OPTS} "${DEPLOY_HOST}" "tar -xf - -C '${DEPLOY_PATH}'"
                fi
                echo "Synced to ${DEPLOY_HOST}:${DEPLOY_PATH}"
              '''
            } else {
              powershell '''
                $ErrorActionPreference = 'Stop'
                $sshOpts = @('-o', 'StrictHostKeyChecking=accept-new')
                if ($env:SSH_KEY) { $sshOpts += @('-i', $env:SSH_KEY, '-o', 'IdentitiesOnly=yes') }
                & ssh @sshOpts $env:DEPLOY_HOST "mkdir -p '$($env:DEPLOY_PATH)'"
                if ($LASTEXITCODE -ne 0) { throw 'ssh mkdir failed' }

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
                  if (Get-Command tar -ErrorAction SilentlyContinue) {
                    & tar -cf $tar -C $stage .
                    if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
                    & scp @sshOpts $tar "$($env:DEPLOY_HOST):/tmp/billionmail-src.tar"
                    if ($LASTEXITCODE -ne 0) { throw 'scp failed' }
                    & ssh @sshOpts $env:DEPLOY_HOST "tar -xf /tmp/billionmail-src.tar -C '$($env:DEPLOY_PATH)' && rm -f /tmp/billionmail-src.tar"
                    if ($LASTEXITCODE -ne 0) { throw 'remote untar failed' }
                    Remove-Item $tar -Force -ErrorAction SilentlyContinue
                  } else {
                    throw 'tar is required on the Windows agent to sync the repo'
                  }
                } finally {
                  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
                }
                Write-Host "Synced to $($env:DEPLOY_HOST):$($env:DEPLOY_PATH)"
              '''
            }
          }
          if (cred) {
            withCredentials([sshUserPrivateKey(credentialsId: cred, keyFileVariable: 'SSH_KEY')]) {
              sync()
            }
          } else {
            sync()
          }
        }
      }
    }

    stage('Docker compose up') {
      steps {
        script {
          def cred = params.SSH_CREDENTIAL_ID?.trim()
          def up = {
            if (isUnix()) {
              sh '''
                set -eu
                SSH_OPTS="-o StrictHostKeyChecking=accept-new"
                if [ -n "${SSH_KEY:-}" ]; then
                  SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY} -o IdentitiesOnly=yes"
                fi
                ssh ${SSH_OPTS} "${DEPLOY_HOST}" "DEPLOY_PATH='${DEPLOY_PATH}' MAIL_HOSTNAME='${MAIL_HOSTNAME}' FORCE_RECREATE='${FORCE_RECREATE}' bash -s" <<'REMOTE'
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
              '''
            } else {
              powershell '''
                $ErrorActionPreference = 'Stop'
                $sshOpts = @('-o', 'StrictHostKeyChecking=accept-new')
                if ($env:SSH_KEY) { $sshOpts += @('-i', $env:SSH_KEY, '-o', 'IdentitiesOnly=yes') }
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
                $remote | & ssh @sshOpts $env:DEPLOY_HOST 'bash -s'
                if ($LASTEXITCODE -ne 0) { throw 'remote docker compose up failed' }
              '''
            }
          }
          if (cred) {
            withCredentials([sshUserPrivateKey(credentialsId: cred, keyFileVariable: 'SSH_KEY')]) {
              up()
            }
          } else {
            up()
          }
        }
      }
    }

    stage('Smoke check') {
      steps {
        script {
          def cred = params.SSH_CREDENTIAL_ID?.trim()
          def smoke = {
            if (isUnix()) {
              sh '''
                set -eu
                SSH_OPTS="-o StrictHostKeyChecking=accept-new"
                if [ -n "${SSH_KEY:-}" ]; then
                  SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY} -o IdentitiesOnly=yes"
                fi
                ssh ${SSH_OPTS} "${DEPLOY_HOST}" "MAIL_HOSTNAME='${MAIL_HOSTNAME}' bash -s" <<'REMOTE'
set -eu
docker inspect -f '{{.State.Status}}' billionmail-core-billionmail-1 | grep -q running
curl -fsS http://127.0.0.1/ | grep -q BillionMail
docker exec billionmail-postfix-billionmail-1 postconf myhostname | grep -F -q "${MAIL_HOSTNAME}"
echo "Smoke OK: core running, HTTP title BillionMail, myhostname ${MAIL_HOSTNAME}"
REMOTE
              '''
            } else {
              powershell '''
                $ErrorActionPreference = 'Stop'
                $sshOpts = @('-o', 'StrictHostKeyChecking=accept-new')
                if ($env:SSH_KEY) { $sshOpts += @('-i', $env:SSH_KEY, '-o', 'IdentitiesOnly=yes') }
                $remote = @"
set -eu
docker inspect -f '{{.State.Status}}' billionmail-core-billionmail-1 | grep -q running
curl -fsS http://127.0.0.1/ | grep -q BillionMail
docker exec billionmail-postfix-billionmail-1 postconf myhostname | grep -F -q "$($env:MAIL_HOSTNAME)"
echo "Smoke OK on VPS"
"@
                $remote | & ssh @sshOpts $env:DEPLOY_HOST 'bash -s'
                if ($LASTEXITCODE -ne 0) { throw 'remote smoke check failed' }
              '''
            }
          }
          if (cred) {
            withCredentials([sshUserPrivateKey(credentialsId: cred, keyFileVariable: 'SSH_KEY')]) {
              smoke()
            }
          } else {
            smoke()
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
      echo "Deploy to ${params.DEPLOY_HOST} failed. The Jenkins agent needs SSH as root to 195.211.46.238, and that VPS needs Docker and write access to DEPLOY_PATH."
    }
  }
}

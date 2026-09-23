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
      defaultValue: '122.180.85.70',
      description: 'VPS public IP or hostname for Postfix'
    )
    string(
      name: 'DEPLOY_USER',
      defaultValue: 'root',
      description: 'SSH user on the VPS'
    )
    string(
      name: 'DEPLOY_PATH',
      defaultValue: '/opt/email',
      description: 'Remote directory for this repo'
    )
    string(
      name: 'SSH_CREDENTIALS_ID',
      defaultValue: 'vps-ssh-key',
      description: 'Jenkins SSH username-with-private-key credential ID'
    )
    string(
      name: 'DKIM_PRIVATE_CREDENTIAL_ID',
      defaultValue: 'airepro-dkim-private',
      description: 'Optional Jenkins Secret file for dkim/airepro.solutions.private (first deploy)'
    )
    booleanParam(
      name: 'FORCE_RECREATE',
      defaultValue: false,
      description: 'Run docker compose up -d --force-recreate on the VPS'
    )
  }

  environment {
    COMPOSE_PROJECT_NAME = 'email'
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
          env.AGENT_IS_UNIX = isUnix() ? 'true' : 'false'
          echo "Jenkins agent OS: ${isUnix() ? 'Linux/Unix → sh' : 'Windows → powershell'}"
        }
      }
    }

    stage('Validate compose') {
      steps {
        script {
          if (isUnix()) {
            sh '''
              set -e
              test -f docker-compose.yml
              echo "docker-compose.yml present"
              if command -v docker >/dev/null 2>&1; then
                docker compose -f docker-compose.yml config >/dev/null
                echo "docker compose config OK"
              else
                echo "docker not on agent — will validate on VPS"
              fi
            '''
          } else {
            powershell '''
              if (-not (Test-Path 'docker-compose.yml')) { throw 'docker-compose.yml not found' }
              Write-Host 'docker-compose.yml present'
              if (Get-Command docker -ErrorAction SilentlyContinue) {
                docker compose -f docker-compose.yml config | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
                Write-Host 'docker compose config OK'
              } else {
                Write-Host 'docker not on agent — will validate on VPS'
              }
            '''
          }
        }
      }
    }

    stage('Deploy to VPS') {
      steps {
        withCredentials([
          sshUserPrivateKey(
            credentialsId: "${params.SSH_CREDENTIALS_ID}",
            keyFileVariable: 'SSH_KEY',
            usernameVariable: 'SSH_USER_FROM_CRED'
          )
        ]) {
          script {
            if (isUnix()) {
              sh '''
                set -euo pipefail
                DEPLOY_USER="${DEPLOY_USER:-$SSH_USER_FROM_CRED}"
                REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
                SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

                echo "Deploying (Linux agent) → ${REMOTE}:${DEPLOY_PATH}"
                ssh ${SSH_OPTS} "${REMOTE}" "mkdir -p '${DEPLOY_PATH}/dkim'"

                STAGE="$(mktemp -d)"
                TAR="$(mktemp).tar"
                cleanup() { rm -rf "${STAGE}" "${TAR}"; }
                trap cleanup EXIT

                for item in * .[!.]* ..?*; do
                  [ -e "$item" ] || continue
                  case "$item" in .git|node_modules|.env) continue ;; esac
                  cp -a "$item" "${STAGE}/"
                done
                rm -f "${STAGE}/dkim/airepro.solutions.private" 2>/dev/null || true

                tar -cf "${TAR}" -C "${STAGE}" .
                scp ${SSH_OPTS} "${TAR}" "${REMOTE}:/tmp/email-deploy.tar"

                ssh ${SSH_OPTS} "${REMOTE}" "DEPLOY_PATH='${DEPLOY_PATH}' bash -s" <<'EOF'
set -euo pipefail
mkdir -p "${DEPLOY_PATH}"
if [ -f "${DEPLOY_PATH}/dkim/airepro.solutions.private" ]; then
  cp -a "${DEPLOY_PATH}/dkim/airepro.solutions.private" /tmp/airepro.solutions.private.bak
fi
tar -xf /tmp/email-deploy.tar -C "${DEPLOY_PATH}"
mkdir -p "${DEPLOY_PATH}/dkim"
if [ -f /tmp/airepro.solutions.private.bak ]; then
  mv /tmp/airepro.solutions.private.bak "${DEPLOY_PATH}/dkim/airepro.solutions.private"
  chmod 600 "${DEPLOY_PATH}/dkim/airepro.solutions.private" || true
fi
rm -f /tmp/email-deploy.tar
ls -la "${DEPLOY_PATH}" "${DEPLOY_PATH}/dkim" || true
EOF
              '''
            } else {
              powershell '''
                $ErrorActionPreference = 'Stop'
                $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
                $deployPath = $env:DEPLOY_PATH
                $remote = "${deployUser}@$($env:DEPLOY_HOST)"
                $key = $env:SSH_KEY
                $sshBase = @('-i', $key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')

                Write-Host "Deploying (Windows agent) → ${remote}:${deployPath}"
                & ssh @sshBase $remote "mkdir -p '${deployPath}/dkim'"
                if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed ($LASTEXITCODE)" }

                $stage = Join-Path $env:TEMP ("email-deploy-" + [guid]::NewGuid())
                $tar = Join-Path $env:TEMP ("email-deploy-" + [guid]::NewGuid() + '.tar')
                New-Item -ItemType Directory -Path $stage | Out-Null
                try {
                  Get-ChildItem -Force | Where-Object {
                    $_.Name -notin @('.git', 'node_modules') -and $_.Name -ne '.env'
                  } | ForEach-Object {
                    Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
                  }
                  $priv = Join-Path $stage 'dkim\\airepro.solutions.private'
                  if (Test-Path $priv) { Remove-Item $priv -Force }

                  Push-Location $stage
                  try {
                    & tar -cf $tar *
                    if ($LASTEXITCODE -ne 0) { throw "tar create failed ($LASTEXITCODE)" }
                  } finally { Pop-Location }

                  & scp @sshBase $tar "${remote}:/tmp/email-deploy.tar"
                  if ($LASTEXITCODE -ne 0) { throw "scp failed ($LASTEXITCODE)" }

                  @"
set -euo pipefail
DEPLOY_PATH='${deployPath}'
mkdir -p "\$DEPLOY_PATH"
if [ -f "\$DEPLOY_PATH/dkim/airepro.solutions.private" ]; then
  cp -a "\$DEPLOY_PATH/dkim/airepro.solutions.private" /tmp/airepro.solutions.private.bak
fi
tar -xf /tmp/email-deploy.tar -C "\$DEPLOY_PATH"
mkdir -p "\$DEPLOY_PATH/dkim"
if [ -f /tmp/airepro.solutions.private.bak ]; then
  mv /tmp/airepro.solutions.private.bak "\$DEPLOY_PATH/dkim/airepro.solutions.private"
  chmod 600 "\$DEPLOY_PATH/dkim/airepro.solutions.private" || true
fi
rm -f /tmp/email-deploy.tar
ls -la "\$DEPLOY_PATH" "\$DEPLOY_PATH/dkim" || true
"@ | & ssh @sshBase $remote 'bash -s'
                  if ($LASTEXITCODE -ne 0) { throw "remote extract failed ($LASTEXITCODE)" }
                } finally {
                  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
                  if (Test-Path $tar) { Remove-Item $tar -Force -ErrorAction SilentlyContinue }
                }
              '''
            }
          }
        }
      }
    }

    stage('Install DKIM private key') {
      steps {
        script {
          def credId = params.DKIM_PRIVATE_CREDENTIAL_ID?.trim()
          if (!credId) {
            echo 'No DKIM_PRIVATE_CREDENTIAL_ID — continuing; compose needs key already on VPS'
            return
          }
          try {
            withCredentials([
              sshUserPrivateKey(
                credentialsId: "${params.SSH_CREDENTIALS_ID}",
                keyFileVariable: 'SSH_KEY',
                usernameVariable: 'SSH_USER_FROM_CRED'
              ),
              file(credentialsId: credId, variable: 'DKIM_PRIVATE_FILE')
            ]) {
              if (isUnix()) {
                sh '''
                  set -euo pipefail
                  DEPLOY_USER="${DEPLOY_USER:-$SSH_USER_FROM_CRED}"
                  REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
                  DEST="${DEPLOY_PATH}/dkim/airepro.solutions.private"
                  SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
                  ssh ${SSH_OPTS} "${REMOTE}" "mkdir -p '${DEPLOY_PATH}/dkim'"
                  scp ${SSH_OPTS} "${DKIM_PRIVATE_FILE}" "${REMOTE}:${DEST}"
                  ssh ${SSH_OPTS} "${REMOTE}" "chmod 600 '${DEST}' || true"
                  echo "DKIM private key installed at ${DEST}"
                '''
              } else {
                powershell '''
                  $ErrorActionPreference = 'Stop'
                  $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
                  $remote = "${deployUser}@$($env:DEPLOY_HOST)"
                  $dest = "$($env:DEPLOY_PATH)/dkim/airepro.solutions.private"
                  $sshBase = @('-i', $env:SSH_KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')
                  & ssh @sshBase $remote "mkdir -p '$($env:DEPLOY_PATH)/dkim'"
                  & scp @sshBase $env:DKIM_PRIVATE_FILE "${remote}:${dest}"
                  if ($LASTEXITCODE -ne 0) { throw "scp DKIM failed ($LASTEXITCODE)" }
                  & ssh @sshBase $remote "chmod 600 '${dest}' || true"
                  Write-Host "DKIM private key installed at ${dest}"
                '''
              }
            }
          } catch (err) {
            echo "DKIM credential '${credId}' unavailable (${err}). Continuing — key must already exist on VPS."
          }
        }
      }
    }

    stage('Docker compose up') {
      steps {
        withCredentials([
          sshUserPrivateKey(
            credentialsId: "${params.SSH_CREDENTIALS_ID}",
            keyFileVariable: 'SSH_KEY',
            usernameVariable: 'SSH_USER_FROM_CRED'
          )
        ]) {
          script {
            if (isUnix()) {
              sh '''
                set -euo pipefail
                DEPLOY_USER="${DEPLOY_USER:-$SSH_USER_FROM_CRED}"
                REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
                SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
                UP_FLAGS="-d"
                if [ "${FORCE_RECREATE}" = "true" ]; then UP_FLAGS="-d --force-recreate"; fi

                ssh ${SSH_OPTS} "${REMOTE}" \
                  "DEPLOY_PATH='${DEPLOY_PATH}' UP_FLAGS='${UP_FLAGS}' bash -s" <<'EOF'
set -euo pipefail
cd "${DEPLOY_PATH}"
if [ ! -f dkim/airepro.solutions.private ]; then
  echo "ERROR: dkim/airepro.solutions.private missing on server."
  exit 1
fi
docker compose -f docker-compose.yml config >/dev/null
docker compose pull
docker compose up ${UP_FLAGS}
docker compose ps
docker logs airepro-postfix --tail 40
EOF
              '''
            } else {
              powershell '''
                $ErrorActionPreference = 'Stop'
                $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
                $remote = "${deployUser}@$($env:DEPLOY_HOST)"
                $path = $env:DEPLOY_PATH
                $upFlags = if ($env:FORCE_RECREATE -eq 'true') { '-d --force-recreate' } else { '-d' }
                $sshBase = @('-i', $env:SSH_KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')

                @"
set -euo pipefail
cd '$path'
if [ ! -f dkim/airepro.solutions.private ]; then
  echo 'ERROR: dkim/airepro.solutions.private missing on server.'
  exit 1
fi
docker compose -f docker-compose.yml config >/dev/null
docker compose pull
docker compose up $upFlags
docker compose ps
docker logs airepro-postfix --tail 40
"@ | & ssh @sshBase $remote 'bash -s'
                if ($LASTEXITCODE -ne 0) { throw "docker compose up failed ($LASTEXITCODE)" }
              '''
            }
          }
        }
      }
    }

    stage('Smoke check') {
      steps {
        withCredentials([
          sshUserPrivateKey(
            credentialsId: "${params.SSH_CREDENTIALS_ID}",
            keyFileVariable: 'SSH_KEY',
            usernameVariable: 'SSH_USER_FROM_CRED'
          )
        ]) {
          script {
            if (isUnix()) {
              sh '''
                set -euo pipefail
                DEPLOY_USER="${DEPLOY_USER:-$SSH_USER_FROM_CRED}"
                REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
                SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
                ssh ${SSH_OPTS} "${REMOTE}" bash -s <<'EOF'
set -euo pipefail
docker inspect -f '{{.State.Status}}' airepro-postfix | grep -q running
docker exec airepro-postfix postconf myhostname | grep -q mail.airepro.solutions
(ss -lnt 2>/dev/null || netstat -lnt) | grep -q ':2525'
echo "Smoke OK: airepro-postfix running, hostname OK, :2525 listening"
EOF
              '''
            } else {
              powershell '''
                $ErrorActionPreference = 'Stop'
                $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
                $remote = "${deployUser}@$($env:DEPLOY_HOST)"
                $sshBase = @('-i', $env:SSH_KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')
                @'
set -euo pipefail
docker inspect -f "{{.State.Status}}" airepro-postfix | grep -q running
docker exec airepro-postfix postconf myhostname | grep -q mail.airepro.solutions
(ss -lnt 2>/dev/null || netstat -lnt) | grep -q ":2525"
echo "Smoke OK: airepro-postfix running, hostname OK, :2525 listening"
'@ | & ssh @sshBase $remote 'bash -s'
                if ($LASTEXITCODE -ne 0) { throw "smoke check failed ($LASTEXITCODE)" }
              '''
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo "Deployed Postfix to ${params.DEPLOY_HOST}:${params.DEPLOY_PATH} (unix agent=${env.AGENT_IS_UNIX})"
    }
    failure {
      echo "Deploy failed. Pipeline auto-selects sh (Linux) or powershell (Windows). Need OpenSSH ssh/scp, vps-ssh-key, DKIM on VPS (or airepro-dkim-private), Docker on VPS."
    }
  }
}

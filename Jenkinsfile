pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(
      name: 'DEPLOY_PATH',
      defaultValue: '/opt/email',
      description: 'Install path on this VPS (Jenkins runs here too)'
    )
    string(
      name: 'DKIM_PRIVATE_CREDENTIAL_ID',
      defaultValue: 'airepro-dkim-private',
      description: 'Optional Secret file credential for dkim/airepro.solutions.private'
    )
    booleanParam(
      name: 'FORCE_RECREATE',
      defaultValue: false,
      description: 'docker compose up -d --force-recreate'
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
          echo 'Same-host deploy: no SSH. Docker Compose runs on this machine.'
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
              command -v docker >/dev/null
              docker compose -f docker-compose.yml config >/dev/null
              echo "docker compose config OK"
            '''
          } else {
            powershell '''
              if (-not (Test-Path 'docker-compose.yml')) { throw 'docker-compose.yml not found' }
              if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not found on agent' }
              docker compose -f docker-compose.yml config | Out-Null
              if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
              Write-Host 'docker compose config OK'
            '''
          }
        }
      }
    }

    stage('Install to deploy path') {
      steps {
        script {
          if (isUnix()) {
            sh '''
              set -euo pipefail
              mkdir -p "${DEPLOY_PATH}/dkim"

              # Preserve existing private key if present
              if [ -f "${DEPLOY_PATH}/dkim/airepro.solutions.private" ]; then
                cp -a "${DEPLOY_PATH}/dkim/airepro.solutions.private" /tmp/airepro.solutions.private.bak
              fi

              # Sync workspace into DEPLOY_PATH (exclude junk / local .env)
              if command -v rsync >/dev/null 2>&1; then
                rsync -a --delete \
                  --exclude '.git/' \
                  --exclude 'node_modules/' \
                  --exclude '.env' \
                  --exclude 'dkim/*.private' \
                  ./ "${DEPLOY_PATH}/"
              else
                STAGE="$(mktemp -d)"
                tar -cf - \
                  --exclude=.git \
                  --exclude=node_modules \
                  --exclude=.env \
                  --exclude='dkim/*.private' \
                  . | tar -xf - -C "${STAGE}"
                # replace contents carefully
                find "${DEPLOY_PATH}" -mindepth 1 -maxdepth 1 ! -name dkim -exec rm -rf {} +
                cp -a "${STAGE}/." "${DEPLOY_PATH}/"
                rm -rf "${STAGE}"
              fi

              mkdir -p "${DEPLOY_PATH}/dkim"
              if [ -f /tmp/airepro.solutions.private.bak ]; then
                mv /tmp/airepro.solutions.private.bak "${DEPLOY_PATH}/dkim/airepro.solutions.private"
                chmod 600 "${DEPLOY_PATH}/dkim/airepro.solutions.private" || true
              fi

              ls -la "${DEPLOY_PATH}" "${DEPLOY_PATH}/dkim" || true
            '''
          } else {
            powershell '''
              $ErrorActionPreference = 'Stop'
              $deployPath = $env:DEPLOY_PATH
              New-Item -ItemType Directory -Force -Path (Join-Path $deployPath 'dkim') | Out-Null

              $bak = Join-Path $env:TEMP 'airepro.solutions.private.bak'
              $existing = Join-Path $deployPath 'dkim\\airepro.solutions.private'
              if (Test-Path $existing) { Copy-Item $existing $bak -Force }

              $stage = Join-Path $env:TEMP ("email-local-" + [guid]::NewGuid())
              New-Item -ItemType Directory -Path $stage | Out-Null
              try {
                Get-ChildItem -Force | Where-Object {
                  $_.Name -notin @('.git', 'node_modules') -and $_.Name -ne '.env'
                } | ForEach-Object {
                  Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
                }
                $privStage = Join-Path $stage 'dkim\\airepro.solutions.private'
                if (Test-Path $privStage) { Remove-Item $privStage -Force }

                # Clear deploy path except we restore dkim private after
                if (Test-Path $deployPath) {
                  Get-ChildItem $deployPath -Force | ForEach-Object {
                    Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
                  }
                }
                New-Item -ItemType Directory -Force -Path $deployPath | Out-Null
                Copy-Item (Join-Path $stage '*') -Destination $deployPath -Recurse -Force

                New-Item -ItemType Directory -Force -Path (Join-Path $deployPath 'dkim') | Out-Null
                if (Test-Path $bak) {
                  Copy-Item $bak (Join-Path $deployPath 'dkim\\airepro.solutions.private') -Force
                }
              } finally {
                Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
              }
              Get-ChildItem $deployPath | Format-Table Name
            '''
          }
        }
      }
    }

    stage('Install DKIM private key') {
      steps {
        script {
          def credId = params.DKIM_PRIVATE_CREDENTIAL_ID?.trim()
          if (!credId) {
            echo 'No DKIM credential ID — continuing if key already exists under DEPLOY_PATH/dkim/'
            return
          }
          try {
            withCredentials([file(credentialsId: credId, variable: 'DKIM_PRIVATE_FILE')]) {
              if (isUnix()) {
                sh '''
                  set -euo pipefail
                  mkdir -p "${DEPLOY_PATH}/dkim"
                  cp "${DKIM_PRIVATE_FILE}" "${DEPLOY_PATH}/dkim/airepro.solutions.private"
                  chmod 600 "${DEPLOY_PATH}/dkim/airepro.solutions.private"
                  echo "DKIM private key installed"
                '''
              } else {
                powershell '''
                  $ErrorActionPreference = 'Stop'
                  $destDir = Join-Path $env:DEPLOY_PATH 'dkim'
                  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
                  Copy-Item $env:DKIM_PRIVATE_FILE (Join-Path $destDir 'airepro.solutions.private') -Force
                  Write-Host 'DKIM private key installed'
                '''
              }
            }
          } catch (err) {
            echo "DKIM credential '${credId}' unavailable (${err}). Continuing if file already on disk."
          }
        }
      }
    }

    stage('Docker compose up') {
      steps {
        script {
          if (isUnix()) {
            sh '''
              set -euo pipefail
              cd "${DEPLOY_PATH}"
              if [ ! -f dkim/airepro.solutions.private ]; then
                echo "ERROR: ${DEPLOY_PATH}/dkim/airepro.solutions.private missing."
                echo "Upload Jenkins secret airepro-dkim-private or copy the file once."
                exit 1
              fi
              UP_FLAGS="-d"
              if [ "${FORCE_RECREATE}" = "true" ]; then UP_FLAGS="-d --force-recreate"; fi
              docker compose -f docker-compose.yml config >/dev/null
              docker compose pull
              docker compose up ${UP_FLAGS}
              docker compose ps
              docker logs airepro-postfix --tail 40
            '''
          } else {
            powershell '''
              $ErrorActionPreference = 'Stop'
              Set-Location $env:DEPLOY_PATH
              $priv = Join-Path $env:DEPLOY_PATH 'dkim\\airepro.solutions.private'
              if (-not (Test-Path $priv)) {
                throw "DKIM private key missing at $priv"
              }
              $upFlags = if ($env:FORCE_RECREATE -eq 'true') { @('-d', '--force-recreate') } else { @('-d') }
              docker compose -f docker-compose.yml config | Out-Null
              if ($LASTEXITCODE -ne 0) { throw 'compose config failed' }
              docker compose pull
              docker compose up @upFlags
              if ($LASTEXITCODE -ne 0) { throw 'compose up failed' }
              docker compose ps
              docker logs airepro-postfix --tail 40
            '''
          }
        }
      }
    }

    stage('Smoke check') {
      steps {
        script {
          if (isUnix()) {
            sh '''
              set -euo pipefail
              docker inspect -f '{{.State.Status}}' airepro-postfix | grep -q running
              docker exec airepro-postfix postconf myhostname | grep -q mail.airepro.solutions
              (ss -lnt 2>/dev/null || netstat -lnt) | grep -q ':2525'
              echo "Smoke OK: airepro-postfix running, hostname OK, :2525 listening"
            '''
          } else {
            powershell '''
              $ErrorActionPreference = 'Stop'
              $status = docker inspect -f "{{.State.Status}}" airepro-postfix
              if ($status -ne 'running') { throw "container status=$status" }
              $hn = docker exec airepro-postfix postconf myhostname
              if ($hn -notmatch 'mail.airepro.solutions') { throw "bad hostname: $hn" }
              Write-Host 'Smoke OK: airepro-postfix running'
            '''
          }
        }
      }
    }
  }

  post {
    success {
      echo "Postfix deployed locally at ${params.DEPLOY_PATH} (same VPS as Jenkins)"
    }
    failure {
      echo "Deploy failed. Same-host mode needs: Docker on this VPS, write access to DEPLOY_PATH, and DKIM private key (credential airepro-dkim-private or file already in DEPLOY_PATH/dkim/)."
    }
  }
}

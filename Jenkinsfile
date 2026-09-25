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
      defaultValue: '/opt/postal',
      description: 'Install path on this VPS (Jenkins runs here too)'
    )
    string(
      name: 'COMPOSE_FILE',
      defaultValue: 'docker-compose.local.yml',
      description: 'Compose file used for deploy'
    )
    string(
      name: 'POSTAL_CONFIG_CREDENTIAL_ID',
      defaultValue: 'postal-config-yml',
      description: 'Optional Secret file credential for docker/local-config/postal.yml'
    )
    string(
      name: 'SIGNING_KEY_CREDENTIAL_ID',
      defaultValue: 'postal-signing-key',
      description: 'Optional Secret file credential for docker/local-config/signing.key'
    )
    booleanParam(
      name: 'FORCE_RECREATE',
      defaultValue: false,
      description: 'docker compose up -d --force-recreate'
    )
  }

  environment {
    COMPOSE_PROJECT_NAME = 'postal'
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
              test -f "${COMPOSE_FILE}"
              command -v docker >/dev/null
              docker compose -f "${COMPOSE_FILE}" config >/dev/null
              echo "docker compose config OK (${COMPOSE_FILE})"
            '''
          } else {
            powershell '''
              if (-not (Test-Path $env:COMPOSE_FILE)) { throw "$env:COMPOSE_FILE not found" }
              if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not found on agent' }
              docker compose -f $env:COMPOSE_FILE config | Out-Null
              if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
              Write-Host "docker compose config OK ($env:COMPOSE_FILE)"
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
              mkdir -p "${DEPLOY_PATH}/docker/local-config"

              # Preserve existing Postal config / signing key if present
              if [ -f "${DEPLOY_PATH}/docker/local-config/postal.yml" ]; then
                cp -a "${DEPLOY_PATH}/docker/local-config/postal.yml" /tmp/postal.yml.bak
              fi
              if [ -f "${DEPLOY_PATH}/docker/local-config/signing.key" ]; then
                cp -a "${DEPLOY_PATH}/docker/local-config/signing.key" /tmp/postal.signing.key.bak
              fi

              # Sync workspace into DEPLOY_PATH (exclude junk / secrets)
              if command -v rsync >/dev/null 2>&1; then
                rsync -a --delete \
                  --exclude '.git/' \
                  --exclude 'vendor/bundle/' \
                  --exclude 'node_modules/' \
                  --exclude 'tmp/' \
                  --exclude 'log/' \
                  --exclude '.env' \
                  --exclude '.env.*' \
                  --exclude 'docker/local-config/postal.yml' \
                  --exclude 'docker/local-config/signing.key' \
                  ./ "${DEPLOY_PATH}/"
              else
                STAGE="$(mktemp -d)"
                tar -cf - \
                  --exclude=.git \
                  --exclude=vendor/bundle \
                  --exclude=node_modules \
                  --exclude=tmp \
                  --exclude=log \
                  --exclude=.env \
                  --exclude='.env.*' \
                  --exclude='docker/local-config/postal.yml' \
                  --exclude='docker/local-config/signing.key' \
                  . | tar -xf - -C "${STAGE}"
                find "${DEPLOY_PATH}" -mindepth 1 -maxdepth 1 ! -name docker -exec rm -rf {} +
                cp -a "${STAGE}/." "${DEPLOY_PATH}/"
                rm -rf "${STAGE}"
              fi

              mkdir -p "${DEPLOY_PATH}/docker/local-config"
              if [ -f /tmp/postal.yml.bak ]; then
                mv /tmp/postal.yml.bak "${DEPLOY_PATH}/docker/local-config/postal.yml"
                chmod 600 "${DEPLOY_PATH}/docker/local-config/postal.yml" || true
              fi
              if [ -f /tmp/postal.signing.key.bak ]; then
                mv /tmp/postal.signing.key.bak "${DEPLOY_PATH}/docker/local-config/signing.key"
                chmod 600 "${DEPLOY_PATH}/docker/local-config/signing.key" || true
              fi

              ls -la "${DEPLOY_PATH}" "${DEPLOY_PATH}/docker/local-config" || true
            '''
          } else {
            powershell '''
              $ErrorActionPreference = 'Stop'
              $deployPath = $env:DEPLOY_PATH
              $configDir = Join-Path $deployPath 'docker\\local-config'
              New-Item -ItemType Directory -Force -Path $configDir | Out-Null

              $bakYml = Join-Path $env:TEMP 'postal.yml.bak'
              $bakKey = Join-Path $env:TEMP 'postal.signing.key.bak'
              $existingYml = Join-Path $configDir 'postal.yml'
              $existingKey = Join-Path $configDir 'signing.key'
              if (Test-Path $existingYml) { Copy-Item $existingYml $bakYml -Force }
              if (Test-Path $existingKey) { Copy-Item $existingKey $bakKey -Force }

              $stage = Join-Path $env:TEMP ("postal-local-" + [guid]::NewGuid())
              New-Item -ItemType Directory -Path $stage | Out-Null
              try {
                $exclude = @('.git', 'vendor', 'node_modules', 'tmp', 'log')
                Get-ChildItem -Force | Where-Object {
                  $_.Name -notin $exclude -and $_.Name -notlike '.env*'
                } | ForEach-Object {
                  Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
                }
                $stageYml = Join-Path $stage 'docker\\local-config\\postal.yml'
                $stageKey = Join-Path $stage 'docker\\local-config\\signing.key'
                if (Test-Path $stageYml) { Remove-Item $stageYml -Force }
                if (Test-Path $stageKey) { Remove-Item $stageKey -Force }

                if (Test-Path $deployPath) {
                  Get-ChildItem $deployPath -Force | ForEach-Object {
                    Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
                  }
                }
                New-Item -ItemType Directory -Force -Path $deployPath | Out-Null
                Copy-Item (Join-Path $stage '*') -Destination $deployPath -Recurse -Force

                New-Item -ItemType Directory -Force -Path $configDir | Out-Null
                if (Test-Path $bakYml) {
                  Copy-Item $bakYml (Join-Path $configDir 'postal.yml') -Force
                }
                if (Test-Path $bakKey) {
                  Copy-Item $bakKey (Join-Path $configDir 'signing.key') -Force
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

    stage('Install Postal secrets') {
      steps {
        script {
          installSecretFile(
            params.POSTAL_CONFIG_CREDENTIAL_ID?.trim(),
            'postal.yml',
            'Postal config (postal.yml)'
          )
          installSecretFile(
            params.SIGNING_KEY_CREDENTIAL_ID?.trim(),
            'signing.key',
            'Postal signing key'
          )
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
              if [ ! -f docker/local-config/postal.yml ]; then
                echo "ERROR: ${DEPLOY_PATH}/docker/local-config/postal.yml missing."
                echo "Upload Jenkins secret postal-config-yml or copy the file once."
                exit 1
              fi
              if [ ! -f docker/local-config/signing.key ]; then
                echo "ERROR: ${DEPLOY_PATH}/docker/local-config/signing.key missing."
                echo "Upload Jenkins secret postal-signing-key or copy the file once."
                exit 1
              fi
              UP_FLAGS="-d"
              if [ "${FORCE_RECREATE}" = "true" ]; then UP_FLAGS="-d --force-recreate"; fi
              docker compose -f "${COMPOSE_FILE}" config >/dev/null
              docker compose -f "${COMPOSE_FILE}" pull
              docker compose -f "${COMPOSE_FILE}" up ${UP_FLAGS}
              docker compose -f "${COMPOSE_FILE}" ps
            '''
          } else {
            powershell '''
              $ErrorActionPreference = 'Stop'
              Set-Location $env:DEPLOY_PATH
              $yml = Join-Path $env:DEPLOY_PATH 'docker\\local-config\\postal.yml'
              $key = Join-Path $env:DEPLOY_PATH 'docker\\local-config\\signing.key'
              if (-not (Test-Path $yml)) { throw "postal.yml missing at $yml" }
              if (-not (Test-Path $key)) { throw "signing.key missing at $key" }
              $upFlags = if ($env:FORCE_RECREATE -eq 'true') { @('-d', '--force-recreate') } else { @('-d') }
              docker compose -f $env:COMPOSE_FILE config | Out-Null
              if ($LASTEXITCODE -ne 0) { throw 'compose config failed' }
              docker compose -f $env:COMPOSE_FILE pull
              docker compose -f $env:COMPOSE_FILE up @upFlags
              if ($LASTEXITCODE -ne 0) { throw 'compose up failed' }
              docker compose -f $env:COMPOSE_FILE ps
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
              cd "${DEPLOY_PATH}"

              ready=""
              for i in $(seq 1 30); do
                web="$(docker compose -f "${COMPOSE_FILE}" ps --status running --services 2>/dev/null | grep -c '^postal-web$' || true)"
                smtp="$(docker compose -f "${COMPOSE_FILE}" ps --status running --services 2>/dev/null | grep -c '^postal-smtp$' || true)"
                if [ "$web" = "1" ] && [ "$smtp" = "1" ]; then
                  ready="1"
                  break
                fi
                sleep 2
              done
              if [ -z "$ready" ]; then
                echo "ERROR: postal-web / postal-smtp not running in time"
                docker compose -f "${COMPOSE_FILE}" ps || true
                docker compose -f "${COMPOSE_FILE}" logs --tail 40 || true
                exit 1
              fi

              (ss -lnt 2>/dev/null || netstat -lnt) | grep -q ':5000'
              (ss -lnt 2>/dev/null || netstat -lnt) | grep -q ':2525'
              echo "Smoke OK: postal-web + postal-smtp running, :5000 and :2525 listening"
            '''
          } else {
            powershell '''
              $ErrorActionPreference = 'Stop'
              Set-Location $env:DEPLOY_PATH
              $ready = $false
              for ($i = 1; $i -le 30; $i++) {
                $services = docker compose -f $env:COMPOSE_FILE ps --status running --services 2>$null
                if (($services -match '^postal-web$') -and ($services -match '^postal-smtp$')) {
                  $ready = $true
                  break
                }
                Start-Sleep -Seconds 2
              }
              if (-not $ready) {
                docker compose -f $env:COMPOSE_FILE ps
                throw 'postal-web / postal-smtp not running in time'
              }
              Write-Host 'Smoke OK: postal-web + postal-smtp running'
            '''
          }
        }
      }
    }
  }

  post {
    success {
      echo "Postal deployed locally at ${params.DEPLOY_PATH} (same VPS as Jenkins, compose ${params.COMPOSE_FILE})"
    }
    failure {
      echo "Deploy failed. Same-host mode needs: Docker on this VPS, write access to DEPLOY_PATH, and Postal secrets (credentials postal-config-yml / postal-signing-key or files already in DEPLOY_PATH/docker/local-config/)."
    }
  }
}

def installSecretFile(String credId, String destName, String label) {
  if (!credId) {
    echo "No credential ID for ${label} — continuing if file already exists under DEPLOY_PATH/docker/local-config/"
    return
  }
  try {
    withCredentials([file(credentialsId: credId, variable: 'SECRET_FILE')]) {
      if (isUnix()) {
        sh """
          set -euo pipefail
          mkdir -p "\${DEPLOY_PATH}/docker/local-config"
          cp "\${SECRET_FILE}" "\${DEPLOY_PATH}/docker/local-config/${destName}"
          chmod 600 "\${DEPLOY_PATH}/docker/local-config/${destName}"
          echo "${label} installed"
        """
      } else {
        powershell """
          \$ErrorActionPreference = 'Stop'
          \$destDir = Join-Path \$env:DEPLOY_PATH 'docker\\local-config'
          New-Item -ItemType Directory -Force -Path \$destDir | Out-Null
          Copy-Item \$env:SECRET_FILE (Join-Path \$destDir '${destName}') -Force
          Write-Host '${label} installed'
        """
      }
    }
  } catch (err) {
    echo "${label} credential '${credId}' unavailable (${err}). Continuing if file already on disk."
  }
}

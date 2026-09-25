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
      description: 'user@host for the target VPS (Jenkins deploys over SSH)'
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
      defaultValue: '/opt/postal',
      description: 'Install path on the target VPS'
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
          env.AGENT_IS_UNIX = isUnix() ? 'true' : 'false'
          echo "Jenkins agent OS: ${isUnix() ? 'Linux/Unix → sh' : 'Windows → powershell'}"
          echo "Remote deploy over SSH (${params.SSH_AUTH_MODE} auth) to ${params.DEPLOY_HOST}:${params.DEPLOY_PATH}"
        }
      }
    }

    stage('Sync to target VPS') {
      steps {
        script {
          withCredentials(sshAuthCreds()) {
            if (isUnix()) {
              sh('''#!/bin/bash
                set -euo pipefail
                ''' + sshVarsUnix() + '''

                $SSH "$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH/docker/local-config'"

                if command -v rsync >/dev/null 2>&1; then
                  rsync -az --delete \
                    -e "$RSH" \
                    --exclude '.git/' \
                    --exclude 'vendor/bundle/' \
                    --exclude 'node_modules/' \
                    --exclude 'tmp/' \
                    --exclude 'log/' \
                    --exclude '.env' \
                    --exclude '.env.*' \
                    --exclude 'docker/local-config/postal.yml' \
                    --exclude 'docker/local-config/signing.key' \
                    ./ "$DEPLOY_HOST:$DEPLOY_PATH/"
                else
                  TARBALL="$(mktemp)"
                  tar -czf "$TARBALL" \
                    --exclude=.git \
                    --exclude=vendor/bundle \
                    --exclude=node_modules \
                    --exclude=tmp \
                    --exclude=log \
                    --exclude=.env \
                    --exclude='.env.*' \
                    --exclude='docker/local-config/postal.yml' \
                    --exclude='docker/local-config/signing.key' \
                    .
                  $SCP "$TARBALL" "$DEPLOY_HOST:/tmp/postal-deploy.tar.gz"
                  rm -f "$TARBALL"
                  $SSH "$DEPLOY_HOST" "tar -xzf /tmp/postal-deploy.tar.gz -C '$DEPLOY_PATH' && rm -f /tmp/postal-deploy.tar.gz"
                fi

                $SSH "$DEPLOY_HOST" "ls -la '$DEPLOY_PATH' '$DEPLOY_PATH/docker/local-config'"
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                $stage = Join-Path $env:TEMP ("postal-deploy-" + [guid]::NewGuid())
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

                  Invoke-RemoteSsh @('mkdir', '-p', "'$deployPath/docker/local-config'")
                  Invoke-RemoteScp (Join-Path $stage '*') "${deployHost}:${deployPath}/" -Recurse
                } finally {
                  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
                }

                Invoke-RemoteSsh @('ls', '-la', "'$deployPath'")
              ''')
            }
          }
        }
      }
    }

    stage('Install Postal secrets') {
      steps {
        script {
          installRemoteSecretFile(
            params.POSTAL_CONFIG_CREDENTIAL_ID?.trim(),
            'postal.yml',
            'Postal config (postal.yml)'
          )
          installRemoteSecretFile(
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
          withCredentials(sshAuthCreds()) {
            def upFlags = params.FORCE_RECREATE ? '-d --force-recreate' : '-d'
            def composeFile = params.COMPOSE_FILE
            def remoteCmd = """
              set -euo pipefail
              trap 'rm -f "\$0"' EXIT
              cd '${params.DEPLOY_PATH}'
              if [ ! -f docker/local-config/postal.yml ]; then
                echo 'ERROR: ${params.DEPLOY_PATH}/docker/local-config/postal.yml missing.'
                echo 'Upload Jenkins secret ${params.POSTAL_CONFIG_CREDENTIAL_ID} or copy the file once.'
                exit 1
              fi
              if [ ! -f docker/local-config/signing.key ]; then
                echo 'ERROR: ${params.DEPLOY_PATH}/docker/local-config/signing.key missing.'
                echo 'Upload Jenkins secret ${params.SIGNING_KEY_CREDENTIAL_ID} or copy the file once.'
                exit 1
              fi
              docker compose -f '${composeFile}' config >/dev/null
              docker compose -f '${composeFile}' pull
              docker compose -f '${composeFile}' up ${upFlags}
              docker compose -f '${composeFile}' ps
            """.stripIndent()
            writeFile file: 'remote-deploy.sh', text: remoteCmd

            if (isUnix()) {
              sh('''#!/bin/bash
                set -euo pipefail
                ''' + sshVarsUnix() + '''

                $SCP remote-deploy.sh "$DEPLOY_HOST:/tmp/postal-remote-deploy.sh"
                $SSH "$DEPLOY_HOST" "bash /tmp/postal-remote-deploy.sh"
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                Invoke-RemoteScp 'remote-deploy.sh' "${deployHost}:/tmp/postal-remote-deploy.sh"
                Invoke-RemoteSsh @('bash', '/tmp/postal-remote-deploy.sh')
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
            def composeFile = params.COMPOSE_FILE
            def remoteCmd = """
              set -euo pipefail
              trap 'rm -f "\$0"' EXIT
              cd '${params.DEPLOY_PATH}'

              ready=""
              for i in \$(seq 1 30); do
                web="\$(docker compose -f '${composeFile}' ps --status running --services 2>/dev/null | grep -c '^postal-web\$' || true)"
                smtp="\$(docker compose -f '${composeFile}' ps --status running --services 2>/dev/null | grep -c '^postal-smtp\$' || true)"
                if [ "\$web" = "1" ] && [ "\$smtp" = "1" ]; then
                  ready="1"
                  break
                fi
                sleep 2
              done
              if [ -z "\$ready" ]; then
                echo "ERROR: postal-web / postal-smtp not running in time"
                docker compose -f '${composeFile}' ps || true
                docker compose -f '${composeFile}' logs --tail 40 || true
                exit 1
              fi

              (ss -lnt 2>/dev/null || netstat -lnt) | grep -q ':5000'
              (ss -lnt 2>/dev/null || netstat -lnt) | grep -q ':2525'
              echo "Smoke OK: postal-web + postal-smtp running, :5000 and :2525 listening"
            """.stripIndent()
            writeFile file: 'remote-smoke.sh', text: remoteCmd

            if (isUnix()) {
              sh('''#!/bin/bash
                set -euo pipefail
                ''' + sshVarsUnix() + '''

                $SCP remote-smoke.sh "$DEPLOY_HOST:/tmp/postal-remote-smoke.sh"
                $SSH "$DEPLOY_HOST" "bash /tmp/postal-remote-smoke.sh"
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                Invoke-RemoteScp 'remote-smoke.sh' "${deployHost}:/tmp/postal-remote-smoke.sh"
                Invoke-RemoteSsh @('bash', '/tmp/postal-remote-smoke.sh')
              ''')
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo "Postal deployed to ${params.DEPLOY_HOST}:${params.DEPLOY_PATH} over SSH (${params.SSH_AUTH_MODE} auth, web :5000 / smtp :2525)"
    }
    failure {
      script {
        def authHint = params.SSH_AUTH_MODE == 'password'
          ? "Secret text credential '${params.SSH_PASSWORD_CREDENTIAL_ID}' with the ${params.DEPLOY_HOST} password"
          : "SSH credential '${params.SSH_CREDENTIAL_ID}' authorized on ${params.DEPLOY_HOST}"
        echo "Deploy failed. Needs: ${authHint}, Docker on the target VPS, write access to ${params.DEPLOY_PATH}, and Postal secrets (credentials ${params.POSTAL_CONFIG_CREDENTIAL_ID} / ${params.SIGNING_KEY_CREDENTIAL_ID} or files already in ${params.DEPLOY_PATH}/docker/local-config/)."
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
'''
}

def installRemoteSecretFile(String credId, String destName, String label) {
  if (!credId) {
    echo "No credential ID for ${label} — continuing if file already exists under DEPLOY_PATH/docker/local-config/ on the target"
    return
  }
  try {
    withCredentials([file(credentialsId: credId, variable: 'SECRET_FILE')] + sshAuthCreds()) {
      if (isUnix()) {
        sh('''#!/bin/bash
          set -euo pipefail
          ''' + sshVarsUnix() + """
          \$SCP "\$SECRET_FILE" "\$DEPLOY_HOST:\$DEPLOY_PATH/docker/local-config/${destName}"
          \$SSH "\$DEPLOY_HOST" "chmod 600 '\$DEPLOY_PATH/docker/local-config/${destName}'"
          echo "${label} installed on \$DEPLOY_HOST"
""")
      } else {
        powershell(sshVarsWindows() + """
          Invoke-RemoteScp \$env:SECRET_FILE "\${deployHost}:\${deployPath}/docker/local-config/${destName}"
          Invoke-RemoteSsh @('chmod', '600', "'\$deployPath/docker/local-config/${destName}'")
          Write-Host '${label} installed'
""")
      }
    }
  } catch (err) {
    echo "${label} credential '${credId}' unavailable (${err}). Continuing if file already on the target."
  }
}

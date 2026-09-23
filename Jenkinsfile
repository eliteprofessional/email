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
      defaultValue: '/opt/email',
      description: 'Install path on the target VPS'
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
              sh('''
                set -euo pipefail
                ''' + sshVarsUnix() + '''

                $SSH "$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH/dkim'"

                if command -v rsync >/dev/null 2>&1; then
                  rsync -az --delete \
                    -e "$RSH" \
                    --exclude '.git/' \
                    --exclude 'node_modules/' \
                    --exclude '.env' \
                    --exclude 'dkim/*.private' \
                    ./ "$DEPLOY_HOST:$DEPLOY_PATH/"
                else
                  TARBALL="$(mktemp)"
                  tar -czf "$TARBALL" \
                    --exclude=.git \
                    --exclude=node_modules \
                    --exclude=.env \
                    --exclude='dkim/*.private' \
                    .
                  $SCP "$TARBALL" "$DEPLOY_HOST:/tmp/email-deploy.tar.gz"
                  rm -f "$TARBALL"
                  $SSH "$DEPLOY_HOST" "tar -xzf /tmp/email-deploy.tar.gz -C '$DEPLOY_PATH' && rm -f /tmp/email-deploy.tar.gz"
                fi

                $SSH "$DEPLOY_HOST" "ls -la '$DEPLOY_PATH' '$DEPLOY_PATH/dkim'"
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                $stage = Join-Path $env:TEMP ("email-deploy-" + [guid]::NewGuid())
                New-Item -ItemType Directory -Path $stage | Out-Null
                try {
                  Get-ChildItem -Force | Where-Object {
                    $_.Name -notin @('.git', 'node_modules') -and $_.Name -ne '.env'
                  } | ForEach-Object {
                    Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
                  }
                  $privStage = Join-Path $stage 'dkim\\airepro.solutions.private'
                  if (Test-Path $privStage) { Remove-Item $privStage -Force }

                  Invoke-RemoteSsh @('mkdir', '-p', "'$deployPath/dkim'")
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

    stage('Install DKIM private key') {
      steps {
        script {
          def credId = params.DKIM_PRIVATE_CREDENTIAL_ID?.trim()
          if (!credId) {
            echo 'No DKIM credential ID — continuing if key already exists under DEPLOY_PATH/dkim/ on the target'
            return
          }
          try {
            withCredentials([file(credentialsId: credId, variable: 'DKIM_PRIVATE_FILE')] + sshAuthCreds()) {
              if (isUnix()) {
                sh('''
                  set -euo pipefail
                  ''' + sshVarsUnix() + '''

                  $SCP "$DKIM_PRIVATE_FILE" "$DEPLOY_HOST:$DEPLOY_PATH/dkim/airepro.solutions.private"
                  $SSH "$DEPLOY_HOST" "chmod 600 '$DEPLOY_PATH/dkim/airepro.solutions.private'"
                  echo "DKIM private key installed on $DEPLOY_HOST"
                ''')
              } else {
                powershell(sshVarsWindows() + '''
                  Invoke-RemoteScp $env:DKIM_PRIVATE_FILE "${deployHost}:${deployPath}/dkim/airepro.solutions.private"
                  Invoke-RemoteSsh @('chmod', '600', "'$deployPath/dkim/airepro.solutions.private'")
                  Write-Host 'DKIM private key installed'
                ''')
              }
            }
          } catch (err) {
            echo "DKIM credential '${credId}' unavailable (${err}). Continuing if file already on the target."
          }
        }
      }
    }

    stage('Docker compose up') {
      steps {
        script {
          withCredentials(sshAuthCreds()) {
            def upFlags = params.FORCE_RECREATE ? '-d --force-recreate' : '-d'
            def remoteCmd = """
              set -euo pipefail
              trap 'rm -f "\$0"' EXIT
              cd '${params.DEPLOY_PATH}'
              if [ ! -f dkim/airepro.solutions.private ]; then
                echo 'ERROR: ${params.DEPLOY_PATH}/dkim/airepro.solutions.private missing.'
                echo 'Upload Jenkins secret ${params.DKIM_PRIVATE_CREDENTIAL_ID} or copy the file once.'
                exit 1
              fi
              docker compose -f docker-compose.yml config >/dev/null
              docker compose pull
              docker compose up ${upFlags}
              docker compose ps
              docker logs airepro-postfix --tail 40
            """.stripIndent()
            writeFile file: 'remote-deploy.sh', text: remoteCmd

            if (isUnix()) {
              sh('''
                set -euo pipefail
                ''' + sshVarsUnix() + '''

                $SCP remote-deploy.sh "$DEPLOY_HOST:/tmp/email-remote-deploy.sh"
                $SSH "$DEPLOY_HOST" "bash /tmp/email-remote-deploy.sh"
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                Invoke-RemoteScp 'remote-deploy.sh' "${deployHost}:/tmp/email-remote-deploy.sh"
                Invoke-RemoteSsh @('bash', '/tmp/email-remote-deploy.sh')
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
            def remoteCmd = '''
              set -euo pipefail
              trap 'rm -f "$0"' EXIT
              docker inspect -f '{{.State.Status}}' airepro-postfix | grep -q running
              docker exec airepro-postfix postconf myhostname | grep -q mail.airepro.solutions
              (ss -lnt 2>/dev/null || netstat -lnt) | grep -q ':2525 '
              echo "Smoke OK: airepro-postfix running, hostname OK, :2525 listening"
            '''.stripIndent()
            writeFile file: 'remote-smoke.sh', text: remoteCmd

            if (isUnix()) {
              sh('''
                set -euo pipefail
                ''' + sshVarsUnix() + '''

                $SCP remote-smoke.sh "$DEPLOY_HOST:/tmp/email-remote-smoke.sh"
                $SSH "$DEPLOY_HOST" "bash /tmp/email-remote-smoke.sh"
              ''')
            } else {
              powershell(sshVarsWindows() + '''
                Invoke-RemoteScp 'remote-smoke.sh' "${deployHost}:/tmp/email-remote-smoke.sh"
                Invoke-RemoteSsh @('bash', '/tmp/email-remote-smoke.sh')
              ''')
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo "Postfix deployed to ${params.DEPLOY_HOST}:${params.DEPLOY_PATH} over SSH (${params.SSH_AUTH_MODE} auth, SMTP on host port 2525)"
    }
    failure {
      script {
        def authHint = params.SSH_AUTH_MODE == 'password'
          ? "Secret text credential '${params.SSH_PASSWORD_CREDENTIAL_ID}' with the ${params.DEPLOY_HOST} password"
          : "SSH credential '${params.SSH_CREDENTIAL_ID}' authorized on ${params.DEPLOY_HOST}"
        echo "Deploy failed. Needs: ${authHint}, Docker on the target VPS, write access to ${params.DEPLOY_PATH}, and the DKIM private key (credential ${params.DKIM_PRIVATE_CREDENTIAL_ID} or file already in ${params.DEPLOY_PATH}/dkim/)."
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

// Bash snippet (concatenated into sh '''...''' blocks) defining $SSH / $SCP / $RSH
// based on SSH_AUTH_MODE. Requires `sshpass` installed on the agent for password mode.
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

// PowerShell preamble defining Invoke-RemoteSsh / Invoke-RemoteScp based on SSH_AUTH_MODE.
// Password mode requires PuTTY's plink.exe/pscp.exe on the agent's PATH.
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

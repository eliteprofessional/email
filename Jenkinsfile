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

    stage('Validate compose') {
      steps {
        powershell '''
          if (-not (Test-Path 'docker-compose.yml')) {
            throw 'docker-compose.yml not found'
          }
          Write-Host 'docker-compose.yml present'
          # Prefer validating on the Linux VPS; local Windows agent may not have docker compose
          if (Get-Command docker -ErrorAction SilentlyContinue) {
            docker compose -f docker-compose.yml config | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'docker compose config failed' }
            Write-Host 'docker compose config OK'
          } else {
            Write-Host 'docker not on agent — skipping local compose config (will validate on VPS)'
          }
        '''
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
          powershell '''
            $ErrorActionPreference = 'Stop'
            $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
            $hostName = $env:DEPLOY_HOST
            $deployPath = $env:DEPLOY_PATH
            $remote = "${deployUser}@${hostName}"
            $key = $env:SSH_KEY

            $sshBase = @(
              '-i', $key,
              '-o', 'StrictHostKeyChecking=accept-new',
              '-o', 'BatchMode=yes'
            )

            Write-Host "Deploying workspace to ${remote}:${deployPath}"

            & ssh @sshBase $remote "mkdir -p '${deployPath}/dkim'"
            if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed ($LASTEXITCODE)" }

            # Stage a clean payload (exclude secrets / junk). Never ship a missing private key overwrite.
            $stage = Join-Path $env:TEMP ("email-deploy-" + [guid]::NewGuid().ToString())
            New-Item -ItemType Directory -Path $stage | Out-Null
            try {
              $excludeDirs = @('.git', 'node_modules')
              Get-ChildItem -Force | Where-Object {
                $_.Name -notin $excludeDirs -and $_.Name -ne '.env'
              } | ForEach-Object {
                Copy-Item $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
              }
              # Do not upload private key from workspace (gitignored / absent)
              $priv = Join-Path $stage 'dkim\\airepro.solutions.private'
              if (Test-Path $priv) { Remove-Item $priv -Force }

              # Tar is available on modern Windows 10+
              $tar = Join-Path $env:TEMP ("email-deploy-" + [guid]::NewGuid().ToString() + '.tar')
              Push-Location $stage
              try {
                & tar -cf $tar *
                if ($LASTEXITCODE -ne 0) { throw "tar create failed ($LASTEXITCODE)" }
              } finally {
                Pop-Location
              }

              & scp @sshBase $tar "${remote}:/tmp/email-deploy.tar"
              if ($LASTEXITCODE -ne 0) { throw "scp failed ($LASTEXITCODE)" }

              $remoteScript = @"
set -euo pipefail
mkdir -p '${deployPath}'
# Preserve existing private key if present
if [ -f '${deployPath}/dkim/airepro.solutions.private' ]; then
  cp -a '${deployPath}/dkim/airepro.solutions.private' /tmp/airepro.solutions.private.bak
fi
tar -xf /tmp/email-deploy.tar -C '${deployPath}'
mkdir -p '${deployPath}/dkim'
if [ -f /tmp/airepro.solutions.private.bak ]; then
  mv /tmp/airepro.solutions.private.bak '${deployPath}/dkim/airepro.solutions.private'
  chmod 600 '${deployPath}/dkim/airepro.solutions.private' || true
fi
rm -f /tmp/email-deploy.tar
ls -la '${deployPath}' '${deployPath}/dkim' || true
"@
              $remoteScript | & ssh @sshBase $remote 'bash -s'
              if ($LASTEXITCODE -ne 0) { throw "remote extract failed ($LASTEXITCODE)" }
            } finally {
              Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
              Remove-Item (Join-Path $env:TEMP 'email-deploy-*.tar') -Force -ErrorAction SilentlyContinue
            }
          '''
        }
      }
    }

    stage('Install DKIM private key') {
      when {
        expression { return params.DKIM_PRIVATE_CREDENTIAL_ID?.trim() }
      }
      steps {
        withCredentials([
          sshUserPrivateKey(
            credentialsId: "${params.SSH_CREDENTIALS_ID}",
            keyFileVariable: 'SSH_KEY',
            usernameVariable: 'SSH_USER_FROM_CRED'
          ),
          file(
            credentialsId: "${params.DKIM_PRIVATE_CREDENTIAL_ID}",
            variable: 'DKIM_PRIVATE_FILE'
          )
        ]) {
          powershell '''
            $ErrorActionPreference = 'Stop'
            $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
            $remote = "${deployUser}@$($env:DEPLOY_HOST)"
            $key = $env:SSH_KEY
            $dest = "$($env:DEPLOY_PATH)/dkim/airepro.solutions.private"
            $sshBase = @('-i', $key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')

            & ssh @sshBase $remote "mkdir -p '$($env:DEPLOY_PATH)/dkim'"
            & scp @sshBase $env:DKIM_PRIVATE_FILE "${remote}:${dest}"
            if ($LASTEXITCODE -ne 0) { throw "scp DKIM private key failed ($LASTEXITCODE)" }
            & ssh @sshBase $remote "chmod 600 '${dest}' || true"
            Write-Host "DKIM private key installed at ${dest}"
          '''
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
          powershell '''
            $ErrorActionPreference = 'Stop'
            $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
            $remote = "${deployUser}@$($env:DEPLOY_HOST)"
            $key = $env:SSH_KEY
            $path = $env:DEPLOY_PATH
            $force = $env:FORCE_RECREATE
            $sshBase = @('-i', $key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')

            $upFlags = '-d'
            if ($force -eq 'true') { $upFlags = '-d --force-recreate' }

            $remoteScript = @"
set -euo pipefail
cd '${path}'
if [ ! -f dkim/airepro.solutions.private ]; then
  echo 'ERROR: dkim/airepro.solutions.private missing on server.'
  echo 'Set Jenkins secret file credential DKIM_PRIVATE_CREDENTIAL_ID or copy the key once manually.'
  exit 1
fi
docker compose -f docker-compose.yml config >/dev/null
docker compose pull
docker compose up ${upFlags}
docker compose ps
docker logs airepro-postfix --tail 40
"@
            $remoteScript | & ssh @sshBase $remote 'bash -s'
            if ($LASTEXITCODE -ne 0) { throw "docker compose up failed ($LASTEXITCODE)" }
          '''
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
          powershell '''
            $ErrorActionPreference = 'Stop'
            $deployUser = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { $env:SSH_USER_FROM_CRED }
            $remote = "${deployUser}@$($env:DEPLOY_HOST)"
            $key = $env:SSH_KEY
            $sshBase = @('-i', $key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')

            $remoteScript = @'
set -euo pipefail
docker inspect -f "{{.State.Status}}" airepro-postfix | grep -q running
docker exec airepro-postfix postconf myhostname | grep -q mail.airepro.solutions
(ss -lnt 2>/dev/null || netstat -lnt) | grep -q ":2525"
echo "Smoke OK: airepro-postfix running, hostname OK, :2525 listening"
'@
            $remoteScript | & ssh @sshBase $remote 'bash -s'
            if ($LASTEXITCODE -ne 0) { throw "smoke check failed ($LASTEXITCODE)" }
          '''
        }
      }
    }
  }

  post {
    success {
      echo "Deployed Postfix to ${params.DEPLOY_HOST}:${params.DEPLOY_PATH}"
    }
    failure {
      echo "Deploy failed. Check: Windows agent has OpenSSH (ssh/scp), Jenkins SSH credential, DKIM secret file, Docker on VPS."
    }
  }
}

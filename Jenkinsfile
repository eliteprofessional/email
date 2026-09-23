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
      description: 'Optional Jenkins Secret file credential for dkim/airepro.solutions.private (needed on first deploy)'
    )
    booleanParam(
      name: 'FORCE_RECREATE',
      defaultValue: false,
      description: 'Run docker compose up -d --force-recreate'
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
        sh '''
          set -e
          test -f docker-compose.yml
          docker compose -f docker-compose.yml config >/dev/null
          echo "docker-compose.yml OK"
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
          sh '''
            set -euo pipefail

            DEPLOY_USER="${DEPLOY_USER}"
            # Prefer parameter user; fall back to credential username
            if [ -z "${DEPLOY_USER}" ]; then
              DEPLOY_USER="${SSH_USER_FROM_CRED}"
            fi

            SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
            REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

            echo "Deploying to ${REMOTE}:${DEPLOY_PATH}"

            ssh ${SSH_OPTS} "${REMOTE}" "mkdir -p '${DEPLOY_PATH}/dkim'"

            # Sync repo; never overwrite an existing DKIM private key on the server
            rsync -az --delete \
              -e "ssh ${SSH_OPTS}" \
              --exclude '.git/' \
              --exclude '.env' \
              --exclude 'node_modules/' \
              --exclude 'dkim/*.private' \
              ./ "${REMOTE}:${DEPLOY_PATH}/"

            # Keep compose + public DKIM; private key comes from credential or prior deploy
            ssh ${SSH_OPTS} "${REMOTE}" "ls -la '${DEPLOY_PATH}' '${DEPLOY_PATH}/dkim' || true"
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
          sh '''
            set -euo pipefail
            DEPLOY_USER="${DEPLOY_USER:-$SSH_USER_FROM_CRED}"
            SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
            REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
            DEST="${DEPLOY_PATH}/dkim/airepro.solutions.private"

            scp ${SSH_OPTS} "${DKIM_PRIVATE_FILE}" "${REMOTE}:${DEST}"
            ssh ${SSH_OPTS} "${REMOTE}" "chmod 600 '${DEST}' && chown root:root '${DEST}' || true"
            echo "DKIM private key installed at ${DEST}"
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
          sh '''
            set -euo pipefail
            DEPLOY_USER="${DEPLOY_USER:-$SSH_USER_FROM_CRED}"
            SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
            REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

            UP_FLAGS="-d"
            if [ "${FORCE_RECREATE}" = "true" ]; then
              UP_FLAGS="-d --force-recreate"
            fi

            ssh ${SSH_OPTS} "${REMOTE}" bash -s <<EOF
set -euo pipefail
cd '${DEPLOY_PATH}'

if [ ! -f dkim/airepro.solutions.private ]; then
  echo "ERROR: dkim/airepro.solutions.private missing on server."
  echo "Add Jenkins secret file credential (DKIM_PRIVATE_CREDENTIAL_ID) or copy the key once manually."
  exit 1
fi

docker compose pull
docker compose up ${UP_FLAGS}
docker compose ps
docker logs airepro-postfix --tail 40
EOF
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
          sh '''
            set -euo pipefail
            DEPLOY_USER="${DEPLOY_USER:-$SSH_USER_FROM_CRED}"
            SSH_OPTS="-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
            REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

            ssh ${SSH_OPTS} "${REMOTE}" bash -s <<EOF
set -euo pipefail
docker inspect -f '{{.State.Status}}' airepro-postfix | grep -q running
docker exec airepro-postfix postconf myhostname | grep -q mail.airepro.solutions
# Local SMTP port published on host
ss -lnt | grep -q ':2525' || netstat -lnt | grep -q ':2525'
echo "Smoke OK: airepro-postfix running, hostname OK, :2525 listening"
EOF
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
      echo "Deploy failed. Check SSH credentials, DKIM private key, and docker on the VPS."
    }
  }
}

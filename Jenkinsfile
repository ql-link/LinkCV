pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
    timestamps()
  }

  parameters {
    string(name: 'DEPLOY_HOST', defaultValue: '', description: 'Target server host or IP')
    string(name: 'DEPLOY_USER', defaultValue: 'deploy', description: 'SSH user on the target server')
    string(name: 'DEPLOY_DIR', defaultValue: '/opt/linkcv', description: 'Application directory on the target server')
    string(name: 'SERVICE_NAME', defaultValue: 'linkcv', description: 'systemd service name')
    string(name: 'APP_PORT', defaultValue: '4174', description: 'Port exposed by the Node service')
    string(name: 'SSH_CREDENTIALS_ID', defaultValue: 'linkcv-deploy-ssh', description: 'Jenkins SSH private key credentials ID')
    booleanParam(name: 'SKIP_DEPLOY', defaultValue: false, description: 'Only build and archive the deployment artifact')
  }

  environment {
    CI = 'true'
  }

  stages {
    stage('Install') {
      steps {
        sh 'node --version && npm --version'
        sh 'npm ci'
      }
    }

    stage('Build') {
      steps {
        sh 'npm run build'
      }
    }

    stage('Package') {
      steps {
        sh '''
          set -euo pipefail
          rm -rf .jenkins-package
          mkdir -p .jenkins-package
          tar \
            --exclude=.git \
            --exclude=.idea \
            --exclude=.jenkins-package \
            --exclude=node_modules \
            --exclude=data \
            -czf .jenkins-package/linkcv-${BUILD_NUMBER}.tar.gz .
        '''
        archiveArtifacts artifacts: '.jenkins-package/*.tar.gz', fingerprint: true
      }
    }

    stage('Deploy') {
      when {
        expression { return !params.SKIP_DEPLOY }
      }
      steps {
        script {
          if (!params.DEPLOY_HOST?.trim()) {
            error('DEPLOY_HOST is required when SKIP_DEPLOY is false')
          }
        }
        sshagent(credentials: [params.SSH_CREDENTIALS_ID]) {
          sh '''
            set -euo pipefail
            artifact=".jenkins-package/linkcv-${BUILD_NUMBER}.tar.gz"
            runtime_env=".jenkins-package/runtime-${BUILD_NUMBER}.env"
            remote="${DEPLOY_USER}@${DEPLOY_HOST}"
            remote_tarball="/tmp/linkcv-${BUILD_NUMBER}.tar.gz"
            remote_runtime_env="/tmp/linkcv-runtime-${BUILD_NUMBER}.env"

            : > "${runtime_env}"
            for name in MINIO_ENDPOINT MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_BUCKET; do
              value="$(printenv "${name}" || true)"
              if [ -n "${value}" ]; then
                printf '%s=%s\\n' "${name}" "${value}" >> "${runtime_env}"
              fi
            done

            scp -o StrictHostKeyChecking=accept-new "${artifact}" "${remote}:${remote_tarball}"
            scp -o StrictHostKeyChecking=accept-new "${runtime_env}" "${remote}:${remote_runtime_env}"
            scp -o StrictHostKeyChecking=accept-new deploy/remote-deploy.sh "${remote}:/tmp/linkcv-remote-deploy.sh"
            ssh -o StrictHostKeyChecking=accept-new "${remote}" \
              "APP_TARBALL='${remote_tarball}' RUNTIME_ENV_FILE='${remote_runtime_env}' DEPLOY_DIR='${DEPLOY_DIR}' RELEASE_ID='${BUILD_NUMBER}' SERVICE_NAME='${SERVICE_NAME}' APP_PORT='${APP_PORT}' bash /tmp/linkcv-remote-deploy.sh"
          '''
        }
      }
    }
  }

  post {
    always {
      cleanWs(deleteDirs: true, disableDeferredWipeout: true)
    }
  }
}

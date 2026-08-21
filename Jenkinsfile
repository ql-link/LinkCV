pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    booleanParam(
      name: 'RUN_TESTS',
      defaultValue: false,
      description: '构建生产镜像前运行 npm run check'
    )
    booleanParam(
      name: 'IMPORT_LEGACY_SQLITE',
      defaultValue: false,
      description: '仅首次切换时导入旧 Production SQLite；自动构建必须保持关闭'
    )
  }

  triggers {
    GenericTrigger(
      genericVariables: [[key: 'ref', value: '$.ref']],
      causeString: 'GitHub push to $ref',
      token: '',
      tokenCredentialId: 'linkcv-dev-webhook-token',
      printContributedVariables: false,
      printPostContent: false,
      silentResponse: false,
      shouldNotFlatten: false,
      regexpFilterText: '$ref',
      regexpFilterExpression: '^refs/heads/master$'
    )
  }

  environment {
    CLOUD_HOST = '100.77.31.79'
    CLOUD_USER = 'root'
    CLOUD_SSH_KEY = '/var/jenkins_home/.ssh/cloud_prod'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.COMMIT_SHORT = sh(
            script: 'git rev-parse --short=8 HEAD',
            returnStdout: true
          ).trim()
        }
      }
    }

    stage('Quality') {
      when { expression { return params.RUN_TESTS } }
      steps {
        sh 'npm run setup && npm run check'
      }
    }

    stage('Package Commit') {
      steps {
        sh '''
          set -eu
          git archive --format=tar.gz --output=linkcv-source.tar.gz HEAD
        '''
      }
    }

    stage('Deploy Production on Cloud') {
      steps {
        sh '''
          set -eu
          case "${BUILD_NUMBER}" in
            ''|*[!0-9]*) echo 'BUILD_NUMBER must be numeric'; exit 20 ;;
          esac
          test -f "${CLOUD_SSH_KEY}" || {
            echo "Missing Cloud SSH key: ${CLOUD_SSH_KEY}"
            exit 21
          }

          remote_dir="/tmp/linkcv-prod-jenkins-${BUILD_NUMBER}"
          ssh_opts="-i ${CLOUD_SSH_KEY} -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
          effective_import="${IMPORT_LEGACY_SQLITE}"
          if [ -n "${ref:-}" ] && [ "${effective_import}" = 'true' ]; then
            echo 'Webhook-triggered builds cannot import legacy SQLite.'
            exit 22
          fi

          ssh ${ssh_opts} "${CLOUD_USER}@${CLOUD_HOST}" \
            "mkdir -p '${remote_dir}'"
          scp ${ssh_opts} \
            linkcv-source.tar.gz \
            deploy/scripts/build-production-on-cloud.sh \
            "${CLOUD_USER}@${CLOUD_HOST}:${remote_dir}/"
          ssh ${ssh_opts} "${CLOUD_USER}@${CLOUD_HOST}" \
            "bash '${remote_dir}/build-production-on-cloud.sh' '${BUILD_NUMBER}' '${COMMIT_SHORT}' '${remote_dir}/linkcv-source.tar.gz' '${effective_import}'"
        '''
      }
    }
  }

  post {
    always {
      sh '''
        case "${BUILD_NUMBER}" in
          ''|*[!0-9]*) exit 0 ;;
        esac
        if [ -f "${CLOUD_SSH_KEY}" ]; then
          ssh -i "${CLOUD_SSH_KEY}" \
            -o BatchMode=yes \
            -o IdentitiesOnly=yes \
            -o StrictHostKeyChecking=accept-new \
            "${CLOUD_USER}@${CLOUD_HOST}" \
            "rm -rf '/tmp/linkcv-prod-jenkins-${BUILD_NUMBER}'" || true
        fi
        rm -f linkcv-source.tar.gz
      '''
    }
    success { echo "Production deployed from commit ${env.COMMIT_SHORT}" }
    failure { echo 'Production build or deployment failed.' }
  }
}

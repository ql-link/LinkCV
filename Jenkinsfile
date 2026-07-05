pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    IMAGE = 'linkcv'
    TAG = "${env.GIT_COMMIT?.take(8) ?: env.BUILD_NUMBER}"
    DEPLOY_DIR = '/opt/tolink/LinkCV'
    LINKCV_ENV_FILE = '/opt/tolink/LinkCV/.env'
  }

  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Build Image') {
      steps {
        sh '''
          DOCKER_BUILDKIT=1 docker build \
            -t ${IMAGE}:${TAG} -t ${IMAGE}:latest \
            .
        '''
      }
    }

    stage('Deploy') {
      steps {
        sh '''
          mkdir -p "${DEPLOY_DIR}/deploy" "${DEPLOY_DIR}/data"
          cp deploy/docker-compose.yml "${DEPLOY_DIR}/deploy/docker-compose.yml"
          cd "${DEPLOY_DIR}"
          export TAG="${TAG}"
          export LINKCV_ENV_FILE="${LINKCV_ENV_FILE}"
          test -f "${LINKCV_ENV_FILE}" || { echo "Missing LinkCV env file: ${LINKCV_ENV_FILE}"; exit 14; }
          docker compose -f deploy/docker-compose.yml up -d
        '''
      }
    }
  }

  post {
    always { sh 'docker image prune -f || true' }
    success { echo "Deployed ${IMAGE}:${TAG}" }
    failure { echo 'Build failed.' }
  }
}

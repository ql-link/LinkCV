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
    IMAGE = 'linkcv'
    DEPLOY_DIR = '/opt/tolink/LinkCV'
    LINKCV_ENV_FILE = '/opt/tolink/LinkCV/.env.production'
    LINKCV_SECRET_ENV_FILE = '/opt/tolink/LinkCV/.env.production.local'
    LINKCV_DOCKER_NETWORK = 'tolink-app-net'
    LINKCV_HTTP_PORT = '8000'
    EXPECTED_APP_ENV = 'production'
    EXPECTED_MYSQL_HOST = 'tolink-mysql'
    EXPECTED_MYSQL_PORT = '3306'
    EXPECTED_MYSQL_DATABASE = 'linkcv'
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
          env.TAG = "prod-${env.COMMIT_SHORT}-b${env.BUILD_NUMBER}"
        }
      }
    }

    stage('Quality') {
      when { expression { return params.RUN_TESTS } }
      steps {
        sh 'npm run setup && npm run check'
      }
    }

    stage('Build Image') {
      steps {
        sh '''
          set -eu
          DOCKER_BUILDKIT=1 docker build \
            --label org.opencontainers.image.revision="$(git rev-parse HEAD)" \
            -t "${IMAGE}:${TAG}" \
            .
        '''
      }
    }

    stage('Prepare Production') {
      steps {
        sh '''
          set -eu
          docker network inspect "${LINKCV_DOCKER_NETWORK}" >/dev/null
          mkdir -p "${DEPLOY_DIR}/deploy/observability"
          install -m 0644 .env.production "${LINKCV_ENV_FILE}"
          install -m 0644 deploy/docker-compose.production.yml \
            "${DEPLOY_DIR}/deploy/docker-compose.production.yml"
          install -m 0644 deploy/observability/promtail-config.yml \
            "${DEPLOY_DIR}/deploy/observability/promtail-config.yml"
          test -f "${LINKCV_SECRET_ENV_FILE}" || {
            echo "Missing Production secret env file: ${LINKCV_SECRET_ENV_FILE}"
            exit 15
          }
          secret_mode="$(stat -c '%a' "${LINKCV_SECRET_ENV_FILE}")"
          case "${secret_mode}" in
            400|600) ;;
            *)
              echo "Production secret env file must use mode 400 or 600, got ${secret_mode}"
              exit 16
              ;;
          esac
        '''
      }
    }

    stage('Migrate Production') {
      steps {
        sh '''
          set -eu
          docker run --rm \
            --network "${LINKCV_DOCKER_NETWORK}" \
            --env-file "${LINKCV_ENV_FILE}" \
            --env-file "${LINKCV_SECRET_ENV_FILE}" \
            -e APP_ENV="${EXPECTED_APP_ENV}" \
            "${IMAGE}:${TAG}" \
            python /app/scripts/release/run_alembic.py \
              --expected-app-env "${EXPECTED_APP_ENV}" \
              --expected-host "${EXPECTED_MYSQL_HOST}" \
              --expected-port "${EXPECTED_MYSQL_PORT}" \
              --expected-database "${EXPECTED_MYSQL_DATABASE}"
        '''
      }
    }

    stage('Deploy Production') {
      steps {
        sh '''
          set -eu
          TAG="${TAG}" \
          LINKCV_ENV_FILE="${LINKCV_ENV_FILE}" \
          LINKCV_SECRET_ENV_FILE="${LINKCV_SECRET_ENV_FILE}" \
          LINKCV_DOCKER_NETWORK="${LINKCV_DOCKER_NETWORK}" \
          LINKCV_HTTP_PORT="${LINKCV_HTTP_PORT}" \
            docker compose \
              -f "${DEPLOY_DIR}/deploy/docker-compose.production.yml" \
              up -d --remove-orphans

          attempt=1
          while [ "${attempt}" -le 30 ]; do
            health_status="$(docker inspect --format='{{.State.Health.Status}}' linkcv 2>/dev/null || true)"
            pi_health_status="$(docker inspect --format='{{.State.Health.Status}}' linkcv-pi 2>/dev/null || true)"
            promtail_status="$(docker inspect --format='{{.State.Status}}' linkcv-promtail 2>/dev/null || true)"
            if [ "${health_status}" = 'healthy' ] && \
              [ "${pi_health_status}" = 'healthy' ] && \
              [ "${promtail_status}" = 'running' ] && \
              curl -fsS "http://127.0.0.1:${LINKCV_HTTP_PORT}/api/health" >/dev/null; then
              echo "Container health: ${health_status}"
              echo "Pi Service health: ${pi_health_status}"
              echo "Promtail status: ${promtail_status}"
              exit 0
            fi
            sleep 2
            attempt=$((attempt + 1))
          done

          docker compose \
            -f "${DEPLOY_DIR}/deploy/docker-compose.production.yml" \
            logs --tail=100 linkcv linkcv-pi promtail
          echo 'Production health check timed out.'
          exit 17
        '''
      }
    }
  }

  post {
    always { sh 'docker image prune -f || true' }
    success { echo "Production deployed: ${env.IMAGE}:${env.TAG}" }
    failure { echo 'Production build or deployment failed.' }
  }
}

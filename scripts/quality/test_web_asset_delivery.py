#!/usr/bin/env python3
"""验证 Web 静态资源 OSS 构建与发布契约。"""

from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLISH_SCRIPT = REPO_ROOT / "deploy/scripts/publish-web-assets-to-oss.sh"
PRODUCTION_SCRIPT = REPO_ROOT / "deploy/scripts/build-production-on-cloud.sh"


class WebAssetDeliveryTest(unittest.TestCase):
    def test_vite_asset_base_defaults_and_normalizes_https_url(self) -> None:
        expression = """
          import { resolveAssetBase } from './apps/web/vite.config.mjs';
          console.log(JSON.stringify([
            resolveAssetBase(''),
            resolveAssetBase('https://static.example.com'),
            resolveAssetBase('https://static.example.com/releases/')
          ]));
        """
        result = subprocess.run(
            ["node", "--input-type=module", "--eval", expression],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            ["/", "https://static.example.com/", "https://static.example.com/releases/"],
            __import__("json").loads(result.stdout),
        )

    def test_vite_asset_base_rejects_unsafe_url(self) -> None:
        expression = """
          import { resolveAssetBase } from './apps/web/vite.config.mjs';
          resolveAssetBase('http://static.example.com/');
        """
        result = subprocess.run(
            ["node", "--input-type=module", "--eval", expression],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("must be an HTTPS URL", result.stderr)

    def test_publish_uploads_immutable_assets_then_verifies_oss(self) -> None:
        result, ossutil_log = self._run_publish(cors=True)
        self.assertEqual(0, result.returncode, result.stderr)
        invocation = ossutil_log.read_text(encoding="utf-8")
        self.assertIn("cp -r", invocation)
        self.assertIn("oss://linkresume-static-test/LinkResume/assets/", invocation)
        self.assertIn("--acl default", invocation)
        self.assertIn(
            "--cache-control public,max-age=31536000,immutable",
            invocation,
        )
        self.assertNotIn(" rm ", f" {invocation} ")
        self.assertNotIn("--delete", invocation)
        self.assertIn(
            '--header "Origin: https://linkresume.cn"',
            PUBLISH_SCRIPT.read_text(encoding="utf-8"),
        )

    def test_publish_rejects_javascript_without_cors_header(self) -> None:
        result, _ = self._run_publish(cors=False)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("does not allow the https://linkresume.cn origin", result.stderr)

    def test_publish_rejects_public_url_that_does_not_match_upload_target(self) -> None:
        result, _ = self._run_publish(
            cors=True,
            public_url="https://another-bucket.oss-cn-test.aliyuncs.com/LinkResume/",
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("must match the configured Bucket, Region, and prefix", result.stderr)

    def test_production_upload_precedes_database_and_application_cutover(self) -> None:
        body = PRODUCTION_SCRIPT.read_text(encoding="utf-8")
        publish_at = body.index("publish-web-assets-to-oss.sh")
        migration_at = body.index("python /app/scripts/db/init_mysql.py")
        cutover_at = body.index('cutover_started="true"', migration_at)
        self.assertLess(publish_at, migration_at)
        self.assertLess(publish_at, cutover_at)
        self.assertIn('--build-arg "VITE_ASSET_BASE_URL=${web_asset_oss_url}"', body)
        self.assertIn('oss_secret_env="${deploy_dir}/.env.oss-cdn.local"', body)

    def _run_publish(
        self,
        *,
        cors: bool,
        public_url: str = "https://linkresume-static-test.oss-cn-test.aliyuncs.com/LinkResume/",
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        asset_dir = root / "assets"
        fake_bin = root / "bin"
        asset_dir.mkdir()
        fake_bin.mkdir()
        (asset_dir / "index-abc123.js").write_text("export {};", encoding="utf-8")
        (asset_dir / "index-abc123.css").write_text("body{}", encoding="utf-8")

        ossutil_log = root / "ossutil.log"
        self._write_executable(
            fake_bin / "ossutil",
            '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >>"${FAKE_OSSUTIL_LOG}"\n',
        )
        cors_header = "Access-Control-Allow-Origin: https://linkresume.cn\\r\\n" if cors else ""
        self._write_executable(
            fake_bin / "curl",
            "#!/usr/bin/env bash\n"
            "printf 'HTTP/2 200\\r\\n'\n"
            "printf 'Cache-Control: public,max-age=31536000,immutable\\r\\n'\n"
            f"printf '{cors_header}'\n",
        )

        environment = os.environ.copy()
        environment.update(
            {
                "PATH": f"{fake_bin}:{environment['PATH']}",
                "FAKE_OSSUTIL_LOG": str(ossutil_log),
                "WEB_ASSET_OSS_URL": public_url,
                "WEB_ASSET_OSS_BUCKET": "linkresume-static-test",
                "WEB_ASSET_OSS_PREFIX": "LinkResume",
                "OSS_ACCESS_KEY_ID": "test-access-key-id",
                "OSS_ACCESS_KEY_SECRET": "test-access-key-secret",
                "OSS_REGION": "cn-test",
            }
        )
        result = subprocess.run(
            ["bash", str(PUBLISH_SCRIPT), str(asset_dir)],
            cwd=REPO_ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )
        return result, ossutil_log

    @staticmethod
    def _write_executable(path: Path, body: str) -> None:
        path.write_text(body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)


if __name__ == "__main__":
    unittest.main()

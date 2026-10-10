#!/usr/bin/env python3
"""验证 Web 静态资源 OSS 构建与发布契约。"""

from __future__ import annotations

import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLISH_SCRIPT = REPO_ROOT / "deploy/scripts/publish-web-assets-to-oss.sh"
PUBLISH_HELPER = REPO_ROOT / "deploy/scripts/publish_web_assets.py"
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
        self.assertIn("oss://linkresume-static-test/LinkResume/favicon.png", invocation)
        self.assertIn("--acl default", invocation)
        self.assertNotIn("--disable-ignore-error", invocation)
        self.assertIn(
            "--cache-control public,max-age=31536000,immutable",
            invocation,
        )
        self.assertNotIn(" rm ", f" {invocation} ")
        self.assertNotIn("--delete", invocation)
        self.assertIn("Origin: https://linkresume.cn", PUBLISH_HELPER.read_text(encoding="utf-8"))
        self.assertNotIn(
            "--retry-all-errors",
            PUBLISH_SCRIPT.read_text(encoding="utf-8"),
        )
        self.assertIn("production favicon", result.stdout)

    def test_publish_rejects_javascript_without_cors_header(self) -> None:
        result, _ = self._run_publish(cors=False)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("does not allow the https://linkresume.cn origin", result.stderr)

    def test_unchanged_files_skip_all_uploads(self) -> None:
        result, log = self._run_publish(cors=True, existing="same")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertFalse(log.exists())
        self.assertIn("uploaded=0, skipped=3", result.stdout)

    def test_only_changed_asset_is_uploaded(self) -> None:
        result, log = self._run_publish(cors=True, existing="changed")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertNotIn("favicon.png", log.read_text())
        self.assertIn("uploaded=1, skipped=2", result.stdout)

    def test_missing_object_is_repaired(self) -> None:
        result, log = self._run_publish(cors=True, existing="missing")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("uploaded=1, skipped=2", result.stdout)

    def test_changed_favicon_only_is_uploaded(self) -> None:
        result, log = self._run_publish(cors=True, existing="favicon")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertNotIn("cp -r", log.read_text())
        self.assertIn("uploaded=1, skipped=2", result.stdout)

    def test_head_server_error_does_not_upload(self) -> None:
        result, log = self._run_publish(cors=True, head_error=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("OSS HEAD failed", result.stderr)
        self.assertFalse(log.exists())

    def test_upload_failure_blocks_publication(self) -> None:
        result, _ = self._run_publish(cors=True, upload_failure=True)
        self.assertNotEqual(0, result.returncode)

    def test_uploaded_content_mismatch_blocks_publication(self) -> None:
        result, _ = self._run_publish(cors=True, corrupt_upload=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("content does not match", result.stderr)

    def test_non_md5_etags_use_content_comparison_and_skip_uploads(self) -> None:
        result, log = self._run_publish(cors=True, existing="same", multipart=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertFalse(log.exists())

    def test_equal_size_changed_content_is_uploaded(self) -> None:
        result, _ = self._run_publish(cors=True, existing="equal-size")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("uploaded=1, skipped=2", result.stdout)

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
        self.assertIn('docker cp "${asset_container}:/app/web/favicon.png"', body)
        self.assertIn('publish-web-assets-to-oss.sh" "${asset_export_dir}" "${favicon_path}"', body)

    def _run_publish(
        self,
        *,
        cors: bool,
        public_url: str = "https://linkresume-static-test.oss-cn-test.aliyuncs.com/LinkResume/",
        existing: str = "empty",
        head_error: bool = False,
        upload_failure: bool = False,
        corrupt_upload: bool = False,
        multipart: bool = False,
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        asset_dir = root / "assets"
        favicon_path = root / "favicon.png"
        fake_bin = root / "bin"
        asset_dir.mkdir()
        fake_bin.mkdir()
        (asset_dir / "index-abc123.js").write_text("export {};", encoding="utf-8")
        (asset_dir / "index-abc123.css").write_text("body{}", encoding="utf-8")
        favicon_path.write_bytes(b"fake-png")

        remote = root / "remote"
        remote.mkdir()
        if existing != "empty":
            import shutil
            shutil.copytree(asset_dir, remote / "assets")
            shutil.copyfile(favicon_path, remote / "favicon.png")
            if existing == "changed":
                (remote / "assets/index-abc123.js").write_text("old bytes")
            elif existing == "missing":
                (remote / "assets/index-abc123.js").unlink()
            elif existing == "favicon":
                (remote / "favicon.png").write_bytes(b"old-icon")
            elif existing == "equal-size":
                (remote / "assets/index-abc123.js").write_bytes(b"x" * len(b"export {};"))

        ossutil_log = root / "ossutil.log"
        self._write_executable(
            fake_bin / "ossutil",
            f"#!{sys.executable}\n" + """
import os, pathlib, shutil, sys
with open(os.environ['FAKE_OSSUTIL_LOG'], 'a') as log:
    log.write(' '.join(sys.argv[1:]) + '\\n')
if os.environ['FAKE_UPLOAD_FAILURE'] == '1':
    sys.exit(1)
recursive = sys.argv[2] == '-r'
source = pathlib.Path(sys.argv[3] if recursive else sys.argv[2])
destination = pathlib.Path(os.environ['FAKE_REMOTE']) / ('assets' if recursive else 'favicon.png')
if recursive:
    for path in source.rglob('*'):
        if path.is_file():
            target = destination / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            if os.environ['FAKE_CORRUPT_UPLOAD'] == '1':
                target.write_bytes(b'bad')
else:
    shutil.copyfile(source, destination)
""",
        )
        self._write_executable(
            fake_bin / "curl",
            f"#!{sys.executable}\n" + """
import hashlib, os, pathlib, sys
from urllib.parse import urlparse, unquote
if os.environ['FAKE_HEAD_ERROR'] == '1':
    print('HTTP/2 503\\r\\n')
    sys.exit(22)
relative = unquote(urlparse(sys.argv[-1]).path).split('/LinkResume/', 1)[1]
path = pathlib.Path(os.environ['FAKE_REMOTE']) / relative
if not path.exists():
    print('HTTP/2 404\\r\\n')
    sys.exit(22)
if '--output' in sys.argv:
    pathlib.Path(sys.argv[sys.argv.index('--output') + 1]).write_bytes(path.read_bytes())
    sys.exit(0)
print('HTTP/2 200\\r')
print('Content-Type: image/png\\r')
print('Content-Length: %s\\r' % path.stat().st_size)
print('ETag: "%s"\\r' % ('multipart-etag' if os.environ['FAKE_MULTIPART'] == '1' else hashlib.md5(path.read_bytes()).hexdigest()))
print('Cache-Control: public,max-age=%s\\r' % ('3600' if relative == 'favicon.png' else '31536000,immutable'))
if os.environ['FAKE_CORS'] == '1':
    print('Access-Control-Allow-Origin: https://linkresume.cn\\r')
print()
""",
        )

        environment = os.environ.copy()
        environment.update(
            {
                "PATH": f"{fake_bin}:{environment['PATH']}",
                "FAKE_OSSUTIL_LOG": str(ossutil_log),
                "FAKE_REMOTE": str(remote),
                "FAKE_CORS": str(int(cors)),
                "FAKE_HEAD_ERROR": str(int(head_error)),
                "FAKE_UPLOAD_FAILURE": str(int(upload_failure)),
                "FAKE_CORRUPT_UPLOAD": str(int(corrupt_upload)),
                "FAKE_MULTIPART": str(int(multipart)),
                "WEB_ASSET_OSS_URL": public_url,
                "WEB_ASSET_OSS_BUCKET": "linkresume-static-test",
                "WEB_ASSET_OSS_PREFIX": "LinkResume",
                "OSS_ACCESS_KEY_ID": "test-access-key-id",
                "OSS_ACCESS_KEY_SECRET": "test-access-key-secret",
                "OSS_REGION": "cn-test",
            }
        )
        result = subprocess.run(
            ["bash", str(PUBLISH_SCRIPT), str(asset_dir), str(favicon_path)],
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

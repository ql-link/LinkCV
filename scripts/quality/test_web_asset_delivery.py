#!/usr/bin/env python3
"""验证 Web 静态资源 OSS 构建与发布契约。"""

from __future__ import annotations

import os
import shutil
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

    def test_publish_uploads_missing_assets_then_verifies_oss(self) -> None:
        result, ossutil_log = self._run_publish(cors=True)
        self.assertEqual(0, result.returncode, result.stderr)
        invocation = ossutil_log.read_text(encoding="utf-8")
        self.assertEqual(3, invocation.count("cp "))
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
        self.assertIn(
            'curl_args+=(--header "Origin: ${origin}")',
            PUBLISH_SCRIPT.read_text(encoding="utf-8"),
        )
        self.assertNotIn(
            "--retry-all-errors",
            PUBLISH_SCRIPT.read_text(encoding="utf-8"),
        )
        self.assertIn("production favicon", result.stdout)

    def test_publish_skips_existing_assets_and_unchanged_favicon(self) -> None:
        result, ossutil_log = self._run_publish(cors=True, existing_assets=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertFalse(ossutil_log.exists())
        self.assertIn("skipped 2 existing assets", result.stdout)
        self.assertIn("favicon is unchanged", result.stdout)

    def test_publish_updates_only_changed_favicon(self) -> None:
        result, ossutil_log = self._run_publish(
            cors=True, existing_assets=True, existing_favicon=b"old-png"
        )
        self.assertEqual(0, result.returncode, result.stderr)
        invocation = ossutil_log.read_text(encoding="utf-8")
        self.assertEqual(1, invocation.count("cp "))
        self.assertIn("/favicon.png", invocation)
        self.assertNotIn("/assets/", invocation)

    def test_publish_uploads_only_missing_asset(self) -> None:
        result, ossutil_log = self._run_publish(
            cors=True, existing_assets=True, missing_asset="index-abc123.css"
        )
        self.assertEqual(0, result.returncode, result.stderr)
        invocation = ossutil_log.read_text(encoding="utf-8")
        self.assertEqual(1, invocation.count("cp "))
        self.assertIn("index-abc123.css", invocation)
        self.assertNotIn("favicon.png", invocation)

    def test_publish_fails_closed_on_asset_lookup_error(self) -> None:
        result, ossutil_log = self._run_publish(cors=True, asset_status=403)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("did not return HTTP 200", result.stderr)
        self.assertFalse(ossutil_log.exists())

    def test_publish_fails_closed_on_favicon_lookup_error(self) -> None:
        result, ossutil_log = self._run_publish(
            cors=True, existing_assets=True, favicon_status=403
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("favicon lookup failed", result.stderr)
        self.assertFalse(ossutil_log.exists())

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
        self.assertIn('docker cp "${asset_container}:/app/web/favicon.png"', body)
        self.assertIn('publish-web-assets-to-oss.sh" "${asset_export_dir}" "${favicon_path}"', body)

    def _run_publish(
        self,
        *,
        cors: bool,
        public_url: str = "https://linkresume-static-test.oss-cn-test.aliyuncs.com/LinkResume/",
        existing_assets: bool = False,
        existing_favicon: bytes | None = None,
        missing_asset: str | None = None,
        asset_status: int | None = None,
        favicon_status: int | None = None,
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

        ossutil_log = root / "ossutil.log"
        remote = root / "remote"
        remote_assets = remote / "LinkResume/assets"
        remote_assets.mkdir(parents=True)
        if existing_assets:
            for asset in asset_dir.iterdir():
                if asset.name != missing_asset:
                    shutil.copyfile(asset, remote_assets / asset.name)
            (remote / "LinkResume/favicon.png").write_bytes(
                existing_favicon if existing_favicon is not None else b"fake-png"
            )
        self._write_executable(
            fake_bin / "ossutil",
            """#!/usr/bin/env python3
import os, pathlib, shutil, sys
args = sys.argv[1:]
assert args[0] == 'cp', args
source, destination = args[1:3]
assert destination.startswith('oss://linkresume-static-test/'), destination
target = pathlib.Path(os.environ['FAKE_REMOTE']) / destination.split('/', 3)[3]
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, target)
with open(os.environ['FAKE_OSSUTIL_LOG'], 'a', encoding='utf-8') as log:
    log.write(' '.join(args) + '\\n')
""",
        )
        self._write_executable(
            fake_bin / "curl",
            """#!/usr/bin/env python3
import os, pathlib, sys, urllib.parse
args = sys.argv[1:]
url = args[-1]
path = pathlib.Path(os.environ['FAKE_REMOTE']) / urllib.parse.unquote(
    urllib.parse.urlsplit(url).path.lstrip('/'))
is_asset = '/assets/' in url
status_key = 'FAKE_ASSET_STATUS' if is_asset else 'FAKE_FAVICON_STATUS'
status = int(os.environ.get(status_key, '0'))
if not status:
    status = 200 if path.is_file() else 404
if '--head' in args:
    headers = f'HTTP/2 {status}\\r\\n'
    if status == 200:
        if is_asset:
            headers += 'Cache-Control: public,max-age=31536000,immutable\\r\\n'
            if os.environ['FAKE_CORS'] == '1':
                headers += 'Access-Control-Allow-Origin: https://linkresume.cn\\r\\n'
        else:
            headers += 'Content-Type: image/png\\r\\n'
            headers += 'Cache-Control: public,max-age=3600\\r\\n'
    sys.stdout.write(headers)
    sys.stdout.write('\\n' + str(status))
else:
    output = args[args.index('--output') + 1]
    pathlib.Path(output).write_bytes(path.read_bytes() if status == 200 else b'')
    sys.stdout.write(str(status))
""",
        )

        environment = os.environ.copy()
        environment.update(
            {
                "PATH": f"{fake_bin}:{environment['PATH']}",
                "FAKE_OSSUTIL_LOG": str(ossutil_log),
                "FAKE_REMOTE": str(remote),
                "FAKE_CORS": "1" if cors else "0",
                "WEB_ASSET_OSS_URL": public_url,
                "WEB_ASSET_OSS_BUCKET": "linkresume-static-test",
                "WEB_ASSET_OSS_PREFIX": "LinkResume",
                "OSS_ACCESS_KEY_ID": "test-access-key-id",
                "OSS_ACCESS_KEY_SECRET": "test-access-key-secret",
                "OSS_REGION": "cn-test",
            }
        )
        if asset_status is not None:
            environment["FAKE_ASSET_STATUS"] = str(asset_status)
        if favicon_status is not None:
            environment["FAKE_FAVICON_STATUS"] = str(favicon_status)
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

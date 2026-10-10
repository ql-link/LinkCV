"""Incremental OSS publishing; unchanged objects still pass public HEAD gates."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import quote

WORKERS = 8


def head(url):
    result = subprocess.run([
        'curl', '--fail', '--silent', '--show-error', '--location', '--head',
        '--header', 'Origin: https://linkresume.cn', '--retry', '2',
        '--connect-timeout', '5', '--max-time', '20', url,
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    responses = list(re.finditer(r'(?m)^HTTP/[\d.]+ \d{3}', result.stdout))
    if not responses:
        raise RuntimeError('OSS HEAD failed: ' + url)
    block = result.stdout[responses[-1].start():]
    status = int(block.split()[1])
    if status == 404:
        return None
    if result.returncode or status != 200:
        raise RuntimeError('OSS HEAD failed (HTTP %s): %s' % (status, url))
    return dict((key.lower(), value.strip()) for key, value in
                (line.split(':', 1) for line in block.splitlines()[1:] if ':' in line))


def digest(path):
    value = hashlib.md5()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def content_matches(headers, path, checksum, url):
    if headers.get('content-length') != str(path.stat().st_size):
        return False
    if headers.get('etag', '').strip('"').lower() == checksum:
        return True
    # Multipart uploads have non-MD5 ETags. Only those ambiguous cases need
    # a content download; do not overwrite an unchanged object just for that.
    with tempfile.TemporaryDirectory(prefix='linkresume-oss-check-') as temporary:
        downloaded = Path(temporary) / 'object'
        subprocess.run([
            'curl', '--fail', '--silent', '--show-error', '--location',
            '--retry', '2', '--connect-timeout', '5', '--max-time', '60',
            '--output', str(downloaded), url,
        ], check=True)
        return digest(downloaded) == checksum


def metadata_error(headers, relative):
    cache = headers.get('cache-control', '').lower()
    if relative == 'favicon.png':
        if headers.get('content-type', '').split(';')[0].lower() != 'image/png':
            return 'Production favicon does not return image/png'
        if 'max-age=3600' not in cache or 'immutable' in cache:
            return 'Production favicon is missing short cache headers'
    else:
        if 'max-age=31536000' not in cache or 'immutable' not in cache:
            return 'OSS asset is missing immutable cache headers'
        if relative.endswith(('.js', '.woff', '.woff2', '.ttf', '.otf')):
            if headers.get('access-control-allow-origin') not in ('*', 'https://linkresume.cn'):
                return 'OSS module or font asset does not allow the https://linkresume.cn origin'
    return None


def main(asset_dir, favicon):
    base = os.environ['WEB_ASSET_OSS_URL']
    destination = 'oss://%s/%s/' % (os.environ['WEB_ASSET_OSS_BUCKET'], os.environ['WEB_ASSET_OSS_PREFIX'])
    files = [(path, 'assets/' + path.relative_to(asset_dir).as_posix())
             for path in sorted(asset_dir.rglob('*')) if path.is_file()]
    files.append((favicon, 'favicon.png'))
    for path, _ in files:
        if path.is_symlink():
            raise RuntimeError('Symbolic links are not supported in Web assets')
    checksums = {relative: digest(path) for path, relative in files}

    def inspect(item):
        path, relative = item
        url = base + quote(relative, safe='/._~-')
        headers = head(url)
        if headers is None:
            return item
        same = content_matches(headers, path, checksums[relative], url)
        return None if same and not metadata_error(headers, relative) else item

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        changed = [item for item in pool.map(inspect, files) if item is not None]
    changed_assets = [item for item in changed if item[1] != 'favicon.png']
    if changed_assets:
        with tempfile.TemporaryDirectory(prefix='linkresume-oss-assets-') as temporary:
            staging = Path(temporary)
            for path, relative in changed_assets:
                target = staging / relative[len('assets/') :]
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
            print('Uploading %s changed immutable Web assets' % len(changed_assets), flush=True)
            subprocess.run(['ossutil', 'cp', '-r', str(staging) + '/', destination + 'assets/',
                            '--force', '--acl', 'default', '--cache-control',
                            'public,max-age=31536000,immutable'], check=True)
    if any(relative == 'favicon.png' for _, relative in changed):
        print('Uploading changed production favicon', flush=True)
        subprocess.run(['ossutil', 'cp', str(favicon), destination + 'favicon.png',
                        '--force', '--acl', 'default', '--cache-control',
                        'public,max-age=3600'], check=True)

    def verify(item):
        path, relative = item
        url = base + quote(relative, safe='/._~-')
        headers = head(url)
        if headers is None:
            raise RuntimeError('Uploaded OSS object is missing: ' + url)
        error = metadata_error(headers, relative)
        if error:
            raise RuntimeError(error + ': ' + url)
        if not content_matches(headers, path, checksums[relative], url):
            raise RuntimeError('Uploaded OSS object content does not match: ' + url)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(verify, changed))
    print('Verified %s immutable Web assets and production favicon; uploaded=%s, skipped=%s'
          % (len(files) - 1, len(changed), len(files) - len(changed)), flush=True)


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]), Path(sys.argv[2]))
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

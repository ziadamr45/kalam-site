#!/usr/bin/env python3
"""Set a GitHub Actions secret via the GitHub API."""
import sys
import json
import urllib.request
from base64 import b64encode
from nacl import public, encoding

GH_TOKEN = "REDACTED_GH_TOKEN"
REPO = "ziadamr45/kalam-site"
SECRET_NAME = "DEPLOY_HOOK_URL"
SECRET_VALUE = "https://api.vercel.com/v1/integrations/deploy/prj_IohIvtSmTQiX98GeSOM83wWAykL9/wsirENBOME"

def api(method, path, body=None):
    url = f"https://api.github.com/repos/{REPO}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, data=data, headers={
        "Authorization": f"token {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "{}")

# 1. Fetch repo public key
status, key_resp = api("GET", "actions/secrets/public-key")
if status != 200:
    print(f"ERROR fetching public key: {status} {key_resp}", file=sys.stderr)
    sys.exit(1)

key_id = key_resp["key_id"]
pub_key_b64 = key_resp["key"]
print(f"Got repo public key: id={key_id}")

# 2. Encrypt secret
pub_key = public.PublicKey(pub_key_b64.encode(), encoding.Base64Encoder())
sealed = public.SealedBox(pub_key)
encrypted = sealed.encrypt(SECRET_VALUE.encode())
encrypted_b64 = b64encode(encrypted).decode()

# 3. PUT secret
status, resp = api("PUT", f"actions/secrets/{SECRET_NAME}", {
    "encrypted_value": encrypted_b64,
    "key_id": key_id,
})
if status in (201, 204):
    print(f"✅ Secret '{SECRET_NAME}' set successfully (HTTP {status})")
else:
    print(f"❌ Failed to set secret: HTTP {status} {resp}", file=sys.stderr)
    sys.exit(1)

# Verify by listing secrets
status, list_resp = api("GET", "actions/secrets")
print(f"\n📋 All repo secrets ({list_resp.get('total_count', 0)} total):")
for s in list_resp.get("secrets", []):
    print(f"  - {s['name']}  (created: {s.get('created_at')})")

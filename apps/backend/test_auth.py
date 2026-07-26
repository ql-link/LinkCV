"""临时测试脚本：验证注册 -> /auth/me 全流程"""
import httpx

BASE = "http://127.0.0.1:8001"

# 注册 (unique email)
import uuid
email = f"debug-{uuid.uuid4().hex[:8]}@test.com"
resp = httpx.post(f"{BASE}/api/auth/register", json={"email": email, "password": "test1234"})
print("Register:", resp.status_code, resp.json().get("detail"))
access = resp.cookies.get("resume_session")
refresh = resp.cookies.get("resume_refresh")
print("Access cookie:", access[:80] if access else None)
print("Refresh cookie:", refresh[:80] if refresh else None)

# 用 cookie header
headers = {"Cookie": f"resume_session={access}; resume_refresh={refresh}"}
me = httpx.get(f"{BASE}/api/auth/me", headers=headers)
print("Me (manual cookie):", me.status_code, me.text[:120])

# 用 cookie jar
me2 = httpx.get(f"{BASE}/api/auth/me", cookies=resp.cookies)
print("Me (cookie jar):", me2.status_code, me2.text[:120])

# Code Bridge License Server Design

## Goal

Build a minimal, secure license/ban server that controls extension access even if the extension ZIP is shared. The server will validate license tokens and enforce bans without ever receiving or storing GitHub access tokens.

Target capacity: at least 100 requests per minute (sustained), with headroom for bursts.

---

## Non-Goals

- No GitHub token storage.
- No analytics or heavy user tracking (optional later).
- No complex billing system (optional later).

---

## High-Level Architecture

- Client: Code Bridge extension
- Server: Express (Node.js)
- Database: MongoDB
- Auth: JWT for session tokens + API key for admin routes
- Deployment: single instance with horizontal scaling later if needed

---

## Core Responsibilities

1. Validate license tokens on startup and periodically.
2. Enforce bans by license key and/or deviceId.
3. Control device limits per license.
4. Provide admin endpoints to create/revoke licenses and ban/unban devices.

---

## Data Model (MongoDB)

### 1) licenses

Represents a license key and its constraints.

Fields:

- \_id (ObjectId)
- licenseKey (string, unique, opaque)
- status (string: active | revoked | expired)
- maxDevices (number, default 1)
- expiresAt (Date, optional)
- createdAt (Date)
- notes (string, optional)

Indexes:

- unique index on licenseKey
- index on status
- index on expiresAt

### 2) activations

Represents a device that has activated a license.

Fields:

- \_id (ObjectId)
- licenseId (ObjectId)
- deviceId (string)
- status (string: active)
- deactivatedAt (Date, optional)
- firstSeen (Date)
- lastSeen (Date)
- appVersion (string, optional)
- platform (string, optional)

Indexes:

- index on licenseId
- unique compound index on licenseId + deviceId
- index on lastSeen

### 3) bans

Explicit bans independent of activation state.

Fields:

- \_id (ObjectId)
- type (string: deviceId | licenseKey)
- value (string)
- reason (string)
- createdAt (Date)

Indexes:

- unique compound index on type + value

Notes:
- Bans are the single source of truth for blocking access. Activations do not store a banned state.

---

## API Endpoints

All requests are JSON over HTTPS.

### Public Endpoints

#### POST /activate

Purpose: Exchange license key + deviceId for a short-lived token.

Input:
{
"licenseKey": "CB-XXXX-YYYY-ZZZZ",
"deviceId": "uuid-v4",
"appVersion": "1.3.0"
}

Output (success):
{
"valid": true,
"token": "jwt",
"expiresAt": "2026-02-16T12:00:00.000Z",
"nextCheckInSeconds": 21600
}

Output (failure):
{
"valid": false,
"reason": "revoked" | "expired" | "banned" | "device_limit" | "not_found"
}

Checks:

- licenseKey exists and status = active
- license not expired
- not banned (licenseKey or deviceId)
- idempotent activation: if licenseKey + deviceId already active, return existing token (do not increment device count)
- otherwise enforce device count <= maxDevices and create activation

#### POST /validate

Purpose: Validate token for ongoing access.

Input:
{
"token": "jwt",
"deviceId": "uuid-v4"
}

Output:
{
"valid": true,
"reason": "ok",
"nextCheckInSeconds": 21600
}

If invalid:
{
"valid": false,
"reason": "revoked" | "expired" | "banned" | "token_invalid"
}

Checks:

- JWT signature valid
- token not expired
- license still active
- device not banned (check bans collection)
- activation exists and is not deactivated

#### POST /deactivate

Purpose: Deactivate a device for a license.

Input:
{
"token": "jwt",
"deviceId": "uuid-v4"
}

Output:
{ "success": true }

Behavior:
- set activations.deactivatedAt to the current time for the matching deviceId
- treat deactivated activations as non-active in validation

### Admin Endpoints (API key required)

Auth:
- Authorization: Bearer <API_KEY>
- Optional: X-API-Key: <API_KEY>

API key guidance:
- Use a 32+ char cryptographically random string (prefix like adm_ optional)
- Generate server-side, store hashed, rotate regularly, and revoke on compromise
- Support key expiry/TTL and a rotation process that allows overlap during rollout

#### POST /admin/license/create

Input:
{
"maxDevices": 2,
"expiresAt": "2026-12-01T00:00:00Z",
"notes": "beta access"
}

Output:
{ "licenseKey": "CB-XXXX-YYYY-ZZZZ" }

#### POST /admin/license/revoke

Input:
{ "licenseKey": "CB-XXXX-YYYY-ZZZZ" }

Output:
{ "success": true }

#### POST /admin/ban

Input:
{ "type": "deviceId", "value": "uuid-v4", "reason": "abuse" }

Output:
{ "success": true }

#### POST /admin/unban

Input:
{ "type": "deviceId", "value": "uuid-v4" }

Output:
{ "success": true }

---

## Token Strategy

- Use JWT (HS256) with short expiration (e.g., 24 hours)
- Include licenseId and deviceId in the token payload
- Server validates token on /validate
- Extension stores token locally and revalidates periodically

JWT payload example:
{
"licenseId": "licenseId.toString()",
"deviceId": "uuid-v4",
"exp": 1234567890
}

---

## Extension Workflow

1. First run

- User enters license key
- Extension generates deviceId (uuid-v4) and stores in chrome.storage.local
- Call /activate
- Store token and nextCheckInSeconds

2. Normal operation

- On startup, call /validate
- If valid, enable core features
- If invalid, disable tracking/upload and show message

3. Periodic validation

- Recheck every nextCheckInSeconds (default 6-12 hours)
- Optional grace period if server is unreachable (e.g., 24-72 hours)

---

## Performance Targets

Target: 100 requests per minute sustained.

This is very small for Node + MongoDB. A single instance can handle 1,000+ rpm easily.

Recommended limits:

- /activate: rate limit 10/min per IP
- /validate: rate limit 60/min per IP (or higher)
- admin routes: strict rate limit and API key

---

## Security Practices

- HTTPS only
- Do not log tokens in plain text
- Rate limit all endpoints
- Store only minimal device identifiers (generated UUID)
- Never store GitHub tokens
- Store JWT signing keys in environment variables or a secrets manager and rotate regularly
- Allow small clock skew on JWT expiration checks (60-120s leeway)
- Manage admin API keys securely: store hashed, rotate on a schedule, and revoke on compromise

---

## Error Handling and Responses

- Always return structured JSON with reason codes
- Do not leak internal errors to clients

Example failure:
{
"valid": false,
"reason": "revoked"
}

---

## Implementation Plan (MVP)

1. Set up Express server + MongoDB connection
2. Define Mongoose models
3. Implement /activate and /validate
4. Implement admin endpoints (create/revoke/ban)
5. Add rate limiting and API key middleware
6. Add basic logging
7. Deploy to Render/Fly/Railway

---

## Future Extensions (Optional)

- Device list dashboard for admins
- License self-service portal
- Webhook or email on ban/revoke
- Multi-tenant license groups
- Usage analytics (counts only, no PII)

---

## Capacity Notes

At 100 requests/minute:

- MongoDB and Express on a single small instance are sufficient.
- Consider a small cache for license lookups if traffic grows.

---

## Summary

This design gives you real remote control with minimal complexity:

- Token validation + device bans
- No GitHub token risk
- Scales easily past 100 rpm

If you want, the next step is an implementation blueprint or a minimal Express codebase.

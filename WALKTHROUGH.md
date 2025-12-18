# Walkthrough - Phase 1 & 2: TACo-MDT Signer Microservice

## Overview

A fully production-ready Express.js microservice for TACo smart account management, complete with API Key security and CI automation.

## Project Structure

```text
src/
├── app.ts                  # Express App setup (Auth Middleware, Routes)
├── server.ts               # Entry point (Port 3000)
├── middleware/
│   └── auth.middleware.ts  # API Key Validation
├── controllers/
│   └── account.controller.ts
├── services/
├── routes/
└── utils/
.github/
└── workflows/
    └── verify.yml          # CI Pipeline (Syntax + Lint)
```

## API Usage (Secured)

**Authentication Required**: `x-api-key` header.
**Development Key**: `default_insecure_key_for_dev`

### 1. Health Check (Public)

**Endpoint**: `GET /health`

```bash
curl http://localhost:3000/health
```

### 2. Check Balance (Protected)

**Endpoint**: `GET /v1/account/:address/balance`

```bash
curl -H "x-api-key: default_insecure_key_for_dev" http://localhost:3000/v1/account/0x55644d1846aCd59d070F90003C2f121314000428/balance
```

### 3. Create TACo Smart Account (Protected)

**Endpoint**: `POST /v1/account`

```bash
curl -X POST -H "x-api-key: default_insecure_key_for_dev" http://localhost:3000/v1/account
```

## Verification

### Security Verification

1.  **Unauthorized Request**:
    ```bash
    curl -v http://localhost:3000/v1/account/0x.../balance
    # Output: 401 Unauthorized
    ```
2.  **Authorized Request**:
    ```bash
    curl -v -H "x-api-key: default_insecure_key_for_dev" http://localhost:3000/v1/account/0x.../balance
    # Output: 200 OK
    ```

### Automation Verification

- Push code to `main` or `develop`.
- Check "Actions" tab in GitHub to see `Verify` workflow running.

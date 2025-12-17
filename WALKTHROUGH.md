# Walkthrough - Phase 1: Express.js Backend Migration

## Overview
Successfully migrated the PoC scripts into a structured **Express.js** microservice. The application now exposes RESTful endpoints for TACo smart account management.

## Project Structure
```text
src/
├── app.ts                  # Express App setup (Middleware, Routes)
├── server.ts               # Entry point (Port 3000)
├── config/                 # (Prepared for env config)
├── controllers/
│   └── account.controller.ts # Handles API logic
├── services/
│   ├── taco.service.ts     # TACo network interaction
│   └── web3.service.ts     # Viem/Ethers providers
├── routes/
│   └── account.routes.ts   # API definitions
└── utils/
    └── taco-account.ts     # Account helpers
```

## API Usage

### 1. Health Check
**Endpoint**: `GET /health`
```bash
curl http://localhost:3000/health
```
**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-12-17T09:27:18.837Z"
}
```

### 2. Check Balance
**Endpoint**: `GET /v1/account/:address/balance`
```bash
curl http://localhost:3000/v1/account/0x55644d1846aCd59d070F90003C2f121314000428/balance
```
**Response**:
```json
{
  "address": "0x55644d1846aCd59d070F90003C2f121314000428",
  "balance": "0.0009293...",
  "symbol": "ETH"
}
```

### 3. Create TACo Smart Account
**Endpoint**: `POST /v1/account`
```bash
curl -X POST http://localhost:3000/v1/account
```
**Response**:
```json
{
  "address": "0x2a456304C6d79C91Ef8a02Bd87f85486d5d2d7E0",
  "threshold": 2,
  "deployed": false
}
```

## Legacy Scripts
The original scripts have been moved to `scripts/` and can still be run:
```bash
npm run demo:legacy
```

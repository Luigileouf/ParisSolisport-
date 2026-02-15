# API MVP - Pronostics points (REST)

Base URL example: `/api/v1`

Auth MVP:
- `Authorization: Bearer <token>`
- Admin routes protected by role `admin`.

Idempotency:
- Mutating endpoints must accept header `Idempotency-Key`.
- Server stores key with result to prevent duplicate writes.

## 1) Auth

### POST /auth/login
Request:
```json
{
  "email": "player@example.com",
  "password": "PlayerDemo123!"
}
```

Response:
```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": "1h",
  "user": {
    "id": "uuid",
    "email": "player@example.com",
    "displayName": "player_demo",
    "role": "player"
  }
}
```

## 2) Users / Wallet

### GET /me
Response:
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "alex",
  "pointsBalance": 120
}
```

### GET /me/ledger?limit=50&cursor=...
Response:
```json
{
  "items": [
    {
      "id": "uuid",
      "entryType": "bet_stake",
      "pointsDelta": -20,
      "balanceAfter": 100,
      "refType": "bet",
      "refId": "uuid",
      "createdAt": "2026-02-11T12:00:00Z"
    }
  ],
  "nextCursor": null
}
```

### GET /me/history?limit=20
Retourne un historique agrege du joueur.

Response:
```json
{
  "limit": 20,
  "bets": [
    {
      "id": "uuid",
      "marketId": "uuid",
      "optionId": "uuid",
      "stakePoints": 20,
      "oddsDecimal": 2,
      "payoutPoints": 0,
      "status": "PLACED",
      "placedAt": "2026-02-14T10:00:00Z",
      "settledAt": null
    }
  ],
  "ledger": [
    {
      "id": "uuid",
      "entryType": "bet_stake",
      "pointsDelta": -20,
      "balanceAfter": 80,
      "refType": "bet",
      "refId": "uuid",
      "createdAt": "2026-02-14T10:00:00Z"
    }
  ],
  "redemptions": [
    {
      "id": "uuid",
      "rewardId": "uuid",
      "partnerName": "Partenaire Demo",
      "rewardTitle": "Reduction 10%",
      "pointsSpent": 80,
      "code": "REWARD-ABC123",
      "status": "FULFILLED",
      "fulfilledAt": "2026-02-14T10:05:00Z",
      "createdAt": "2026-02-14T10:05:00Z"
    }
  ]
}
```

## 3) Markets

### GET /markets?status=OPEN
Returns active markets with options and odds.

### GET /markets/{marketId}
Returns market detail and option list.

## 4) Bets

### POST /bets
Headers:
- `Idempotency-Key: <unique-value>`

Request:
```json
{
  "marketId": "uuid",
  "optionId": "uuid",
  "stakePoints": 20
}
```

Server checks:
- market status is OPEN
- now < closeAt
- stake in allowed range
- user has enough points

Response 201:
```json
{
  "betId": "uuid",
  "status": "PLACED",
  "stakePoints": 20,
  "oddsDecimal": 2.0,
  "pointsBalance": 80
}
```

Errors:
- `400` invalid stake / payload
- `409` market closed or duplicate idempotency key with mismatch
- `422` insufficient points

### GET /me/bets?status=PLACED
Returns user bets.

## 5) Rewards catalog and redemption

### GET /rewards
Returns active partner rewards.

### POST /rewards/{rewardId}/redeem
Headers:
- `Idempotency-Key: <unique-value>`

Request:
```json
{}
```

Response 201:
```json
{
  "redemptionId": "uuid",
  "status": "FULFILLED",
  "pointsSpent": 200,
  "code": "PARTNER-ABC-123",
  "pointsBalance": 40
}
```

Errors:
- `409` out of stock
- `422` insufficient points

## 6) Ad reward

### POST /ads/reward-callback
Called server-to-server by ad network.

Request:
```json
{
  "network": "example_ads",
  "networkEventId": "evt_123",
  "userExternalId": "uuid",
  "watched": true,
  "signature": "signed_value"
}
```

Server checks:
- signature valid
- event not already processed
- watched=true and business rules pass
- daily cap not exceeded

Response 200:
```json
{
  "accepted": true,
  "pointsGranted": 20
}
```

## 7) Admin routes

### POST /admin/markets
Create market with options.

### PATCH /admin/markets/{marketId}/status
Set status: OPEN | LOCKED | CANCELED.

### POST /admin/markets/{marketId}/settle
Request:
```json
{
  "winnerOptionId": "uuid",
  "proofUrl": "https://...",
  "note": "validated from broadcast replay"
}
```

Behavior:
- set market status to SETTLED
- update bets WIN/LOSS
- write ledger entries for payouts
- all in transactional batch

### POST /admin/rewards
Create partner reward item.

## 8) Error model (uniform)
```json
{
  "error": {
    "code": "INSUFFICIENT_POINTS",
    "message": "Not enough points to place this bet",
    "requestId": "req_..."
  }
}
```

## 9) Security and reliability checklist
- JWT validation and role checks.
- Rate limiting on mutating routes.
- Idempotency storage with TTL policy.
- Request logs with requestId.
- DB transactions for each balance mutation.
- Monitoring: 4xx/5xx rates, latency p95, settlement failures.

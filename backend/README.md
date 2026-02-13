# Insolite Points API (MVP)

Backend Node.js + Fastify + PostgreSQL pour un jeu de pronostics sportifs en points.

## 1) Prerequis
- Node.js 20+
- PostgreSQL 14+

## 2) Installation
```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run dev
```

API base URL: `http://localhost:3000/api/v1`

## 3) Auth en local (JWT)
- Login joueur:
- email: `player@example.com`
- password: `PlayerDemo123!`
- Login admin:
- email: `admin@example.com`
- password: `AdminDemo123!`

Obtenir un token:
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"player@example.com","password":"PlayerDemo123!"}'
```

## 4) Idempotency
Endpoints mutatifs utilisent `Idempotency-Key`.
- `POST /bets`
- `POST /rewards/{rewardId}/redeem`
- `POST /ads/reward-callback` (body fallback accepted)

## 5) Services critiques implementes
- `placeBet` -> `src/services/bets-service.js`
- `settleMarket` -> `src/services/bets-service.js`
- `redeemReward` -> `src/services/rewards-service.js`
- `creditAdReward` -> `src/services/ad-reward-service.js`

## 6) Migrations
- `migrations/001_init.sql` schema complet
- `migrations/002_seed_dev.sql` donnees de demo locales
- `migrations/003_auth_users.sql` role + password hash

## 7) Contrat API
- OpenAPI: `../docs/openapi.yaml`
- Postman collection: `postman/insolite-points.postman_collection.json`

## 8) Tests integration
Assure-toi d'avoir PostgreSQL lance et `.env` configure (`DATABASE_URL`).
```bash
npm test
# ou uniquement la suite integration
npm run test:integration
# ou parcours e2e (login JWT -> bet -> settle -> redeem)
npm run test:e2e
```

## 9) Smoke test PowerShell (scenario complet)
Depuis la racine du projet:
```powershell
.\backend\scripts\smoke-test.ps1
```

Options utiles:
```powershell
.\backend\scripts\smoke-test.ps1 -BaseUrl "http://localhost:3000/api/v1" -SkipAdCapTest
.\backend\scripts\smoke-test.ps1 -ResetDb -SkipAdCapTest
```

`-SkipAdCapTest` saute entierement les appels `POST /ads/reward-callback`.
`-ResetDb` reinitialise le schema `public` puis reapplique toutes les migrations avant le scenario.

## 10) CI GitHub Actions
Workflow: `.github/workflows/backend-ci.yml`

Il execute:
1. `npm ci`
2. `npm run migrate`
3. `npm test`
4. demarrage API
5. smoke test `-ResetDb -SkipAdCapTest`

Version npm (depuis `backend/`):
```bash
npm run smoke
npm run smoke:reset
npm run smoke:full
```

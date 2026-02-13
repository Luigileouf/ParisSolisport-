# MVP Spec - Jeu de pronostics points (sans argent)

## 1) Objectif produit
Construire un jeu de pronostics sportifs insolites sans argent reel:
- Les joueurs misent des points virtuels.
- Les gains/pertes modifient leur capital de points.
- Les points peuvent etre echanges contre des avantages partenaires.
- Les joueurs a 0 point peuvent recharger via publicites reward.

## 2) Regles metier (MVP)

### 2.1 Inscription
- A la creation de compte: `+100 points` une seule fois.
- Le credit initial est ecrit dans un ledger (historique immuable).

### 2.2 Paris (pronostics)
- Un joueur peut placer un pari uniquement si:
- Le marche est `OPEN`.
- L'heure courante est `< close_at`.
- Le joueur a assez de points.
- Mises limites MVP:
- `stake_min = 5`
- `stake_max = 50`

### 2.3 Settlement (resultat)
- Si `WIN`: crediter `stake + gain`.
- Si `LOSS`: la mise reste perdue.
- Formule simple MVP:
- `payout = stake * odds_decimal`
- `net_gain = payout - stake`

### 2.4 Redeem partenaires
- Le joueur echange des points contre une recompense du catalogue.
- Debiter les points uniquement si stock disponible.
- Crer un code redemption unique par demande validee.

### 2.5 Recharge via pub reward
- Exemple: `1 pub validee = +20 points`.
- Plafond journalier recommande:
- `max_ads_per_day = 5`
- `max_points_ads_per_day = 100`
- Credit uniquement apres callback serveur verifie (pas via front).

## 3) Entites et etats

### 3.1 Etats marche
- `DRAFT`: creation interne.
- `OPEN`: pari autorise.
- `LOCKED`: paris fermes.
- `SETTLED`: resultat publie.
- `CANCELED`: marche annule.

### 3.2 Etats pari
- `PLACED`: mise acceptee.
- `WIN`: gagnant.
- `LOSS`: perdant.
- `VOID`: annule (rembourse).

### 3.3 Etats redemption
- `REQUESTED`
- `FULFILLED`
- `REJECTED`
- `CANCELED`

## 4) Integrite points (critique)

Toutes les variations de points passent par un ledger:
- `signup_bonus`
- `bet_stake`
- `bet_payout`
- `bet_refund`
- `reward_redeem`
- `ad_reward`
- `manual_adjustment`

Regles:
- Interdire toute maj directe "silencieuse" du solde.
- Chaque ecriture doit avoir un `idempotency_key` unique.
- Solde derivable du ledger a tout moment.

## 5) Anti-fraude MVP
- Idempotence obligatoire sur:
- placement pari
- callback pub
- settlement batch
- Rate limit API (IP + user).
- Device fingerprint basique + verification email.
- Detection multi-comptes:
- meme device + meme IP + creation proche.
- Journal d'audit admin pour actions sensibles.

## 6) Back-office (minimal)
- CRUD marches/questions/options.
- Ouverture/fermeture manuelle.
- Settlement manuel avec preuve (URL video/image/commentaire).
- Gestion catalogue recompenses partenaires.
- Vue transactions points par joueur.

## 7) KPIs a suivre
- DAU/WAU.
- Taux de placement: `players_with_bet / active_players`.
- Taux de retention D1/D7.
- Point sink/source:
- sources: signup, pub, gains
- sinks: pertes, redeem
- Taux redemption partenaires.
- Cout moyen d'acquisition point (via ads reward + promos).

## 8) API et architecture (MVP)
- Client web/mobile -> API REST.
- Service points (ledger) transactionnel.
- Service markets/bets.
- Service ad-reward callback.
- Service rewards partenaires.
- DB PostgreSQL.
- Redis optionnel pour verrous + rate limit.

## 9) Regles legales et plateforme (a valider)
- Positionner le produit en "jeu gratuit de pronostics", pas argent reel.
- CGU + regles officielles + age gate + territoires autorises.
- Politique anti-abus et moderation.
- Validation juridique locale avant recompenses de valeur (coupons/cadeaux).

## 10) Definition of Done (MVP)
- Un nouveau joueur obtient 100 points et voit son solde.
- Un pari valide debite le solde + cree transaction ledger.
- Settlement WIN/LOSS met a jour solde de facon exacte.
- Redeem debite points et cree code partenaire.
- Ad reward credite uniquement via callback valide.
- Tests: unitaires regles metier + integration API critiques.
- Monitoring de base en prod (logs erreurs + latence + taux 5xx).

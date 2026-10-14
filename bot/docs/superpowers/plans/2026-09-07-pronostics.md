# Plan d'implémentation des pronostics

**Objectif :** pronostiquer les matchs et consulter un classement persistant par serveur.
**Architecture :** repository PostgreSQL dédié, commandes Discord séparées des compteurs, branchement sur le runtime existant.
**Technologies :** TypeScript, discord.js, pg, Vitest ; aucune dépendance supplémentaire.
**Spécification :** `docs/superpowers/specs/2026-09-07-pronostics-design.md`.

- [x] Ajouter les tests PostgreSQL dans `tests/db.integration.test.ts` : remplacement, refus après début, scores invalides, 3/5 points, BO1, correction, annulation, séparation des serveurs, ex æquo et concurrence. Vérifier l'échec avant implémentation.
- [x] Créer `migrations/009_predictions.sql` et `src/db/prediction-repository.ts` : identifiant numérique des matchs, pronostics uniques, transaction de validation et classement calculé avec pagination. Exécuter les tests PostgreSQL.
- [x] Ajouter `tests/prediction-commands.test.ts` : saisie privée, refus hors serveur, autocomplétion et pagination. Vérifier l'échec, puis créer `src/bot/prediction-commands.ts` et brancher les commandes dans `commands.ts`, `interactions.ts`, `runtime.ts`.
- [x] Documenter les commandes, le barème et l'activation dans `README.md`. Exécuter toute la suite avec PostgreSQL temporaire, `pnpm typecheck` et `pnpm build` ; examiner les limites.

Vérifications finales : 164 tests réussis dans 27 fichiers, dont 43 tests PostgreSQL ; vérification TypeScript et compilation réussies. Revue indépendante : recherche par alias MSI/Worlds corrigée et testée. Rattrapage des anciens résultats ajouté dans `MatchSync`, avec tests du cumul et du regroupement par journée UTC. Aucune publication Discord ni connexion à la base du bot.

Exécution dans cette session. Ce dossier ne contient pas de dépôt Git ; aucun commit n'est possible.

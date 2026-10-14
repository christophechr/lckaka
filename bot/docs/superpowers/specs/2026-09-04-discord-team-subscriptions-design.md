# Bot Discord LCK — abonnements, rappels et résultats

Date : 4 septembre 2026

## Contexte

Le projet publie déjà chaque lundi le programme LCK de la semaine dans Discord au moyen d'un webhook. Cette publication reste inchangée. La nouvelle fonctionnalité ajoute une véritable application Discord au même processus Node.js pour gérer des abonnements par rôle, envoyer un rappel avant les matchs et publier leurs résultats.

Le service sera hébergé sur un VPS avec Docker Compose et PostgreSQL. Il doit fonctionner sur plusieurs serveurs Discord, chacun possédant sa propre configuration.

## Objectifs

- Permettre à un membre de suivre ou de ne plus suivre une équipe LCK depuis un panneau permanent.
- Représenter chaque abonnement par un rôle Discord géré par le bot.
- Envoyer un rappel 30 minutes avant chaque match en mentionnant les deux rôles concernés.
- Publier le résultat lorsque Leaguepedia fournit le vainqueur et les scores.
- Masquer le score et le vainqueur avec les spoilers Discord.
- Conserver la configuration et l'état des notifications dans PostgreSQL.
- Résister aux redémarrages sans répéter les notifications déjà terminées dans le fonctionnement normal.

## Hors périmètre

- Le planning hebdomadaire reste publié par le webhook existant.
- Aucun abonnement par message privé.
- Aucun tableau de classement, pronostic ou statistique de joueur.
- Aucun rôle coloré ou affiché séparément dans la liste des membres.
- Aucune file de messages externe ni séparation en plusieurs services applicatifs.

## Architecture

Un seul processus Node.js contient quatre modules aux responsabilités distinctes :

1. **Planning hebdomadaire** : le comportement actuel et son webhook restent isolés dans leurs modules existants.
2. **Client Discord** : connexion Gateway, enregistrement et traitement des commandes, gestion du panneau et des rôles.
3. **Client Leaguepedia** : récupération des équipes, des horaires et des résultats au moyen de l'API MediaWiki et de Cargo.
4. **Worker de notifications** : synchronisation du planning, déclenchement des rappels, surveillance des résultats et envoi Discord.

Les modules Discord et de notifications accèdent à PostgreSQL par des dépôts ciblés. Ils partagent les types métier de match et d'équipe, mais ne dépendent pas directement l'un de l'autre.

Au démarrage, l'application :

1. valide les variables d'environnement ;
2. attend que PostgreSQL soit disponible ;
3. applique les migrations SQL en attente ;
4. charge les configurations des serveurs ;
5. démarre le client Discord ;
6. synchronise le planning Leaguepedia ;
7. démarre les boucles de rappels et de résultats ;
8. conserve la tâche du planning hebdomadaire par webhook.

## Commandes d'administration

Les commandes sont limitées aux serveurs Discord et déclarent par défaut la permission `ManageGuild`. La permission est également vérifiée lors de chaque interaction.

### `/config notifications salon`

- Enregistre le salon dans lequel seront envoyés les rappels et résultats.
- Vérifie que le bot peut voir le salon, y écrire et y intégrer des liens.
- Répond de manière éphémère avec le résultat de la configuration.

### `/config abonnements salon`

- Enregistre le salon consacré aux abonnements.
- Publie le panneau permanent si aucun message valide n'existe.
- Met à jour le panneau existant si son identifiant est encore accessible.
- Recrée le panneau si le message a été supprimé, puis enregistre son nouvel identifiant.
- Répond de manière éphémère à l'administrateur.

Le déploiement en développement peut enregistrer les commandes dans un serveur de test pour une propagation immédiate. Le déploiement de production utilise les commandes globales.

## Panneau d'abonnement

Le panneau contient un embed explicatif et un menu déroulant persistant à choix unique. Les équipes sont triées par nom. La valeur d'une option est une clé d'équipe stable et son libellé est le nom Leaguepedia.

Une sélection bascule l'état de l'abonnement :

- si le membre ne possède pas le rôle, le bot le lui attribue ;
- s'il le possède, le bot le lui retire.

Le bot répond de manière éphémère avec l'équipe et le nouvel état. L'utilisateur répète l'opération pour suivre plusieurs équipes.

Un menu partagé ne peut pas représenter les choix propres à chaque membre. Il ne contient donc aucune option sélectionnée par défaut. L'état réel est toujours lu depuis les rôles du membre au moment de l'interaction.

Les équipes proposées sont déduites des matchs LCK récents et à venir connus de Leaguepedia. Les valeurs vides et `TBD` sont exclues. La dernière liste valide est conservée en base afin que le panneau reste utilisable si Leaguepedia est temporairement indisponible. Si aucune liste n'a encore pu être chargée, la publication du panneau échoue avec une explication et peut être relancée. Le nombre d'équipes LCK doit rester sous la limite Discord de 25 options ; sinon, le panneau est divisé en plusieurs menus.

## Rôles d'équipe

Chaque rôle est enregistré par serveur et par clé d'équipe. Son nom suit le format `LCK · <équipe>`, par exemple `LCK · T1`.

Lors du premier abonnement à une équipe :

1. le bot recherche le rôle déjà associé dans PostgreSQL ;
2. si ce rôle n'existe plus, il recherche un rôle du même nom créé précédemment ;
3. s'il n'en trouve pas, il crée un rôle sans permission, sans couleur, non séparé et non mentionnable ;
4. il vérifie que le rôle est inférieur à son propre rôle dans la hiérarchie ;
5. il enregistre l'association, puis attribue le rôle au membre.

Les rôles Discord sont la source de vérité des abonnements individuels. Aucun identifiant d'utilisateur ni abonnement individuel n'est dupliqué dans PostgreSQL.

Le bot doit disposer de `ManageRoles`. Son rôle doit être placé au-dessus des rôles LCK. Les rôles d'équipe restent non mentionnables par les membres ; le bot utilise sa permission `MentionEveryone` et limite chaque envoi aux identifiants de rôles explicitement autorisés.

## Données Leaguepedia

Le client conserve le contournement actuel du quota de `action=cargoquery` en exécutant les requêtes Cargo au moyen de `action=parse`.

La synchronisation récupère au minimum :

- `MatchId` ;
- `Team1` et `Team2` ;
- `DateTime_UTC` ;
- `BestOf` ;
- `OverviewPage` ;
- `Winner` ;
- `Team1Score` et `Team2Score` ;
- `IsNullified`.

Seuls les tournois dont la ligue vaut `LoL Champions Korea` sont retenus. Contrairement à la requête du planning hebdomadaire, la synchronisation du bot inclut les lignes invalidées afin de pouvoir marquer comme annulé un match précédemment enregistré. Un résultat est considéré comme final uniquement lorsque `Winner` désigne une équipe valide et que les deux scores sont présents et cohérents.

La synchronisation générale s'exécute au démarrage puis toutes les quinze minutes. Elle met toujours à jour l'état et le résultat du match. Un changement d'horaire recalcule un rappel encore en attente, mais ne répète pas un rappel déjà envoyé.

## Rappels

Une boucle locale vérifie chaque minute les matchs dont l'heure est atteinte pour le rappel :

- début dans 30 minutes ou moins ;
- match pas encore commencé ;
- match non annulé ;
- rappel pas déjà terminé pour ce serveur.

Cette fenêtre permet d'envoyer un rappel légèrement tardif après un court redémarrage, tant que le match n'a pas commencé.

Le message comprend :

- dans `content`, les rôles connus des deux équipes ;
- dans un embed, les deux équipes, le format Bo3/Bo5, un timestamp Discord localisé et un lien Leaguepedia.

Les mentions sont envoyées avec `allowed_mentions.parse` vide et `allowed_mentions.roles` contenant exclusivement les deux rôles concernés. Si aucun rôle n'existe encore pour une équipe, le message est tout de même publié sans cette mention.

## Résultats

À partir de l'heure prévue du match, le worker vérifie les matchs non finalisés toutes les cinq minutes. Dès que Leaguepedia fournit un résultat valide, il met à jour le match et publie une notification sur chaque serveur configuré.

Le titre de l'embed révèle uniquement l'affiche. Le score et le vainqueur sont enveloppés ensemble dans les balises Discord `||spoiler||`, par exemple :

```text
Résultat disponible — T1 contre Gen.G
||T1 3 – 2 Gen.G
Vainqueur : T1||
```

Le contenu extérieur à l'embed mentionne les rôles connus des deux équipes, avec la même restriction `allowed_mentions` que pour les rappels.

## Persistance PostgreSQL

Les migrations SQL créent quatre tables principales.

### `guild_configs`

- `guild_id` : clé primaire ;
- `notification_channel_id` ;
- `subscription_channel_id` ;
- `subscription_message_id` ;
- dates de création et de mise à jour.

### `team_roles`

- `guild_id` ;
- `team_key` ;
- dernier nom Leaguepedia connu ;
- `role_id` ;
- date de mise à jour ;
- clé primaire composée de `guild_id` et `team_key` ;
- unicité de `guild_id` et `role_id`.

### `matches`

- `match_id` : clé primaire ;
- équipes et clés d'équipe ;
- horaire UTC ;
- format et page du tournoi ;
- état d'annulation ;
- vainqueur et scores facultatifs ;
- date de dernière synchronisation.

### `notification_deliveries`

- `guild_id` ;
- `match_id` ;
- type `reminder` ou `result` ;
- état `pending`, `sending`, `sent` ou `failed` ;
- nombre de tentatives, dernière erreur, identifiant du message Discord et dates ;
- contrainte unique sur `guild_id`, `match_id` et le type.

Le worker réserve une livraison dans une transaction avant l'envoi. Une livraison échouée redevient éligible avec un délai croissant. Une réservation `sending` trop ancienne est récupérée après un redémarrage. Cette stratégie évite les doublons ordinaires ; une interruption exactement entre l'acceptation du message par Discord et l'enregistrement de son identifiant peut exceptionnellement produire une répétition lors de la reprise.

## Gestion des erreurs

- Une indisponibilité Leaguepedia conserve le dernier planning valide et déclenche une nouvelle tentative avec délai croissant.
- Une limitation de débit Discord respecte l'attente fournie par Discord.js.
- Un salon ou rôle supprimé invalide sa référence ; le panneau ou le rôle est recréé lors de la prochaine action appropriée.
- Une permission manquante produit une réponse éphémère détaillant la permission et l'action nécessaires.
- Une erreur sur un serveur ne bloque pas les autres serveurs.
- Les journaux contiennent le serveur, le match et le type de tâche, sans token, URL complète de webhook ni chaîne de connexion PostgreSQL.
- Lors de l'arrêt, le processus cesse d'accepter de nouvelles tâches, termine les envois en cours, ferme Discord et le pool PostgreSQL.

## Docker Compose et configuration

Docker Compose définit :

- un service `app` construit depuis le projet, redémarré automatiquement ;
- un service `postgres` avec contrôle de santé et volume nommé persistant ;
- une dépendance de santé de l'application vers PostgreSQL.

Variables d'environnement :

- `DISCORD_TOKEN` ;
- `DISCORD_CLIENT_ID` ;
- `DISCORD_GUILD_ID` facultatif pour les commandes du serveur de test ;
- `DATABASE_URL` ;
- `LCK_MATCH_CALENDAR_WEBHOOK_URL` déjà utilisé ;
- `TZ=Europe/Paris` pour la lisibilité des journaux, sans dépendre de ce réglage pour les calculs UTC.

L'invitation Discord utilise les scopes `bot` et `applications.commands`. Les permissions requises sont `ViewChannel`, `SendMessages`, `EmbedLinks`, `ReadMessageHistory`, `ManageRoles` et `MentionEveryone`.

## Tests

Les tests Vitest existants restent actifs. Les nouveaux tests couvrent :

- la validation de la configuration Discord et PostgreSQL ;
- le contrôle de `ManageGuild` sur les commandes `/config` ;
- la création, la réutilisation et la recréation d'un rôle ;
- le basculement abonnement/désabonnement à partir des rôles réels du membre ;
- la génération et la restauration du panneau ;
- le calcul du rappel à 30 minutes, y compris après un court redémarrage ;
- l'unicité et les transitions d'état des livraisons ;
- l'extraction et la validation des scores Leaguepedia ;
- les spoilers et la restriction des mentions dans les messages ;
- l'isolation entre plusieurs serveurs ;
- les migrations sur une base PostgreSQL de test.

Une validation manuelle finale est effectuée dans un serveur Discord de test : configuration des deux salons, sélection d'une équipe, attribution puis retrait du rôle, rappel accéléré et résultat factice. Aucun test automatisé ne publie dans le serveur réel.

## Critères d'acceptation

- Un administrateur peut configurer les deux salons avec les commandes prévues.
- Un membre peut ajouter ou retirer plusieurs abonnements en utilisant le panneau permanent.
- Les rôles manquants sont créés automatiquement avec des permissions sûres.
- Chaque serveur reçoit au plus une livraison terminée de chaque type par match dans le fonctionnement normal.
- Le rappel est éligible 30 minutes avant le match et ne part jamais après le début prévu.
- Le résultat n'est envoyé qu'après validation du vainqueur et des deux scores.
- Le vainqueur et le score sont cachés derrière un spoiler.
- Seuls les rôles des équipes du match peuvent être mentionnés.
- Les données survivent au redémarrage des conteneurs.
- Le planning hebdomadaire continue d'être envoyé par le webhook existant.

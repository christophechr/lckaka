# Bot et calendrier LoL Esports vers Discord

Ce programme publie les calendriers LCK et LEC du lundi au dimanche, chacun via son webhook : **`LCK_MATCH_CALENDAR_WEBHOOK_URL`** pour la LCK et **`LEC_MATCH_CALENDAR_WEBHOOK_URL`** pour le LEC. La publication se fait :

- manuellement avec `pnpm send` pour la LCK ou `pnpm send:lec` pour le LEC ;
- automatiquement chaque lundi à 08:00, heure de Paris, lorsque `pnpm start` reste lancé.

Les envois manuel et automatique d'une compétition utilisent son webhook Discord. Le service permanent utilise aussi une application Discord pour les commandes, les pronostics et les autres publications. Les matchs proviennent de l'[API Leaguepedia](https://lol.fandom.com/wiki/Help:Leaguepedia_API), via une requête Cargo.

Le même service peut également connecter une application Discord afin de proposer :

- un panneau permettant de suivre une équipe avec un rôle ;
- un rappel 30 minutes avant ses matchs ;
- le résultat final avec le score et le vainqueur masqués en spoiler.
- les logos des équipes dans le menu, les rappels, les résultats et le planning hebdomadaire.

Chaque planning hebdomadaire contient uniquement les rencontres de sa compétition et est envoyé dans le salon associé à son webhook. Ces destinations prévalent sur les anciens salons de calendrier ou de notifications configurés en base. Chaque rencontre indique ses équipes, son format et son horaire. Les semaines chargées sont réparties en plusieurs messages numérotés, sans couper les rencontres. Les deux calendriers ont des suivis d'envoi distincts, même lorsqu'ils sont publiés dans le même serveur.

Les abonnements par équipe, les rappels et les résultats couvrent la LCK, le LEC et les quatre tournois internationaux. Les rôles sont distincts par compétition : suivre T1 en LCK ne l'abonne pas automatiquement aux Worlds. Les rôles internationaux sont également distincts par édition, par exemple `Worlds 2026 · T1`. Les logos déjà synchronisés en LCK restent utilisés lorsqu'ils sont disponibles.

Les panneaux LCK et LEC restent disponibles dans le salon d'abonnements. Chaque tournoi international a son propre panneau :

- apparition à **J−10, à minuit heure de Paris**, selon la date de début publiée sur Leaguepedia ;
- maintien pendant toute la compétition, puis retrait le lendemain de la date de fin, à minuit ;
- fermeture si un report replace le tournoi avant sa fenêtre d'ouverture ;
- aucun panneau tant que les dates exactes de début et de fin ne sont pas connues ;
- si les participants ne sont pas encore annoncés, affichage d'un message d'attente, remplacé ensuite par le menu d'équipes.

Les menus internationaux proposent les participants au tournoi principal, avec le Play-In et le Main Event pour les Worlds. Les équipes des qualifications régionales et des showmatches ne sont pas ajoutées à ces menus.

Les dates et participants sont actualisés toutes les heures. La fenêtre d'affichage est vérifiée chaque minute et au démarrage à partir des données conservées dans PostgreSQL. Les identifiants des panneaux sont mémorisés pour les retrouver après redémarrage. Les anciens menus et les équipes absentes du tournoi ne permettent pas de modifier les rôles.

## Prérequis

- Node.js 22 ou plus récent ;
- pnpm ;
- un webhook créé dans les paramètres du salon Discord ;
- une application Discord avec un bot ;
- PostgreSQL, directement ou avec Docker Compose.

## Configuration

Le fichier `.env` doit contenir :

```dotenv
LCK_MATCH_CALENDAR_WEBHOOK_URL=https://discord.com/api/webhooks/identifiant/token
LEC_MATCH_CALENDAR_WEBHOOK_URL=https://discord.com/api/webhooks/identifiant_lec/token_lec
DISCORD_TOKEN=token_application_discord
DISCORD_CLIENT_ID=identifiant_application_discord
DISCORD_GUILD_ID=identifiant_serveur_de_test
DATABASE_URL=postgresql://lck_bot:mot_de_passe_encode_pour_url@postgres:5432/lck_bot
POSTGRES_PASSWORD=mot_de_passe_brut
```

Le token, l'URL du webhook et les identifiants PostgreSQL sont secrets : ne publie jamais le fichier `.env`. `POSTGRES_PASSWORD` contient le mot de passe brut. Encode uniquement sa copie placée dans `DATABASE_URL` si elle contient des caractères réservés dans une URL. Avec PostgreSQL lancé hors de Compose, remplace l'hôte `postgres` par `localhost`.

`DISCORD_GUILD_ID` est facultatif. Lorsqu'il est présent, les commandes sont enregistrées uniquement dans ce serveur de test et apparaissent immédiatement. Sans cette variable, elles sont globales.

`LEC_MATCH_CALENDAR_WEBHOOK_URL` active la publication automatique LEC lorsqu'elle est renseignée. Sans cette variable, le bot continue de publier la LCK seule. `pnpm send:lec` exige le webhook LEC mais n'a pas besoin du webhook LCK.

## Créer et inviter l'application Discord

Dans le [Discord Developer Portal](https://discord.com/developers/applications) :

1. crée une application et ajoute un bot ;
2. copie son token et l'identifiant de l'application dans `.env` ;
3. génère une invitation avec les scopes `bot` et `applications.commands` ;
4. accorde `Voir les salons`, `Envoyer des messages`, `Intégrer des liens`, `Voir les anciens messages`, `Gérer les rôles` et `Mentionner @everyone, @here et tous les rôles` ;
5. place le rôle du bot au-dessus des rôles d'abonnement (`LCK · équipe`, `LEC · équipe`, `Worlds 2026 · équipe`, etc.).

Les rôles d'équipe créés par le bot ne sont pas mentionnables par les membres. Les messages du bot limitent explicitement les mentions aux deux rôles du match.

## Enregistrer les commandes

En local :

```bash
pnpm register:commands
```

Puis, dans Discord, un membre ayant la permission `Gérer le serveur` configure les deux salons :

```text
/config notifications salon:#notifications-lck
/config abonnements salon:#abonnements-lck
```

Le second salon contient les panneaux permanents LCK et LEC, ainsi que les panneaux internationaux pendant leur fenêtre d'ouverture. Choisir une équipe ajoute son rôle pour la compétition indiquée ; choisir la même équipe de nouveau le retire.
Le catalogue des dix équipes LCK est synchronisé quotidiennement depuis `TournamentRosters` et `Teams` sur Leaguepedia, puis conservé dans PostgreSQL. Pour les équipes LCK et LEC répertoriées dans `src/team-logos.ts`, les logos utilisent les fichiers officiels de Riot publiés sur LoL Esports, car les images Fandom peuvent refuser les téléchargements automatisés (HTTP 403). Les autres équipes conservent leur URL Leaguepedia. Le bot convertit les logos en emojis d'application Discord et actualise automatiquement les panneaux d'abonnement existants.

Les commandes publiques supplémentaires sont également enregistrées :

- `/ping` — vérifie la latence du bot ;
- `/add_drooler` et `/drooler` — ajoutent et consultent le compteur Drooler ;
- `/add_hans` et `/hans_maga` — ajoutent et consultent le compteur Hans Sama.

Les compteurs acceptent une année, un split et, lorsque nécessaire, une équipe. `/add_drooler` et `/drooler` proposent les dix équipes LCK ainsi que les anciennes valeurs déjà enregistrées dans PostgreSQL.

## Pronostics et classement

Tous les membres peuvent participer, sans rôle ni configuration de salon supplémentaire :

```text
/classement
/classement page:2
```

Les votes se font uniquement dans le salon **`1546489098968105031`**. Le bot y publie **un embed avec des boutons de vote par match**, 3 jours (72 heures) avant le début prévu du match. Les votes ferment 1 minute avant ce début. La publication est vérifiée chaque minute et au démarrage : si le bot était arrêté, les matchs déjà dans cette fenêtre sont rattrapés. Les rappels et résultats restent dans leur salon de notifications. Clique sur le nom du vainqueur et son score : `T1 3–1` signifie une victoire de T1, `Gen.G 3–1` une victoire de Gen.G. Le BO1 propose deux boutons, le BO3 quatre et le BO5 six, répartis par équipe.

Aucune commande ne permet de saisir ou de gérer un pronostic : utilise directement les boutons de l'embed. Seule `/classement` reste disponible pour consulter les points. Les rencontres doivent avoir deux équipes connues et être en BO1, BO3 ou BO5.

Tous les boutons de pronostic sont gris et affichent le logo, l’acronyme de leur équipe et le score (par exemple `HLE 3–1`). Les équipes non répertoriées utilisent une abréviation générée à partir de leur nom. Les embeds présentent les deux logos et reprennent la couleur de la première équipe ; les confirmations privées reprennent celle du vainqueur choisi. Les logos proviennent des catalogues LCK et des autres compétitions et sont réutilisés comme emojis d'application, avec un cache de 24 heures. Si un logo est indisponible, les votes restent accessibles avec des boutons neutres et un accent lavande en LEC, vert d'eau en LCK ou doré ailleurs. Les refus utilisent un embed ambre.

Un membre possède **un pronostic par match et par serveur**. Cliquer sur un autre bouton remplace son choix jusqu’à 1 minute avant l'heure de début prévue, avec une confirmation privée. Les matchs à plus de 3 jours, à 1 minute ou moins du début, commencés, annulés ou avec un résultat refusent les votes, même si leurs anciens boutons restent visibles. Si les équipes ou le format changent, les anciens boutons sont refusés et l'embed encore ouvert est actualisé lors de la vérification suivante, chaque minute. Les votes continuent de fonctionner après redémarrage du bot. Les anciens boutons situés hors du salon dédié renvoient vers celui-ci.

| Résultat du pronostic | Points |
| --- | --- |
| Mauvais vainqueur | 0 |
| Bon vainqueur | 3 |
| Bon vainqueur et score exact en BO3/BO5 | 5 (3 + 2 de bonus) |
| Bon vainqueur en BO1 | 3, sans bonus |

`/classement` affiche le classement cumulé du serveur, toutes compétitions et saisons confondues, par pages de 10 membres. Les égalités de points partagent le même rang. Il indique les bons vainqueurs, les bonus de score exact et les matchs comptabilisés. Les pronostics en attente valent provisoirement zéro point. Les commandes répondent uniquement au membre qui les utilise.

Un **bilan hebdomadaire du classement cumulé** est publié chaque **lundi à 08:00, heure de Paris**, dans le salon **`1546534221835931759`**. Il présente les 10 premiers membres, sans notification de mention, et renvoie vers `/classement` pour les autres places. **Les points ne sont jamais remis à zéro chaque semaine.** Chaque bilan conserve les résultats disponibles au moment de sa préparation ; les publications précédentes restent consultables et `/classement` affiche les points actualisés.

L'envoi du bilan est vérifié au démarrage puis chaque minute : un arrêt à l'heure prévue est rattrapé pour la semaine courante. Le contenu et l'identifiant du message sont conservés en PostgreSQL pour éviter les doublons après redémarrage et reprendre un envoi échoué avec le même bilan. Le bot doit pouvoir voir le salon, envoyer des messages et intégrer des liens. La migration `011_weekly_prediction_leaderboards.sql` est appliquée automatiquement au démarrage ; redémarre le bot après mise à jour pour activer cette publication.

Le classement est calculé à partir des résultats complets conservés dans PostgreSQL. Il suit leur synchronisation sans double attribution : une correction synchronisée modifie les points, une annulation les retire. Si les équipes ou le format du match ne correspondent plus au pronostic enregistré, ce dernier ne rapporte aucun point ; il peut être remplacé tant que les pronostics restent ouverts.

Les résultats récents sont actualisés toutes les cinq minutes. Après un arrêt de plus de 24 heures, les journées des anciens matchs pronostiqués encore sans résultat sont récupérées au démarrage et lors de la synchronisation toutes les 15 minutes. Les points dépendent de la disponibilité des résultats sur Leaguepedia ; le verrouillage utilise l'horaire prévu connu du bot.

Pour activer cette fonctionnalité après mise à jour, exécute **`pnpm register:commands`**, puis redémarre le bot. Les migrations `009_predictions.sql` et `010_prediction_deliveries.sql` sont appliquées automatiquement au démarrage. Les pronostics et les envois confirmés sont conservés en base : le bot ne republie pas un embed déjà envoyé après redémarrage. Réenregistrer les commandes retire aussi l’ancienne commande `/prono` de Discord. Avec Docker Compose, reconstruis l'image, lance `docker compose run --rm app node dist/bot/register-commands.js`, puis `docker compose up -d`.

## Tester un envoi

```bash
pnpm install
pnpm send
```

La commande récupère le programme LCK de la semaine sur Leaguepedia puis le publie immédiatement dans le salon associé au webhook LCK. Pour envoyer le programme LEC via `LEC_MATCH_CALENDAR_WEBHOOK_URL`, utilise `pnpm send:lec`.

Pour contrôler visuellement le rappel et le résultat dans un salon Discord privé, renseigne temporairement `DISCORD_TEST_CHANNEL_ID`, puis exécute uniquement après avoir vérifié la cible :

```bash
ALLOW_DISCORD_TEST_SEND=yes pnpm verify:discord
```

Le script refuse tout envoi sans `ALLOW_DISCORD_TEST_SEND=yes` et ne lit jamais le salon de notifications enregistré en base.

## Lancer la publication hebdomadaire

```bash
pnpm start
```

Le processus doit rester actif. Chaque calendrier configuré sera publié via son webhook chaque lundi à 08:00 selon le fuseau `Europe/Paris`, y compris après les changements d'heure. Les tâches LCK et LEC sont indépendantes : une erreur d'envoi sur l'un n'empêche pas l'autre. Le bot gère aussi les rappels, les résultats et la synchronisation quotidienne des logos.

Le planning de la semaine courante est vérifié au démarrage puis chaque minute. Si le bot était arrêté ou l'ordinateur en veille à 08:00, il rattrape l'envoi après reprise. PostgreSQL conserve l'envoi par serveur, compétition et semaine pour éviter une nouvelle publication aux vérifications suivantes ou après redémarrage. Le contenu des pages est enregistré avant l'envoi et chaque page confirmée est mémorisée : après une interruption, le bot reprend les pages restantes du même calendrier. Un échec est retenté à la minute suivante.

Les migrations sont appliquées automatiquement au démarrage. Renseigne les webhooks et redémarre le bot pour activer leurs destinations ; aucune réinscription des commandes n'est nécessaire. La migration `012_weekly_calendar_competitions.sql` conserve les anciens envois et pages sous la compétition LCK et permet un envoi LEC distinct dès la semaine courante. Le serveur est identifié à partir du webhook, sans configuration préalable d'un salon de calendrier. Les rappels et résultats utilisent toujours `notification_channel_id`. Une semaine LCK déjà publiée reste considérée comme envoyée et ses pages déjà préparées sont conservées pour les reprises. `pnpm preview` permet de consulter immédiatement le calendrier LCK sans publication.

Docker Desktop ne maintient pas le bot actif pendant la veille du Mac. Pour une publication à l'heure prévue et des rappels ponctuels, exécute le service sur un VPS ou une machine qui reste allumée.

## Déployer sur un VPS avec Docker Compose

Après avoir copié le projet et créé `.env` :

```bash
docker compose build
docker compose run --rm app node dist/bot/register-commands.js
docker compose up -d
docker compose logs -f app
```

PostgreSQL n'expose aucun port public. Ses données sont conservées dans le volume `postgres_data`. L'application attend que la base soit saine et applique automatiquement les migrations.

Créer une sauvegarde :

```bash
docker compose exec postgres pg_dump -U lck_bot lck_bot > lck_bot_backup.sql
```

Mettre à jour le service :

```bash
docker compose build --pull
docker compose up -d
```

Avant une montée majeure de PostgreSQL, réalise un `pg_dump` et suis la procédure officielle de migration ; changer seulement le numéro de l'image ne convertit pas les fichiers de données.

## Vérifications techniques

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm preview
```

`pnpm preview` affiche le tableau JSON des pages du calendrier sans envoyer de message Discord. L'intégration passe par le rendu Cargo de l'API Leaguepedia afin d'éviter le quota très restrictif de l'action `cargoquery` directe.

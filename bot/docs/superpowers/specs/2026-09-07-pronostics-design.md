# Pronostics Discord

Les votes se font exclusivement par boutons dans le salon `1546489098968105031`. `/classement page:<numéro>` permet de consulter les points. Les rencontres proviennent du catalogue existant, pour toutes les compétitions. Un identifiant numérique stable évite les limites de longueur de Discord.

Le vote s'effectue via les boutons d'un embed par match, publié dans le salon dédié 30 minutes avant le début. Les rappels et résultats gardent leur destination existante. Deux rangées de boutons proposent les scores gagnants pour chaque équipe : 2 boutons en BO1, 4 en BO3, 6 en BO5. Le clic confirme en privé et un nouveau vote remplace le précédent. Les identifiants des boutons incluent une empreinte des noms d'équipes et du format ; l'enregistrement refuse sous verrou un bouton obsolète. Aucun collecteur temporaire n'est nécessaire : les interactions fonctionnent après redémarrage.

Chaque utilisateur a un pronostic par serveur et par match, remplaçable avant l'horaire prévu. La validation et l'enregistrement se font dans une transaction verrouillant le match, avec l'horloge PostgreSQL. Les scores doivent terminer le BO : 1 victoire en BO1, 2 en BO3, 3 en BO5. Les rencontres annulées, commencées, avec résultat ou avec équipes inconnues sont refusées.

Barème retenu par défaut : bon vainqueur = 3 points ; score exact en BO3/BO5 = 2 points supplémentaires ; erreur = 0. Aucun bonus en BO1. Le classement cumule tous les pronostics du serveur, avec 10 membres par page et rang partagé à égalité de points. Les pronostics sans résultat valent provisoirement 0 point.

Le classement est calculé à la lecture à partir des résultats stockés : aucune double attribution et les corrections synchronisées sont prises en compte. Les snapshots des équipes et du format invalident un pronostic si la rencontre change. Une annulation retire ses points. Les réponses sont privées pour éviter d'exposer les choix et de déclencher des mentions.

Le salon `1546534221835931759` reçoit chaque lundi à 08:00 (Europe/Paris) un bilan public du top 10 cumulé, sans mention notifiée. Les points restent cumulés d'une semaine à l'autre, conformément au choix de l'utilisateur. `/classement` conserve la consultation privée de toutes les places. Chaque bilan est un instantané des résultats disponibles à sa préparation, conservé avec son identifiant Discord en base. Vérification au démarrage et chaque minute, rattrapage de la semaine courante après arrêt, verrou par serveur/semaine et nonce stable pour les reprises. La migration `011_weekly_prediction_leaderboards.sql` conserve ces envois indépendamment du calendrier.

La migration est appliquée au démarrage ; les commandes doivent être réenregistrées pour supprimer l’ancien `/prono`. Aucun envoi Discord ni déploiement n'est nécessaire pour vérifier le code.

Les anciens matchs pronostiqués sans résultat et non annulés sont resynchronisés par journée UTC au démarrage et toutes les 15 minutes, pour rattraper les arrêts de plus de 24 heures.

Les envois des embeds sont mémorisés avec le type `prediction` dans `notification_deliveries`, indépendamment des rappels et résultats. Le serveur du salon cible est résolu via Discord ; aucune autre destination ne reçoit les embeds de vote. La tâche est exécutée au démarrage et chaque minute.

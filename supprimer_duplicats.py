import os
from send2trash import send2trash

def envoyer_vers_corbeille_avec_1(dossier):
    # Liste tous les fichiers dans le dossier
    fichiers = os.listdir(dossier)

    # Parcourir chaque fichier
    for fichier in fichiers:
        # Vérifier si "(1)" est dans le nom du fichier
        if "(1)" in fichier:
            chemin_fichier = os.path.join(dossier, fichier)
            try:
                send2trash(chemin_fichier)
                print(f"Envoyé vers la corbeille : {fichier}")
            except Exception as e:
                print(f"Erreur lors de l'envoi de {fichier} vers la corbeille : {e}")

# Exemple d'utilisation
dossier = r"C:\Users\Charles\Pictures"
envoyer_vers_corbeille_avec_1(dossier)
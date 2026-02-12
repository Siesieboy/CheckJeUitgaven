# CheckJeUitgaven

Mooie budget-webapp met Firebase Firestore koppeling en inloggen.

## Functionaliteit
- Inloggen/registreren met e-mail + wachtwoord
- Inkomsten/uitgaven toevoegen
- Bewerken en verwijderen
- Live sync met Firestore
- Data per gebruiker (ieder account heeft eigen transacties)
- Totalen (inkomsten, uitgaven, saldo)
- Grafiek per uitgaven-categorie
- Maandvergelijking (laatste 6 maanden)
- Filter op type transacties

## Firebase instellen
1. Maak een Firebase project.
2. Zet **Authentication** aan en activeer provider **Email/Password**.
3. Zet **Cloud Firestore** aan.
4. Vul je web-config in `firebase-config.js` in.
5. Gebruik Firestore regels per gebruiker, bijvoorbeeld:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/transactions/{transactionId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Starten
Omdat dit ES modules gebruikt, draai lokaal met een simpele server:

```bash
npx serve .
```

of

```bash
python3 -m http.server 4173
```

Open daarna de getoonde localhost URL.

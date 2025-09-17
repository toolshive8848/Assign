// firebase.js (backend)
const admin = require("firebase-admin");

const serviceAccount = require("./firebase-admin-key.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
  });
}

const db = admin.firestore();

module.exports = { admin, db };

// ClassPulse configuration. SETUP.md explains where each value comes from.
// These values identify your Firebase project; they are not secrets.
// Access is protected by the Realtime Database rules in database.rules.json.
window.CLASSPULSE_CONFIG = {
  firebase: {
    apiKey: "PASTE_API_KEY",
    authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
    databaseURL: "PASTE_DATABASE_URL",
    projectId: "PASTE_PROJECT_ID",
    appId: "PASTE_APP_ID"
  },
  // Google Cloud project number (Firebase console > Project settings > General).
  meetCloudProjectNumber: "PASTE_PROJECT_NUMBER",
  // Gemini models. The API key itself is entered in the app (AI settings), never here.
  gemini: { model: "gemini-3.8-flash", quickModel: "gemini-3.5-flash-lite" }
};

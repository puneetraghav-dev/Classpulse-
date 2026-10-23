# ClassPulse for Google Meet: setup guide

At the end of this guide, ClassPulse opens inside a Google Meet call:

- **Side panel.** The teacher runs the full dashboard next to the call: live gauge, doubts, AI themes, quick checks and the report.
- **Main stage.** **Show on main stage** puts the join code, the live pulse and quiz results on everyone's screen.
- **Joining.** Students who open the activity join the class automatically. Students on phones can use the website link and the join code instead.

**Time:** about an hour the first time. **You need:** a Google account and a GitHub account (both free).

This build uses the same app as the Claude version. Only the platform underneath changes:

| Job | Claude version | Meet add-on version |
|---|---|---|
| Database and live sync | Claude artifact `db` + `room` | Firebase Realtime Database |
| Sign-in | Claude account | Firebase anonymous sign-in (no names) |
| AI | Claude, on the teacher's account | Google Gemini, on the teacher's own API key |
| Hosting | claude.ai | GitHub Pages |
| Inside Meet | Companion features (link, pop-out, presenter view) | Real Meet add-on: side panel and main stage |

---

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | ClassPulse as a normal website (works in any browser tab or phone) |
| `sidepanel.html` | ClassPulse inside Meet's side panel |
| `mainstage.html` | The read-only screen Meet shows on the main stage |
| `runtime-firebase.js` | Connects the app to Firebase, Gemini and the Meet add-ons SDK |
| `config.js` | **You fill this in** (step 4) |
| `database.rules.json` | Security rules you paste into Firebase (step 3) |
| `addon-manifest.json` | The add-on registration you paste into Google Cloud (step 7) |
| `logo.png`, `logo-dark.png` | Add-on icons |
| `build_meet.py` | Rebuilds the three HTML files from the shared app source |
| `test/` | Automated test with stand-ins for Firebase, Meet and Gemini (not uploaded) |

---

## Step 1: Create a Firebase project

This is also your Google Cloud project, so the same project is used for the Meet add-on later.

1. Go to <https://console.firebase.google.com> and click **Create a project**. Name it `classpulse`. You can turn Google Analytics off.
2. On the project overview, click the **Web** icon (`</>`). Register an app called `ClassPulse`. You don't need Firebase Hosting.
3. Firebase shows a `firebaseConfig` block. Keep this tab open: you need `apiKey`, `authDomain`, `projectId` and `appId` in step 4.

## Step 2: Turn on anonymous sign-in

**Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**

ClassPulse never asks anyone for a name. Each browser gets an anonymous id, which the security rules use.

## Step 3: Create the Realtime Database and paste the rules

1. Go to **Build → Realtime Database → Create database**.
2. Choose a location. **Singapore (asia-southeast1)** is closest to India.
3. Choose **Start in locked mode**.
4. Copy the database URL shown at the top. It looks like `https://classpulse-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app`.
5. Open the **Rules** tab, replace everything with the contents of `database.rules.json`, and click **Publish**.

What the rules enforce:

- Only signed-in browsers can read.
- Only the teacher who created a class can change it.
- Each person can write only their own live presence.
- Quiz answer keys are private to the teacher.

## Step 4: Fill in `config.js`

Open `config.js` in any text editor and replace the `PASTE_...` values:

- `apiKey`, `authDomain`, `projectId`, `appId`: from step 1.
- `databaseURL`: from step 3.
- `meetCloudProjectNumber`: go to **Project settings** (the gear icon) **→ General** and copy the **Project number**. This is a number, not the project ID.

These values only identify your project, so they're safe on a public website. The database rules are what protect the data.

## Step 5: Get a Gemini API key (for the AI features)

1. Go to <https://aistudio.google.com/apikey> and click **Create API key**. Pick your `classpulse` project if asked.
2. Copy the key. **Don't put it in any file.** You paste it into ClassPulse's **AI settings** later. It's stored only in that browser and sent only to Google's Gemini API.

The free tier has rate limits, which a single class stays well within.

## Step 6: Put the site on GitHub Pages

1. On <https://github.com>, click **New repository**. Name it `classpulse-meet`, make it **Public**, and click **Create repository**.
2. Click **uploading an existing file**. Drag in every file from this folder except the `test` folder, then click **Commit changes**.
3. Go to **Settings → Pages**. Set **Source** to *Deploy from a branch* and **Branch** to *main* / *(root)*, then click **Save**.
4. After about a minute, your site is live at `https://YOUR_GITHUB_USERNAME.github.io/classpulse-meet/`.
5. Open that link and start a test class. If you see "ClassPulse can't reach its database", recheck steps 2–4.
6. In Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and add `YOUR_GITHUB_USERNAME.github.io`.

## Step 7: Register the Meet add-on in Google Cloud

1. Open <https://console.cloud.google.com> and select the same project (`classpulse`).
2. In the top search bar, find **Google Workspace Marketplace SDK** and click **Enable**. Use the *SDK*, not the "Marketplace API".
3. Search for **Google Workspace add-ons API** and click **Enable**.
4. If the console asks you to set up the **OAuth consent screen** first, do it:
   - App name: ClassPulse
   - Your email as the support and developer contact
   - User type: External
   - Add yourself (and any teammates) as **test users**
5. Go to **APIs & Services → Google Workspace Marketplace SDK → HTTP deployments → Create new deployment**:
   - Deployment ID: `classpulse`
   - Click **Next**.
   - Paste the contents of `addon-manifest.json`, with `YOUR_GITHUB_USERNAME` replaced in all five places. Write the username in lowercase, as it appears in your GitHub Pages address.
   - Click **Submit**.
6. Open the **App configuration** tab:
   - Under **App integration**, choose **Google Workspace add-on**.
   - Choose **Deploy using cloud deployment resource** and select `classpulse`.
   - Fill in any other required fields (app name, developer details) and click **Save**.
7. Back on **HTTP deployments**, click **Install** in the Actions column and approve.

## Step 8: Use it in a Meet call

1. Start a meeting at <https://meet.google.com>.
2. Open the **Activities** panel (meeting tools) and choose **ClassPulse** under your add-ons. It opens in the side panel.
3. Click **AI settings**, paste your Gemini key and click **Save**. You only do this once per browser.
4. Start a class, then click **Show on main stage**.
5. Meet prompts everyone else in the call to open ClassPulse, or to install it (see the limits below):
   - The main stage shows the join code, the live pulse and quiz results. Anyone can switch between these tabs on their own screen.
   - Participants who open ClassPulse in their side panel join the class automatically.
6. Students on phones can open `https://YOUR_GITHUB_USERNAME.github.io/classpulse-meet/`, tap **Join a class** and enter the code.

---

## Limits to know before your demo

- **Who can open it inside Meet.** While the add-on is unpublished, only accounts that clicked **Install** on the HTTP deployments page can open it. Meet asks other participants to install it, but that install prompt only works once the add-on is published on the Google Workspace Marketplace, which goes through Google's review. Until then, students join through the website link on a phone or laptop, which is also the simplest setup for a viva demo. A teammate who needs it inside Meet has to install it the same way, which needs access to your Cloud project.
- **Separate storage inside Meet.** Inside Meet, the add-on has its own storage, separate from normal browser tabs. Enter the Gemini key once inside Meet. **Your classes** shows the classes started in that same place.
- **Desktop only.** Meet add-ons run in Meet on a computer browser, not in the Meet mobile apps. That's why phone users use the website link.
- **Free-tier limits.** Firebase's free plan allows 100 simultaneous database connections, which is enough for a class. Gemini's free tier limits requests per minute.
- **Not tested in a live Meet call.** I tested this build with stand-ins for Firebase, the Meet SDK and Gemini (`test/run-meet.js`). That test covers the side panel, main stage, auto-join, AI and the report. Do one rehearsal in a real call before your viva.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "ClassPulse can't reach its database" | Check every value in `config.js`, especially `databaseURL`. Make sure anonymous sign-in is enabled and the rules are published. |
| "Permission denied" in the browser console | Re-paste `database.rules.json` into the Rules tab and click **Publish**. |
| ClassPulse doesn't appear in Meet | Click **Install** on the HTTP deployment. Check that `sidePanelUrl` and `addOnOrigins` match your GitHub Pages address exactly, then reload Meet. |
| Side panel is blank | Open `sidepanel.html` from your GitHub Pages address in a normal tab and check the browser console for errors. |
| AI buttons say to add a key | Open **AI settings** inside Meet and paste the Gemini key. |
| "The model … isn't available" | Google retires models over time. Enter a current model name in **AI settings**. |

## Rebuilding after changing the app

The three HTML files are generated from the shared app source, `classpulse-artifact.html` in the `claude-version` folder. After changing that file, run these from this folder:

```
python3 build_meet.py        # rebuilds index.html, sidepanel.html and mainstage.html
node test/run-meet.js        # end-to-end test with stand-ins for Firebase, Meet and Gemini
```

The test needs Node 18 or later and Playwright: `npm install playwright`, then `npx playwright install chromium`.

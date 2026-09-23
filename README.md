# Datchworth Ranger Inspections

A phone-friendly web app for the Datchworth Parish community ranger to record inspections of the parish's green spaces. It replaces the "Inspection Reports" Google Sheet.

- **Login**: the app opens with a password screen. The ranger's password is **`dpc`**. The ranger stays logged in on their phone, so they don't need to type it in the field.
- **Inspect**: choose the area, date and ranger's name, then mark each check as OK, Monitor, Action or N/A, with an optional detail for each. Only the checks you mark are saved.
- **Works with no signal**: if the phone is offline, the inspection is kept on the device and uploads by itself when the phone is back online.
- **History**: every inspection, newest first, which you can filter by area or narrow to only those with issues. Tap one to correct it.
- **Year sheet**: the same layout as the spreadsheet (checks × Jan–Dec) for any area and year, with a **Download CSV** button.
- **Clerk tools** (Clerk password): add or remove areas and checks, delete inspections, change the ranger's login password and change the Clerk password.

Built with Vite + React (front end), an Azure Functions API, and Azure Blob Storage, hosted on Azure Static Web Apps from GitHub. This is the same setup as the bowls and golf society apps.

---

## What's in the folder

```
datchworth-ranger-inspections/
├── index.html, src/            ← the app people see
├── public/                      ← logo, phone icons, staticwebapp.config.json
├── api/                        ← the Azure Functions API (saves the data)
│   ├── src/functions/          ← data, inspections, setup, manage endpoints
│   └── src/store.js            ← reads/writes Blob Storage
├── package.json, vite.config.js
└── README.md
```

Data is kept in **one file**, `data.json`, in a Blob Storage container called **`datchworth-ranger-data`**. The API creates the container on first use. It can share your existing storage account (e.g. `datchworthbowlsdata`) because its container is separate from the other apps.

---

## Step 1: Put the code on GitHub

1. Go to **github.com**, sign in, click **+ → New repository**.
2. Name it `datchworth-ranger-inspections`, choose **Private** (or Public), and click **Create repository**. Don't add a README.
3. On the new repository page, click **uploading an existing file**.
4. Unzip this project on your computer, open the `datchworth-ranger-inspections` folder, select **everything inside it** (including the `api`, `public` and `src` folders) and drag it onto the GitHub page.
   - Hidden files like `.gitignore` may not show. That's fine.
5. Click **Commit changes**.

## Step 2: Create the Static Web App in Azure

1. Go to **portal.azure.com** → **Create a resource** → search **Static Web App** → **Create**.
2. Fill in:
   - **Subscription / Resource group**: use your existing ones (or create one, e.g. `datchworth-parish`).
   - **Name**: `datchworth-ranger-inspections`
   - **Plan type**: **Free**
   - **Source**: **GitHub**. Sign in if asked, then pick your organisation, the `datchworth-ranger-inspections` repository and branch `main`.
3. Under **Build Details**:
   - **Build Presets**: **Custom**
   - **App location**: `/`
   - **Api location**: `api`
   - **Output location**: `dist`
4. Click **Review + create** → **Create**.

Azure adds a workflow file to your GitHub repository and starts the first build. It takes about 3–5 minutes. You can watch it under the **Actions** tab on GitHub.

## Step 3: Connect the storage (important)

The API needs to know which storage account to save into.

1. In the Azure portal, open your **storage account** (e.g. `datchworthbowlsdata`) → **Security + networking → Access keys** → click **Show** next to **Connection string** under key1 → **Copy**.
2. Open the new **Static Web App** → **Settings → Environment variables** (called **Configuration** in some versions).
3. Make sure the **Production** environment is selected, then click **+ Add**:
   - **Name**: `STORAGE_CONNECTION_STRING` (exactly this, capitals and underscores)
   - **Value**: paste the connection string
4. Click **Apply** → **Apply** again to confirm.

## Step 4: Check it's working

1. On the Static Web App's **Overview** page, click the **URL** (it looks like `https://something.azurestaticapps.net`).
2. Add `/api/health` to the end of the address, e.g. `https://something.azurestaticapps.net/api/health`.
   - ✅ You should see: `{"ok":true,"storage":"connected","inspections":0}` (this check needs no login)
   - ❌ `STORAGE_CONNECTION_STRING is not set…` → Step 3 wasn't applied to **Production**, or the name is misspelt.
   - ❌ `Storage error: …` → the connection string was copied incorrectly. Copy it again.
   - ❌ A 404 page → the API didn't deploy. Check **Api location** is `api` (Step 2) and look at the latest run in GitHub **Actions** for errors.
3. Open the main address, log in with **`dpc`**, complete a test inspection and save it. It should say **"Inspection saved"**, and the count at the top should go up.

If saving ever fails, the app now shows the **actual reason** from the server (not just "check your connection"), and the inspection is kept on the device, so nothing is lost.

## Step 5: Passwords

There are two passwords:

| Who | Starting password | What it's for |
|---|---|---|
| Ranger | **`dpc`** | Logging in to the app: recording, viewing and editing inspections |
| Clerk | **`ranger`** | Logging in (it works on the login screen too), plus **Clerk tools**: areas and checks, deleting inspections, changing passwords |

**Change the Clerk password straight away**, because `ranger` is only a starting password:
1. Log in, then open **Clerk tools** at the bottom of the Inspect tab.
2. Enter `ranger` → **Unlock**.
3. Under **Change Clerk password**, type a new one → **Change**.

To change the ranger's password, use **Change ranger login password** in the same place. Any phone still using the old password is asked to log in again. Inspections it saved while offline are kept and upload once the ranger logs in with the new password.

Both passwords are stored salted and hashed in Blob Storage, not in the code. The API refuses to show or save inspections without a valid password, so the web address alone isn't enough to get in.

## Step 6: Put it on the ranger's phone

Send the ranger the web address. On the phone:
- **iPhone (Safari)**: tap **Share → Add to Home Screen**.
- **Android (Chrome)**: tap **⋮ → Add to Home screen**.

It then opens like an app. The ranger's name is remembered on that phone.

---

## Making changes later

Edit files on GitHub (or upload replacements) and commit. Azure rebuilds and redeploys automatically within a few minutes.

## Running it on your own computer (optional)

You only need this if you want to try changes before uploading. Requires Node.js 20+ and the Azure Functions Core Tools.

```bash
npm install
cd api && npm install && cp local.settings.sample.json local.settings.json && cd ..
# terminal 1 – API (needs STORAGE_CONNECTION_STRING in api/local.settings.json,
#   or run the Azurite storage emulator for UseDevelopmentStorage=true)
cd api && func start
# terminal 2 – website
npm run dev
```

## Technical notes

- API routes: `GET /api/data`*, `GET /api/health`, `POST /api/inspections`*, `DELETE /api/inspections/{id}`†, `PUT /api/setup`†, `POST /api/manage/login`†, `POST /api/manage/password`†, `POST /api/manage/ranger-password`†. (* needs the `x-ranger-password` header, † needs `x-admin-password`.)
- Routes deliberately avoid starting with `admin`, because Azure Functions reserves that word and silently refuses to register such routes.
- Writes use Blob ETags, so two saves at the same moment can't overwrite each other.
- Both passwords are stored salted and hashed in `data.json`, never in plain text. The ranger's password is remembered in the phone's browser storage so the app works offline. Tap **Log out** (top right) on a shared device.
- The API runs on Node 20 (`platform.apiRuntime` in `public/staticwebapp.config.json`).

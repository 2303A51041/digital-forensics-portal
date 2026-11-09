# Digital Forensics Case and Evidence Management Portal

A web application for managing forensic cases, evidence, chain of custody, investigation findings and reports.

This guide assumes you are starting on a new computer with nothing installed.

## Quick start

If you are comfortable with a terminal, this is all you need:

```
npm install
npm start
```

Then open http://localhost:3000 and sign in as `admin` with the password `Forensics@123`.

Otherwise, follow the steps below.

---

## Step 1: Install the required software

| Software | Needed? | Notes |
| --- | --- | --- |
| **Node.js 22.13 or newer** | **Yes** | The only thing you must install. Includes `npm`. |
| A web browser | Yes | Chrome, Edge or Firefox. |
| SQLite | No | Already built into Node.js. |
| PostgreSQL or MySQL | No | Not used. |
| Python | No | Not used. |
| Git | No | Only if you download the project with `git clone`. |

To install Node.js, download the **LTS** version from https://nodejs.org and run the installer with its default options. The Windows setup file in Step 3 can also install it for you.

## Step 2: Put the project on the computer

**From a ZIP file**

1. Right-click the ZIP file and choose **Extract All** (on macOS, double-click it).
2. Extract it somewhere simple, such as `C:\Projects\akki_devops`.
3. Open the extracted folder and check that you can see `package.json` and `setup.bat` directly inside it. If you see only one folder, open that folder.

**From Git**

```
git clone <repository-url>
cd <project-folder>
```

If you are copying the project to someone else, leave out the `node_modules` and `data` folders. Setup recreates them, and `data` may contain your local records.

## Step 3: Install the project

Choose the method for your computer. Each one checks Node.js, installs the project's packages and creates the settings file.

**Windows:** double-click `setup.bat`.

If it tells you Node.js was just installed, close the window and double-click `setup.bat` again.

**macOS or Linux:** open a terminal in the project folder and run:

```
bash setup.sh
```

**Or do it by hand on any system.** Open a terminal in the project folder and run:

```
node -v
npm install
```

`node -v` should print `v22.13.0` or higher.

> **How to open a terminal in the project folder on Windows:** open the folder in File Explorer, click the address bar, type `cmd` and press Enter.

## Step 4: Settings and database

**You do not need to configure anything to run the project.**

- **Environment variables** are optional. The setup files copy `.env.example` to `.env`, and the defaults work as they are. If you skipped the setup files, the app uses the same defaults without a `.env` file.
- **The database** is created automatically the first time the app starts, at `data/forensics.db`, along with the demo data. There are no database commands to run.
- **The login token secret** is generated automatically and saved in the `data` folder.

Available settings in `.env`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | The port the website runs on. |
| `DATA_DIR` | `./data` | Where the database and uploaded evidence are stored. |
| `JWT_EXPIRES_IN` | `8h` | How long a sign-in lasts. |
| `MAX_UPLOAD_MB` | `500` | Largest file that can be uploaded. |
| `SEED_DEMO` | `true` | Create the demo users and cases on first start. |

Restart the app after changing `.env`.

## Step 5: Start the application

In a terminal in the project folder, run:

```
npm start
```

You should see:

```
Forensics portal running at http://localhost:3000
```

**This one command runs both the backend and the frontend.** The Express server also serves the web pages, so there is no separate frontend server and no build step.

Keep the terminal open while you use the site. To stop the app, click the terminal and press `Ctrl + C`.

For development, `npm run dev` restarts the server automatically when you change backend code.

## Step 6: Open the site and sign in

Go to **http://localhost:3000** in your browser.

All demo accounts use the password **`Forensics@123`**.

| Role | Username | Demo name |
| --- | --- | --- |
| Admin | `admin` | Priya Raman |
| Case Manager | `manager` | Daniel Osei |
| Forensic Investigator | `investigator1` | Ananya Iyer |
| Forensic Investigator | `investigator2` | Marcus Lindholm |
| Forensic Investigator | `investigator3` | Sofia Mendes |
| Auditor | `auditor` | Grace Whitfield |

These passwords are public, so they are for demonstration only. Change them before storing real data.

---

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `'node' is not recognized` or `command not found` | Node.js is not installed, or the terminal was opened before it was installed. Close the terminal, open a new one and try again. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | You are in PowerShell. Use Command Prompt (`cmd`) instead. |
| `node: bad option` or an error about `node:sqlite` | Your Node.js is too old. Install the current LTS version. |
| `Could not read package.json` | The terminal is in the wrong folder. Go to the folder that contains `package.json`. |
| `EADDRINUSE` or "address already in use" | Port 3000 is taken. Stop the other program, or set `PORT=3001` in `.env` and open http://localhost:3001. |
| "Too many failed sign-in attempts" | Wait 15 minutes, or stop and restart the app. |
| The page does not load | Check that the terminal running `npm start` is still open and shows no errors. |

### Starting again with fresh demo data

Stop the app, delete the `data` folder and run `npm start`.

**This permanently deletes every case, user, log and uploaded file in that copy of the project.**

## Checking the installation

```
npm test
```

This runs the automated API tests on a temporary database, so your data is not touched. All tests should pass.

---

## About the project

### Technology

| Part | Technology |
| --- | --- |
| Backend | Node.js, Express 5 |
| Database | SQLite (built into Node.js) |
| Frontend | HTML, CSS and JavaScript modules, with no build step |
| Sign-in | JWT tokens, bcrypt password hashing |

### Screens

| # | Screen | Address |
| --- | --- | --- |
| 1 | Dashboard | `#/dashboard` |
| 2 | Case Management, with case details and assignment | `#/cases` |
| 3 | Evidence Registration, with details and integrity check | `#/evidence` |
| 4 | Chain-of-Custody Log Tracker | `#/custody` |
| 5 | Investigation Findings & Summaries | `#/findings` |
| 6 | User Role Management / Access Control | `#/users` |
| 7 | Reports Hub (CSV export, print to PDF) | `#/reports` |
| 8 | Audit & Access Logs | `#/audit` |

Reports: Case Status, Evidence Register, Investigator Workload and Chain-of-Custody.

### What each role can do

| Capability | Admin | Case Manager | Investigator | Auditor |
| --- | :-: | :-: | :-: | :-: |
| Create and assign cases | Yes | Yes | | |
| See all cases | Yes | Yes | Assigned only | Yes |
| Register and download evidence | Yes | Yes | Assigned cases | |
| Verify evidence integrity | Yes | Yes | Assigned cases | Yes |
| Transfer custody | Yes | Yes | Items they hold | |
| Write findings | Yes | | Assigned cases | |
| Reports | Yes | Yes | | Yes |
| Audit logs | Yes | | | Yes |
| Manage users | Yes | | | |

### Evidence integrity

- The server computes SHA-256 and MD5 for uploaded files. If a hash you enter disagrees with the file, the upload is rejected.
- Items that cannot be uploaded are registered with an entered hash and labelled **Declared**.
- The database blocks changes to evidence hashes, and blocks edits or deletions of custody records and logs.
- Each audit entry includes the hash of the entry before it, so **Verify log integrity** can detect later changes to the database.
- Finalized findings are locked. Case summaries are versioned and include only finalized findings.

### Demo data

The people, cases and most hashes are fictional. Only `EV-2026-0001` has a real stored file (the year in the number follows the date of first start), so use it to try **Verify integrity** and **Download file**.

### Project layout

```
setup.bat, setup.sh      one-step installers
src/
  server.js, app.js      startup and Express setup
  config.js              settings
  permissions.js         roles and permissions
  db/                    schema.sql, connection, demo data
  middleware/            sign-in checks, case access, uploads
  lib/                   audit chain, validation, hashing
  routes/                API endpoints
public/                  web pages, styles, one JavaScript file per screen
test/api.test.js         automated tests
```

### Using it beyond your own computer

Change all demo passwords and put the app behind HTTPS.

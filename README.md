# Digital Forensics Case and Evidence Management Portal

| | |
| --- | --- |
| **Student** | VALLAMKONDA AKSHARA |
| **Enrolment No.** | 2303A51041 |
| **Stack** | React.js (Vite) frontend · Node.js + Express.js REST API · MongoDB with Mongoose |

A web application for managing forensic cases, registering evidence with SHA-256/MD5 hash values, tracking chain of custody, recording investigation findings and exporting reports as PDF or CSV.

This guide assumes you are starting on a fresh Windows computer. Follow it from top to bottom.

---

## Contents

1. [Software prerequisites](#1-software-prerequisites)
2. [Automated setup (one click)](#2-automated-setup-one-click)
3. [Manual setup, step by step](#3-manual-setup-step-by-step)
4. [Running the app](#4-running-the-app)
5. [Access URLs](#5-access-urls)
6. [Demo login credentials](#6-demo-login-credentials)
7. [Troubleshooting](#7-troubleshooting)
8. [About the project](#8-about-the-project)
9. [Docker, Kubernetes and CI/CD](#9-docker-kubernetes-and-cicd)

---

## 1. Software prerequisites

Install these before you start.

| Software | Required? | Where to get it | Notes |
| --- | --- | --- | --- |
| **Node.js v18 or newer** | **Yes** | https://nodejs.org | Download the **LTS** version (20 or 22 recommended). It includes `npm`. |
| **MongoDB Community Server** | **Yes**, unless you use Atlas | https://www.mongodb.com/try/download/community | Choose "Install MongoDB as a Service" during installation so it starts automatically. |
| **MongoDB Compass** | Optional | Included with the Community Server installer, or https://www.mongodb.com/products/compass | A visual tool for browsing the database. |
| **MongoDB Atlas** | Alternative to a local server | https://www.mongodb.com/atlas | A free cloud database. Use this instead of installing MongoDB locally. |
| **VS Code** | Recommended | https://code.visualstudio.com | For opening and editing the project. |
| A web browser | Yes | Chrome, Edge or Firefox | |

**Check that the installs worked.** Open a new **Command Prompt** (press the Windows key, type `cmd`, press Enter) and run:

```
node -v
npm -v
```

Both should print a version number, for example `v22.11.0` and `10.9.0`. If you get "not recognized", close the Command Prompt, open a new one, and try again.

**Check that MongoDB is running (local install only).** Press the Windows key, type **Services**, open it, and look for **MongoDB Server** with the status **Running**. You can also open MongoDB Compass and connect to `mongodb://localhost:27017`.

---

## 2. Automated setup (one click)

The project includes **`setup.bat`**, which does the whole setup for you.

1. Extract the project ZIP (see [Step 3.1](#31-extract-the-project) below).
2. Open the project folder and **double-click `setup.bat`**.
3. Wait for it to finish. It shows each step as it runs:

| Step | What `setup.bat` does |
| --- | --- |
| 1/6 | Checks that Node.js is installed (and offers to install it with `winget` if not) |
| 2/6 | Creates the `.env` settings file with default values if it does not exist yet (`PORT=5000`, `MONGODB_URI=mongodb://localhost:27017/forensics_db`) |
| 3/6 | Runs `npm install` in the project root (installs the backend packages) |
| 4/6 | Runs `npm install` in the `client` folder (installs the React packages) and builds the React app |
| 5/6 | Loads the demo sample data into MongoDB. It only does this if the database is empty, so it never overwrites your data |
| 6/6 | Prints how to start the app |

4. When it says **Setup complete**, go to [Section 4: Running the app](#4-running-the-app).

You can run `setup.bat` again at any time. It keeps your existing `.env` file and data.

> On macOS or Linux, run `bash setup.sh` in a terminal instead.

---

## 3. Manual setup, step by step

Use this if you prefer to run each command yourself, or if `setup.bat` reported a problem.

### 3.1 Extract the project

1. Right-click the project ZIP file and choose **Extract All…**
2. Extract it somewhere simple, such as `C:\Projects\digital-forensics-portal`.
3. Open the extracted folder. You should see `package.json`, `setup.bat`, a `server` folder and a `client` folder directly inside it. If you only see one folder, open that folder.

**Open a terminal in the project folder:** in File Explorer, click the address bar, type `cmd` and press Enter. Or open the folder in VS Code and choose **Terminal → New Terminal**.

### 3.2 Install the backend (root) packages

In the project folder, run:

```
npm install
```

This installs the Express backend packages (`express`, `mongoose`, `cors`, `dotenv`, `bcryptjs`, `jsonwebtoken`, `multer`, `pdfkit` and others).

### 3.3 Install the frontend (client) packages

```
cd client
npm install
cd ..
```

This installs React, React Router and Vite.

> The project uses npm **workspaces**, so the `npm install` in step 3.2 already installs the client packages too. Running it again inside `client` is harmless.

### 3.4 Create the `.env` settings file

Copy the example file:

```
copy .env.example .env
```

Open `.env` in VS Code or Notepad. The two most important settings are:

```
MONGODB_URI=mongodb://localhost:27017/forensics_db
PORT=5000
```

- **Local MongoDB:** leave `MONGODB_URI` as it is.
- **MongoDB Atlas:** replace it with your Atlas connection string, for example
  `MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/forensics_db?retryWrites=true&w=majority`

All other settings in `.env` have working defaults. See [Section 8](#all-settings) for the full list.

### 3.5 Load the demo data

```
npm run seed:if-empty
```

This adds the demo users, cases and evidence if the database is empty. If you skip this step, the server does the same thing automatically the first time it starts.

To **erase everything** and reload fresh demo data later, run `npm run seed`.

### 3.6 Build the React app (needed for `npm start` only)

```
npm run build
```

This creates the production version of the React app in `client/dist`. You can skip it if you only use `npm run dev`.

---

## 4. Running the app

Open a terminal in the project folder. Choose **one** of these modes.

### Option A: Development mode (recommended while working on the code)

```
npm run dev
```

This starts **both** servers in one terminal:

- **Backend:** the Express API on port **5000**. It restarts when you change server code.
- **Frontend:** the React app on port **5173**, with instant reload. Its `/api` requests are forwarded to port 5000.

Open **http://localhost:5173**.

You may see one or two "proxy error" lines in the first second while the backend starts. They stop once the backend prints `Forensics portal API running`.

### Option B: Production mode (one server)

```
npm run build
npm start
```

The Express server serves both the API and the built React app on port **5000**. Open **http://localhost:5000**.

When the server is ready, the terminal shows:

```
Connected to MongoDB at mongodb://localhost:27017/forensics_db
Forensics portal API running at http://localhost:5000
```

**Keep the terminal open** while you use the app. To stop it, click in the terminal and press **Ctrl + C**.

---

## 5. Access URLs

| What | Development (`npm run dev`) | Production (`npm start`) |
| --- | --- | --- |
| **Frontend (React app)** | http://localhost:5173 | http://localhost:5000 |
| **Backend API** | http://localhost:5000/api | http://localhost:5000/api |
| API health check | http://localhost:5000/api/health | http://localhost:5000/api/health |
| MongoDB (Compass) | `mongodb://localhost:27017`, database `forensics_db` | same |

The health check returns `{"status":"ok","database":"connected","uptime":...}` (HTTP 200) when the backend and database are both working, and HTTP 503 with `"database":"disconnected"` when MongoDB cannot be reached. Docker and Kubernetes use it as their health probe.

> **Port 3000:** this project's backend uses port 5000. If you prefer port 3000, set `PORT=3000` in `.env` and restart. The development proxy follows the same setting.

---

## 6. Demo login credentials

The sample data creates one account for each role. **All accounts use the password `Forensics@123`.**

| Role | Username | Password | Demo name | What this role can do |
| --- | --- | --- | --- | --- |
| **Admin** | `admin` | `Forensics@123` | Priya Raman | Everything, including managing users and roles |
| **Case Manager** | `manager` | `Forensics@123` | Daniel Osei | Create and assign cases, register evidence, view reports |
| **Forensic Investigator** | `investigator1` | `Forensics@123` | Ananya Iyer | Work on assigned cases: evidence, custody transfers, findings |
| **Forensic Investigator** | `investigator2` | `Forensics@123` | Marcus Lindholm | Same as above, on different cases |
| **Forensic Investigator** | `investigator3` | `Forensics@123` | Sofia Mendes | Same as above, on different cases |
| **Auditor** | `auditor` | `Forensics@123` | Grace Whitfield | Read-only oversight: all cases, reports, audit logs, integrity checks |

These passwords are public. Change them (or create new accounts on the **Users & Access** screen) before storing real data.

---

## 7. Troubleshooting

| Problem | What to do |
| --- | --- |
| `'node' is not recognized` | Node.js is not installed, or the terminal was opened before installing it. Close the terminal, open a new one, and try again. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | You are in PowerShell. Use **Command Prompt** (`cmd`) instead, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once in PowerShell. |
| `Could not connect to MongoDB at mongodb://localhost:27017/...` | MongoDB is not running. Open **Services** and start **MongoDB Server**, or run `net start MongoDB` in an administrator Command Prompt. If you use Atlas, check `MONGODB_URI` in `.env` and that your IP address is allowed in Atlas **Network Access**. |
| `Could not read package.json` | The terminal is in the wrong folder. `cd` into the folder that contains `package.json`. |
| `EADDRINUSE: address already in use :::5000` | Something else is using port 5000. Stop it, or set a different `PORT` in `.env` (for example `PORT=5050`). |
| http://localhost:5000 says "The React app has not been built yet" | Run `npm run build`, then restart `npm start`. Or use `npm run dev` and open http://localhost:5173. |
| "Too many failed sign-in attempts" | Wait 15 minutes, or stop and restart the server. |
| The SHA-256 box says "needs HTTPS or localhost" | Browsers only allow in-browser hashing on `localhost` or HTTPS. The server still computes the hash when the file is uploaded. |
| I want to start over with fresh demo data | Run `npm run seed`. **This erases all cases, evidence, users and logs.** |

**Checking the installation:** run `npm test`. It runs the automated API tests against a separate `forensics_test` database, so your data is not touched. All tests should pass. MongoDB must be running.

---

## 8. About the project

### Commands

| Command | What it does |
| --- | --- |
| `npm install` | Installs backend and frontend packages |
| `npm run dev` | Runs the backend (port 5000) and the React dev server (port 5173) together |
| `npm run build` | Builds the React app into `client/dist` |
| `npm start` | Runs the backend and serves the built React app on port 5000 |
| `npm run seed:if-empty` | Loads demo data only if the database is empty |
| `npm run seed` | **Erases the database** and loads fresh demo data |
| `npm test` | Runs the automated API tests |

### The 8 screens

| # | Screen | What it does |
| --- | --- | --- |
| 1 | Dashboard / Case Metrics Overview | Active and overdue cases, evidence counts, integrity failures, recent custody activity, investigator workload |
| 2 | Case Management | Create cases, assign a lead and support investigators, update status and due dates |
| 3 | Evidence Registration | Upload evidence; the SHA-256 hash is generated automatically in the browser and checked again by the server, which also records MD5. Verify integrity and download files |
| 4 | Chain-of-Custody Log Tracker | Timeline of every item, and permanent transfer records with handler, location and purpose |
| 5 | Investigation Findings & Summaries | Draft and finalize findings with evidence attachments; generate versioned case summaries |
| 6 | Role Management & Access Control | Add users, change roles, reset passwords, deactivate accounts; view the permission matrix |
| 7 | Reports Hub | Case Status, Evidence Register, Investigator Workload and Chain-of-Custody reports, each exportable as **PDF** or **CSV** |
| 8 | System Audit & Access Logs | Full audit trail, evidence access log, and a one-click check that the audit log has not been tampered with |

### Data models (Mongoose schemas)

| Model | Stores |
| --- | --- |
| `User` | Accounts, roles and hashed passwords |
| `Case` | Case number (`DF-YYYY-NNNN`), title, description, type, priority, status, assigned investigators, due date, timestamps |
| `Evidence` | Evidence number (`EV-YYYY-NNNN`), case reference, source, SHA-256 and MD5 hash values, collection time, description, file, current custodian |
| `CustodyEvent` | Each registration and transfer: from, to, location, purpose, time, recorded by |
| `AccessLog` | Every view, download, verification, transfer and registration of evidence |
| `Finding` | Investigation findings with severity, linked evidence, attachment and Draft/Final status |
| `CaseSummary` | Versioned case summaries built from finalized findings |
| `AuditLog` | Hash-chained audit trail of all important actions |

### All settings

| Setting in `.env` | Default | Meaning |
| --- | --- | --- |
| `PORT` | `5000` | Backend port (also serves the built React app for `npm start`) |
| `MONGODB_URI` | `mongodb://localhost:27017/forensics_db` | MongoDB connection string (local or Atlas) |
| `JWT_SECRET` | auto-generated | Secret for signing login tokens. Generated and saved automatically if empty |
| `JWT_EXPIRES_IN` | `8h` | How long a sign-in lasts |
| `DATA_DIR` | `./server/data` | Where uploaded evidence files are stored |
| `MAX_UPLOAD_MB` | `500` | Largest upload allowed |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Frontend address allowed to call the API (CORS) |
| `SEED_DEMO` | `true` | Create demo data automatically when the database is empty |

### Project layout

```
package.json            root scripts; installs server and client together (npm workspaces)
.env.example            settings template (copy to .env)
setup.bat / setup.sh    one-click setup
Dockerfile              multi-stage container image (builds the client, runs the API)
docker-compose.yml      runs the app and MongoDB together in containers
k8s/                    Kubernetes manifests (namespace, config, MongoDB, app, service)
.github/workflows/      CI/CD pipeline (tests, Docker image, Kubernetes deploy, GHCR publish)
server/                 Express.js backend
  src/server.js         starts the API and connects to MongoDB
  src/app.js            routes, security headers, CORS, error handling
  src/models/           Mongoose schemas
  src/routes/           REST API endpoints
  src/middleware/       sign-in checks and file uploads
  src/lib/              audit hash chain, validation, PDF report generator
  src/seed.js           demo data
  test/api.test.js      automated API tests
client/                 React.js frontend (Vite)
  src/App.jsx           page routes
  src/pages/            the 8 screens
  src/components/       shared layout, tables, dialogs, charts
  src/context/          sign-in state and notifications
```

### Security in brief

- Passwords are stored as bcrypt hashes. Sign-in uses signed JWT tokens that expire after 8 hours.
- Every request is checked against the user's role on the server.
- Evidence hash values cannot be changed after registration. Custody records and logs can only be added to, never edited or deleted.
- Each audit entry includes the hash of the one before it, so changes made directly in the database are detected by **Verify log integrity**.

---

## 9. Docker, Kubernetes and CI/CD

### 9.1 Run with Docker Compose (no Node.js or MongoDB install needed)

Install **Docker Desktop** (https://www.docker.com/products/docker-desktop), start it, then in the project folder run:

```
docker compose up -d --build
```

This builds the image from the `Dockerfile` and starts two containers: `forensics-mongo` (MongoDB 8.0) and `forensics-app` (the portal). Open **http://localhost:5000** and sign in as `admin` / `Forensics@123`. Demo data is loaded automatically on first start.

| Command | What it does |
| --- | --- |
| `docker compose ps` | Shows both containers and their health status |
| `docker compose logs -f app` | Follows the application log |
| `docker compose down` | Stops the containers (data is kept in the `mongo-data` and `evidence-data` volumes) |
| `docker compose down -v` | Stops the containers **and deletes all data** |

To use a fixed login-token secret, put `JWT_SECRET=<long random value>` in `.env` before running `docker compose up`.

### 9.2 Build and run the image by hand

```
docker build -t digital-forensics-portal:latest .
docker network create forensics-net
docker run -d --name mongo --network forensics-net mongo:8.0
docker run -d --name forensics-app --network forensics-net -p 5000:5000 ^
  -e MONGODB_URI=mongodb://mongo:27017/forensics_db ^
  -v forensics-evidence:/data digital-forensics-portal:latest
```

(Use `\` instead of `^` for line continuation on macOS/Linux.)

The image is built in two stages: stage 1 installs all packages and builds the React client; stage 2 contains only Node.js 22 (Alpine), the server's production packages, the server code and the built client. It runs as the non-root `node` user, stores evidence files in the `/data` volume, and has a `HEALTHCHECK` that calls `/api/health`.

The CI pipeline also publishes the image to GitHub Container Registry as `ghcr.io/2303a51041/digital-forensics-portal` (tags `latest`, the branch name, the short commit SHA and release versions).

### 9.3 Deploy to Kubernetes

Works with Docker Desktop's Kubernetes, minikube or kind.

```
kubectl apply -f k8s/namespace.yaml
kubectl create secret generic forensics-secret -n forensics --from-literal=JWT_SECRET=<long random value>
kubectl apply -k k8s/
kubectl get pods,svc -n forensics
```

Open **http://localhost:30500** (Docker Desktop) or run `minikube service forensics-app -n forensics --url`. You can also use `kubectl port-forward -n forensics svc/forensics-app 8080:80` and open http://localhost:8080.

| File | What it creates |
| --- | --- |
| `k8s/namespace.yaml` | The `forensics` namespace |
| `k8s/configmap.yaml` | Non-secret settings (`PORT`, `MONGODB_URI`, `DATA_DIR`, ...) |
| `k8s/secret.example.yaml` | Example of the `forensics-secret` holding `JWT_SECRET` (create the real one with `kubectl create secret`) |
| `k8s/mongodb.yaml` | MongoDB StatefulSet with a 2 GiB persistent volume and a headless Service |
| `k8s/app.yaml` | Evidence PersistentVolumeClaim (5 GiB), the app Deployment with readiness/liveness probes and resource limits, and a NodePort Service on port 30500 |
| `k8s/kustomization.yaml` | Lets `kubectl apply -k k8s/` apply all of the above |

The app runs as **1 replica** because evidence files are stored on a ReadWriteOnce volume and sign-in rate limiting is held in memory. If the image is pulled from GHCR and the package is private, make it public in GitHub (**Packages → digital-forensics-portal → Package settings**) or add an image pull secret. With a locally built image, load it into the cluster instead (`kind load docker-image ...` or `minikube image load ...`).

### 9.4 CI/CD pipeline (GitHub Actions)

`.github/workflows/main.yml` runs on every push to `main` and `react-mongodb`, on pull requests to `main`, on version tags (`v*`) and on demand.

| Job | Steps |
| --- | --- |
| **Test and build** | Checkout → Node.js 22 → `npm ci` → `npm test` (18 API tests against a MongoDB 8.0 service container) → `npm run build` |
| **Docker image and Kubernetes deploy** | Build the image with Buildx → smoke-test it with a MongoDB container (health, React page, demo login) → create a kind Kubernetes cluster → apply `k8s/` → wait for MongoDB and the app to roll out → check `/api/health` through the Service → push the image to GHCR (not for pull requests) |

Results are on the repository's **Actions** tab: https://github.com/2303A51041/digital-forensics-portal/actions

### 9.5 Git workflow

- `main` is the releasable branch. Features are developed on branches (for example `react-mongodb`) and merged into `main` through a pull request once the CI pipeline is green.
- Pull requests use the checklist in `.github/pull_request_template.md`.
- Releases are tagged with semantic versions (`git tag v2.0.0 && git push origin v2.0.0`); the pipeline then publishes the image as `ghcr.io/2303a51041/digital-forensics-portal:2.0.0`.
- `.env`, `server/data/`, `node_modules/` and `client/dist/` are never committed.

# Placement Tracker

A private placement application tracker for students. It includes email/password accounts, a dashboard, application search and filters, rejection feedback, deadline reminders, and CSV export.

## Run in Replit

This project uses the Replit PostgreSQL database and its configured workflows. Install dependencies, then apply the development schema once:

```sh
pnpm install
pnpm --filter @workspace/db run push
```

Start both configured workflows:

- **API Server** — `pnpm --filter @workspace/api-server run dev`
- **Placement Tracker** — `pnpm --filter @workspace/placement-tracker run dev`

The workflows provide the ports and route `/api` requests to the API server. To run the app outside Replit, provide a PostgreSQL `DATABASE_URL` and configure a same-origin reverse proxy for `/api`.

## First use

Create an account with an email address and a password of at least 8 characters. Each new account gets three private sample applications; **Remove samples** deletes only those examples. Passwords are stored as scrypt hashes, session cookies are HTTP-only, and application records are scoped to their account.

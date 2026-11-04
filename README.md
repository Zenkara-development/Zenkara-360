# Unified CRM & IT Desk Platform

A single web application handling both CRM (sales pipeline) and IT Help Desk (ticket management).

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 15+

### Setup

```bash
# Install all dependencies
npm install

# Configure environment
cp server/.env.example server/.env
# Edit server/.env with your DB connection and JWT secrets

# Run database migrations
npm run db:migrate

# Start both servers (http://localhost:5173 frontend, http://localhost:4000 API)
npm run dev
```

## Project Structure

```
crm-itdesk/
├── client/     React 18 + TypeScript + Tailwind frontend
├── server/     Node.js + Express + Prisma backend
└── README.md
```

## Tech Stack
- **Frontend**: React 18, TypeScript, Tailwind CSS, React Query, React Router
- **Backend**: Node.js, Express, TypeScript, Prisma ORM
- **Database**: PostgreSQL
- **Auth**: JWT + bcrypt

## Roadmap
See `project_blueprint.docx` for the full architecture document, requirements, database schema, and 14-week project roadmap.

## Recent Changes
See `CHANGELOG.md` for what's changed lately — including the Schedules/WhatsApp notification feature, the AI Command action registry, and the e2e test stabilization work.

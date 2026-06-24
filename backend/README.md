# SorobanPay Backend

Backend service for merchant payout scheduling and event indexing for SorobanPay.

## Features

- **Event Indexing**: Fetches and stores Soroban contract events (subscribe, executed)
- **Payout Summaries**: Generates daily and weekly payout summaries for merchants
- **Scheduled Jobs**: Automatically fetches events and generates summaries on a schedule
- **API Endpoints**: Provides REST API to retrieve payout summaries

## Tech Stack

- Node.js with TypeScript
- Express.js
- Prisma ORM
- PostgreSQL
- node-cron for scheduling
- @stellar/stellar-sdk for Soroban interaction

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database
- npm or yarn

### Installation

1. Install dependencies:
```bash
cd backend
npm install
```

2. Configure environment variables:
Copy `.env.example` to `.env` and update the values:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/sorobanpay?schema=public"
RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
CONTRACT_ID="your-contract-id"
PORT=3001
```

3. Set up the database:
```bash
npx prisma migrate dev
```

4. Generate Prisma client:
```bash
npx prisma generate
```

5. Run the server:
```bash
npm run dev
```

## API Endpoints

### Get Summaries for Merchant
```
GET /api/summaries/merchant/:merchantAddress?type=daily|weekly
```

### Get Summary by ID
```
GET /api/summaries/:id
```

## Scheduled Jobs

- **Event Fetching**: Every 5 minutes
- **Daily Summaries**: 1:00 AM every day
- **Weekly Summaries**: 2:00 AM every Sunday

## Project Structure

```
backend/
├── src/
│   ├── generated/
│   │   └── prisma/          # Prisma client
│   ├── lib/
│   │   └── prisma.ts        # Prisma client initialization
│   ├── routes/
│   │   └── summaries.ts     # API routes for summaries
│   ├── services/
│   │   ├── eventIndexer.ts  # Event indexing service
│   │   └── payoutSummaryGenerator.ts  # Summary generation service
│   └── index.ts             # Main entry point
├── prisma/
│   └── schema.prisma        # Database schema
├── package.json
├── tsconfig.json
└── README.md
```

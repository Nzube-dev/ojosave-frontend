import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { EventIndexer } from './services/eventIndexer';
import { PayoutSummaryGenerator } from './services/payoutSummaryGenerator';
import summariesRouter from './routes/summaries';
import subscriptionsRouter from './routes/subscriptions';
import auditLogsRouter from './routes/auditLogs';
import { apiLimiter } from './middleware/rateLimiter';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(apiLimiter);

// Routes
app.use('/api/summaries', summariesRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/audit-logs', auditLogsRouter);

// Initialize services
const rpcUrl = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const contractId = process.env.CONTRACT_ID || '';

const eventIndexer = new EventIndexer(rpcUrl, contractId);
const summaryGenerator = new PayoutSummaryGenerator();

// Schedule jobs
// Fetch events every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('Fetching new events...');
  await eventIndexer.fetchAndStoreEvents();
});

// Generate daily summaries at 1 AM every day
cron.schedule('0 1 * * *', async () => {
  console.log('Generating daily summaries...');
  await summaryGenerator.generateDailySummaries();
});

// Generate weekly summaries at 2 AM every Sunday
cron.schedule('0 2 * * 0', async () => {
  console.log('Generating weekly summaries...');
  await summaryGenerator.generateWeeklySummaries();
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Initial fetch of events
  eventIndexer.fetchAndStoreEvents();
});

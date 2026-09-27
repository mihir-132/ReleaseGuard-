import 'dotenv/config';
import express from 'express';
import uploadRouter from './routes/upload.js';
import analysisRouter from './routes/analysis.js';
import reportsRouter from './routes/reports.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/upload', uploadRouter);
app.use('/api/analysis', analysisRouter);
app.use('/api/reports', reportsRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});

export default app;

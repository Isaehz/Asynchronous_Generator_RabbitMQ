import { Router } from 'express';
import {
  createReport,
  getReportStatus,
  downloadReport,
  listRecentReports
} from '../controllers/reportsController.js';

const router = Router();

router.post('/reports', createReport);
router.get('/reports', listRecentReports);
router.get('/reports/:report_id', getReportStatus);
router.get('/reports/:report_id/download', downloadReport);

export default router;

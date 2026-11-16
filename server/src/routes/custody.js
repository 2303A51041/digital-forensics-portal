import { Router } from 'express';
import { objectId } from '../lib/util.js';
import { scopeByCase } from '../middleware/auth.js';
import { CustodyEvent, Evidence } from '../models/index.js';

const router = Router();

/** The most recent custody events across all evidence the user may see. */
router.get('/', async (req, res) => {
  const evidenceFilter = await scopeByCase(req.user, req.query.caseId ? { case: objectId(String(req.query.caseId), 'case id') } : {});
  const filter = {};
  if (Object.keys(evidenceFilter).length) {
    filter.evidence = { $in: await Evidence.find(evidenceFilter).distinct('_id') };
  }
  if (req.query.evidenceId) {
    const evidenceId = objectId(String(req.query.evidenceId), 'evidence id');
    filter.evidence = filter.evidence ? { $in: filter.evidence.$in.filter((e) => String(e) === evidenceId) } : evidenceId;
  }

  const rows = await CustodyEvent.find(filter)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(200)
    .populate({ path: 'evidence', select: 'evidenceNumber itemName case', populate: { path: 'case', select: 'caseNumber' } })
    .populate('fromUser', 'fullName')
    .populate('toUser', 'fullName')
    .populate('recordedBy', 'fullName');
  res.json(rows);
});

export default router;

import { Router } from 'express';

import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import * as controller from './trial.controller';
import {
  createTrialSchema,
  eligibilityQuerySchema,
  outcomeSchema,
  trialListQuerySchema,
  trialParamsSchema,
} from './trial.schema';

/** /trials — at-home trial bookings. Auth required. */
export const trialsRouter = Router();
trialsRouter.use(authenticate);

trialsRouter.get('/eligibility', validate(eligibilityQuerySchema, 'query'), controller.eligibility);
trialsRouter.post('/', validate(createTrialSchema), controller.createBooking);
trialsRouter.get('/', validate(trialListQuerySchema, 'query'), controller.listTrials);
trialsRouter.get('/:id', validate(trialParamsSchema, 'params'), controller.getTrial);
trialsRouter.post('/:id/outcome', validate(trialParamsSchema, 'params'), validate(outcomeSchema), controller.recordOutcome);
trialsRouter.post('/:id/cancel', validate(trialParamsSchema, 'params'), controller.cancelBooking);
// DEV-only: stand in for the PhonePe trial-charge webhook until phase 4c.
trialsRouter.post('/:id/confirm-dev', validate(trialParamsSchema, 'params'), controller.confirmTrialDev);

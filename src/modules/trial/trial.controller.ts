import type { RequestHandler } from 'express';

import { env } from '@/config/env';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import { trialService } from './trial.service';
import type {
  CreateTrialInput,
  EligibilityQuery,
  OutcomeInput,
  TrialListQuery,
  TrialParams,
} from './trial.schema';

const userId = (req: Parameters<RequestHandler>[0]): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

export const eligibility: RequestHandler = async (req, res) => {
  const query = req.query as unknown as EligibilityQuery;
  res.status(200).json(await trialService.eligibility(userId(req), query));
};

export const createBooking: RequestHandler = async (req, res) => {
  res.status(201).json(await trialService.createBooking(userId(req), req.body as CreateTrialInput));
};

export const listTrials: RequestHandler = async (req, res) => {
  const { page, limit } = req.query as unknown as TrialListQuery;
  res.status(200).json(await trialService.listTrials(userId(req), page, limit));
};

export const getTrial: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as TrialParams;
  res.status(200).json(await trialService.getTrial(userId(req), id));
};

export const recordOutcome: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as TrialParams;
  res.status(200).json(await trialService.recordOutcome(userId(req), id, req.body as OutcomeInput));
};

export const cancelBooking: RequestHandler = async (req, res) => {
  const { id } = req.params as unknown as TrialParams;
  res.status(200).json(await trialService.cancelBooking(userId(req), id));
};

/**
 * DEV-only stand-in for the PhonePe trial-charge webhook: captures the caller's own
 * booking via the same idempotent `markTrialPaid`. Disabled in production (404).
 */
export const confirmTrialDev: RequestHandler = async (req, res) => {
  if (env.isProd) throw new NotFoundError();
  const { id } = req.params as unknown as TrialParams;
  await trialService.getTrial(userId(req), id); // ownership check (404/403)
  res.status(200).json(await trialService.markTrialPaid(id));
};

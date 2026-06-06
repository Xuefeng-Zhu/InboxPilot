/**
 * JobRepository — data access for the support_jobs table.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type { Job, JobType, JobStatus, CreateJobInput } from '../types/index.js';

/** Raw row shape returned by the database (snake_case columns). */
interface JobRow {
  id: string;
  organization_id: string;
  job_type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Convert a database row to a Job entity. */
function toJob(row: JobRow): Job {
  return {
    id: row.id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    runAfter: new Date(row.run_after),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

/** Convert camelCase Job fields to snake_case for database writes. */
function toRow(fields: Partial<Job>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (fields.organizationId !== undefined) row.organization_id = fields.organizationId;
  if (fields.jobType !== undefined) row.job_type = fields.jobType;
  if (fields.payload !== undefined) row.payload = fields.payload;
  if (fields.status !== undefined) row.status = fields.status;
  if (fields.attempts !== undefined) row.attempts = fields.attempts;
  if (fields.maxAttempts !== undefined) row.max_attempts = fields.maxAttempts;
  if (fields.lastError !== undefined) row.last_error = fields.lastError;
  if (fields.runAfter !== undefined) row.run_after = fields.runAfter.toISOString();
  if (fields.createdAt !== undefined) row.created_at = fields.createdAt.toISOString();
  if (fields.updatedAt !== undefined) row.updated_at = fields.updatedAt.toISOString();
  if (fields.completedAt !== undefined) {
    row.completed_at = fields.completedAt ? fields.completedAt.toISOString() : null;
  }

  return row;
}

export class JobRepository {
  constructor(private db: DatabaseClient) {}

  /** Create a new job record. */
  async create(input: CreateJobInput): Promise<Job> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      job_type: input.jobType,
    };

    if (input.payload !== undefined) row.payload = input.payload;
    if (input.maxAttempts !== undefined) row.max_attempts = input.maxAttempts;
    if (input.runAfter !== undefined) row.run_after = input.runAfter.toISOString();

    const { data, error } = await this.db
      .from('support_jobs')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`JobRepository.create failed: ${error.message}`);
    }

    return toJob(data as JobRow);
  }

  /** Find a job by its ID. Returns null if not found. */
  async findById(id: string): Promise<Job | null> {
    const { data, error } = await this.db
      .from('support_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`JobRepository.findById failed: ${error.message}`);
    }

    return data ? toJob(data as JobRow) : null;
  }

  /** Update an existing job by id (used for status changes, error recording, etc.). */
  async update(id: string, updates: Partial<Job>): Promise<Job> {
    const row = toRow(updates);
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('support_jobs')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`JobRepository.update failed: ${error.message}`);
    }

    return toJob(data as JobRow);
  }
}

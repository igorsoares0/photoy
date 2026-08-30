/**
 * Job vocabulary for long-running engine work. Milestone 1 completes every
 * operation synchronously, but the states are fixed here so the queue landing
 * in milestone 4 does not change the wire contract.
 */
export type JobId = string;

export type JobState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface JobEvent {
  jobId: JobId;
  state: JobState;
  /**
   * Completion ratio in the range [0, 1].
   *
   * Absent when the running operation cannot report a real one - the product
   * shows a state and a way out rather than inventing a percentage.
   */
  progress?: number;
  /** Short, user-facing label in the product's display language. */
  label?: string;
}

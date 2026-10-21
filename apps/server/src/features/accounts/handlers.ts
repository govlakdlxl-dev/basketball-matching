import type { AuthActor, Id } from '@basket/core/contracts';
import { validatePreferences } from '@basket/core/preferences';
import type { Preferences } from '@basket/core/preferences';
import type { Database } from '../../infra/database';
import { ApiError } from '../../http/auth';

export type MyTeam = { id: Id; name: string; status: string; role: 'captain' | 'secretary' | 'member'; active: boolean; reviewReason: string | null };
export type ProfileSummary = { userId: Id; nickname: string; isOperator: boolean };

export function textField(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) throw new ApiError('INVALID_INPUT', 400);
  return value.trim();
}

export function createAccounts(database: Database) {
  return {
    getPreferences(actor: AuthActor): Promise<Preferences | null> {
      return database.rpc('api_get_preferences', { p_actor: actor.userId });
    },
    savePreferences(actor: AuthActor, input: unknown): Promise<Preferences> {
      let valid: Preferences;
      try { valid = validatePreferences(input); } catch { throw new ApiError('INVALID_PREFERENCES', 400); }
      return database.rpc('api_save_preferences', { p_actor: actor.userId, p_input: valid });
    },
    getProfile(actor: AuthActor): Promise<ProfileSummary> {
      return database.rpc('api_profile', { p_actor: actor.userId });
    },
    getMyTeams(actor: AuthActor): Promise<MyTeam[]> {
      return database.rpc('api_my_teams', { p_actor: actor.userId });
    },
    createTeam(actor: AuthActor, input: Record<string, unknown>): Promise<{ id: Id; name: string; status: 'pending' }> {
      return database.rpc('api_create_team', { p_actor: actor.userId, p_name: textField(input.name, 80), p_contact_route: textField(input.contactRoute, 300), p_evidence: textField(input.evidence), p_request_id: textField(input.requestId ?? crypto.randomUUID(), 128) });
    },
    reviewTeam(actor: AuthActor, input: Record<string, unknown>): Promise<void> {
      if (!['approved', 'needs_info', 'rejected'].includes(String(input.decision))) throw new ApiError('INVALID_INPUT', 400);
      return database.rpc('api_review_team', { p_actor: actor.userId, p_team_id: textField(input.teamId, 128), p_decision: input.decision, p_reason: textField(input.reason), p_request_id: textField(input.requestId, 128) });
    },
    updateTeamMember(actor: AuthActor, input: Record<string, unknown>): Promise<void> {
      if (!['captain', 'secretary', 'member'].includes(String(input.role)) || typeof input.active !== 'boolean') throw new ApiError('INVALID_INPUT', 400);
      return database.rpc('api_update_team_member', { p_actor: actor.userId, p_team_id: textField(input.teamId, 128), p_user_id: textField(input.userId, 128), p_role: input.role, p_active: input.active, p_request_id: textField(input.requestId, 128) });
    },
  };
}

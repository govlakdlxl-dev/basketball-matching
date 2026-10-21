import type {Database} from '../infra/database';
export async function completeAccountDeletion(database:Database,userId:string,authId:string):Promise<boolean>{
 let success=false;try{const {error}=await database.client.auth.admin.deleteUser(authId);success=!error;}catch{}
 if(!success){const profile=await database.client.from('profiles').select('auth_id').eq('id',userId).maybeSingle();success=!profile.error&&Boolean(profile.data)&&profile.data!.auth_id===null;}
 await database.rpc('api_finish_account_deletion',{p_actor:userId,p_success:success});return success;
}
export async function runAccountDeletionTick(database:Database){const rows=await database.rpc<{userId:string;authId:string}[]>('api_account_deletion_candidates'),counts={completed:0,pending:0};for(const row of rows){try{if(await completeAccountDeletion(database,row.userId,row.authId))counts.completed++;else counts.pending++;}catch{counts.pending++;}}return counts;}

import {createHostedApi} from './hosting.mjs';
import {createSharedBudget} from './budget.mjs';
import {createSupabaseBudget} from './supabase-budget.mjs';
const integer=value=>typeof value==='string'&&/^[1-9][0-9]{0,4}$/.test(value)?Number(value):NaN;
export function fromEnvironment(env=process.env){
 const acquirePermit=env.RAVEN_REPLAY_BUDGET_BACKEND==='supabase'?createSupabaseBudget({url:env.RAVEN_REPLAY_SUPABASE_URL,token:env.RAVEN_REPLAY_SUPABASE_SECRET_KEY}):createSharedBudget({url:env.RAVEN_REPLAY_BUDGET_URL,token:env.RAVEN_REPLAY_BUDGET_TOKEN,namespace:env.RAVEN_REPLAY_BUDGET_NAMESPACE,runPerMinute:integer(env.RAVEN_REPLAY_RUNS_PER_MINUTE),runPerDay:integer(env.RAVEN_REPLAY_RUNS_PER_DAY),fetchPerMinute:integer(env.RAVEN_REPLAY_FETCHES_PER_MINUTE),fetchPerDay:integer(env.RAVEN_REPLAY_FETCHES_PER_DAY)});
 return createHostedApi({config:{origin:env.RAVEN_REPLAY_ORIGIN,snapshotId:env.RAVEN_REPLAY_SNAPSHOT_ID,enginePinSha256:env.RAVEN_REPLAY_ENGINE_PIN_SHA256},acquirePermit});
}
export const handle=fromEnvironment();

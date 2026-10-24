export const MODES = ['FAST', 'SPECIALIST', 'REVIEW', 'EXPLORE'];
export const TASK_TYPES = ['AI_TASK', 'HUMAN_TASK', 'COLLABORATIVE_TASK'];

export function routeTask(input, history = []) {
  if (input.mode && !MODES.includes(input.mode)) throw new Error('Invalid mode');
  if (input.provider && !['claude', 'codex'].includes(input.provider)) throw new Error('Invalid provider');
  const goal = input.goal.toLowerCase();
  const design = /design|ux|ui|디자인|시안|배치|화면|레이아웃/.test(goal);
  const complex = /architecture|refactor|security|migration|root cause|아키텍처|리팩터|보안|마이그레이션|근본/.test(goal);
  const tiny = /문구|오타|간격|색상|typo|spacing|copy/.test(goal) && goal.length < 130;
  const mode = input.mode || (design && /탐색|시안|대안|비교|explore/.test(goal) ? 'EXPLORE' : complex ? 'REVIEW' : tiny ? 'FAST' : 'SPECIALIST');
  const scores = { claude: 0, codex: 0 };
  if (design) scores.claude += 2;
  if (/bug|test|typescript|spring|기능|버그|테스트/.test(goal)) scores.codex += 2;
  for (const past of history.slice(0, 50)) if (past.provider in scores && past.repo === input.repo) {
    if (past.status === 'APPROVED') scores[past.provider] += 0.2;
    if (['FAILED','UNVERIFIED','REJECTED'].includes(past.status)) scores[past.provider] -= 0.15;
  }
  const provider = input.provider || (scores.codex > scores.claude ? 'codex' : 'claude');
  return { mode, provider, reason: input.mode ? `Manual mode ${mode}; provider ${provider}` : `Auto: design=${design}, complex=${complex}, tiny=${tiny}; scores ${JSON.stringify(scores)}` };
}

export function nextHumanActions(tasks) {
  const completed = new Set(tasks.filter(task => ['APPROVED', 'SELECTED', 'DONE'].includes(task.status)).map(task => task.id));
  return tasks.filter(task => task.type === 'HUMAN_TASK' && task.status === 'QUEUED')
    .map(task => {
      const missing = task.dependsOn.filter(id => !completed.has(id));
      const downstream = tasks.filter(other => other.dependsOn.includes(task.id)).length;
      return { taskId: task.id, ready: missing.length === 0, waitingFor: missing,
        score: task.priority * 10 + downstream * 3 + (missing.length ? -100 : 20),
        reason: missing.length ? `Waiting for ${missing.length} prerequisite(s)` : `Ready now; unlocks ${downstream} downstream task(s)` };
    }).sort((a, b) => b.score - a.score);
}

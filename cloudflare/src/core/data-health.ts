import type { Env } from "../types";

function number(value: unknown) { return Number(value || 0); }

async function count(env: Env, sql: string, ...bind: unknown[]) {
  const row = await env.DB.prepare(sql).bind(...bind).first<{ count:number }>();
  return number(row?.count);
}

export async function dataHealth(env: Env) {
  const [
    assetsMissingR2Key,
    duplicateAssetR2Keys,
    orphanCollectionTerms,
    orphanCollectionCandidatesBatch,
    orphanCollectionCandidatesTerm,
    orphanWorkerItems,
    activeOrphanWorkerItems,
    orphanSupervisorDecisions,
    pendingOrphanSupervisorDecisions,
    orphanPolicyEvents,
    orphanSupervisorCandidates,
    actionableOrphanSupervisorCandidates,
    orphanPlanBranches,
    orphanSourcePlans,
    orphanV2Candidates,
    orphanV2Events,
    orphanV2Packages,
    orphanV2ProjectMedia,
    orphanV2ProjectTitles,
  ] = await Promise.all([
    count(env, "SELECT COUNT(*) AS count FROM assets WHERE r2_key IS NULL OR TRIM(r2_key)=''"),
    count(env, "SELECT COUNT(*) AS count FROM (SELECT r2_key FROM assets WHERE r2_key IS NOT NULL AND TRIM(r2_key)<>'' GROUP BY r2_key HAVING COUNT(*)>1)"),
    count(env, "SELECT COUNT(*) AS count FROM collection_terms t LEFT JOIN collection_batches b ON b.id=t.batch_id WHERE b.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM collection_candidates c LEFT JOIN collection_batches b ON b.id=c.batch_id WHERE b.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM collection_candidates c LEFT JOIN collection_terms t ON t.id=c.term_id WHERE c.term_id IS NOT NULL AND t.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM worker_work_items w LEFT JOIN automatic_project_items i ON i.id=w.item_id LEFT JOIN automatic_projects p ON p.id=w.project_id WHERE (w.item_id IS NOT NULL AND i.id IS NULL) OR (w.project_id IS NOT NULL AND p.id IS NULL)"),
    count(env, "SELECT COUNT(*) AS count FROM worker_work_items w LEFT JOIN automatic_project_items i ON i.id=w.item_id LEFT JOIN automatic_projects p ON p.id=w.project_id WHERE w.status IN ('READY','LEASED') AND ((w.item_id IS NOT NULL AND i.id IS NULL) OR (w.project_id IS NOT NULL AND p.id IS NULL))"),
    count(env, "SELECT COUNT(*) AS count FROM supervisor_decision_queue q LEFT JOIN automatic_project_items i ON i.id=q.item_id WHERE q.item_id IS NOT NULL AND i.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM supervisor_decision_queue q LEFT JOIN automatic_project_items i ON i.id=q.item_id WHERE q.state='PENDENTE' AND q.item_id IS NOT NULL AND i.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM operational_policy_events e LEFT JOIN automatic_project_items i ON i.id=e.item_id WHERE e.item_id IS NOT NULL AND i.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM supervisor_project_candidates c LEFT JOIN automatic_project_items i ON i.id=c.item_id WHERE c.item_id IS NOT NULL AND i.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM supervisor_project_candidates c LEFT JOIN automatic_project_items i ON i.id=c.item_id WHERE c.status IN ('PARA_ANALISE','PARA_QA_VISUAL') AND c.item_id IS NOT NULL AND i.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM plan_branches b LEFT JOIN automatic_project_items i ON i.id=b.item_id WHERE b.item_id IS NOT NULL AND i.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM source_routing_plans p LEFT JOIN automatic_project_items i ON i.id=p.item_id WHERE p.item_id IS NOT NULL AND i.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM v2_ingest_candidates c LEFT JOIN v2_ingest_operations o ON o.id=c.operation_id WHERE o.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM v2_ingest_events e LEFT JOIN v2_ingest_operations o ON o.id=e.operation_id WHERE o.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM v2_download_packages p LEFT JOIN automatic_projects a ON a.id=p.project_id WHERE a.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM v2_project_media m LEFT JOIN automatic_projects a ON a.id=m.project_id WHERE a.id IS NULL"),
    count(env, "SELECT COUNT(*) AS count FROM v2_project_titles t LEFT JOIN automatic_projects a ON a.id=t.project_id WHERE a.id IS NULL"),
  ]);

  const historical = {
    collectionTermsWithoutBatch: orphanCollectionTerms,
    collectionCandidatesWithoutBatch: orphanCollectionCandidatesBatch,
    collectionCandidatesWithoutTerm: orphanCollectionCandidatesTerm,
    workerItemsWithoutParent: orphanWorkerItems,
    supervisorDecisionsWithoutItem: orphanSupervisorDecisions,
    operationalPolicyEventsWithoutItem: orphanPolicyEvents,
    supervisorCandidatesWithoutItem: orphanSupervisorCandidates,
    planBranchesWithoutItem: orphanPlanBranches,
    sourceRoutingPlansWithoutItem: orphanSourcePlans,
  };
  const v2 = {
    candidatesWithoutOperation: orphanV2Candidates,
    eventsWithoutOperation: orphanV2Events,
    packagesWithoutProject: orphanV2Packages,
    projectMediaWithoutProject: orphanV2ProjectMedia,
    projectTitlesWithoutProject: orphanV2ProjectTitles,
  };
  const activeHistoricalRisk = {
    readyOrLeasedWorkerItemsWithoutParent: activeOrphanWorkerItems,
    pendingSupervisorDecisionsWithoutItem: pendingOrphanSupervisorDecisions,
    actionableSupervisorCandidatesWithoutItem: actionableOrphanSupervisorCandidates,
  };
  const v2Orphans = Object.values(v2).reduce((sum, value) => sum + number(value), 0);
  const activeHistoricalOrphans = Object.values(activeHistoricalRisk).reduce((sum, value) => sum + number(value), 0);

  return {
    ok: assetsMissingR2Key === 0 && v2Orphans === 0,
    catalog: { assetsMissingR2Key, duplicateAssetR2Keys },
    v2,
    v2Orphans,
    historical,
    activeHistoricalRisk,
    activeHistoricalOrphans,
    note: "Orfandades históricas são preservadas para auditoria. O dispatcher V2 ignora work_items sem parent válido em vez de apagá-los.",
    checkedAt: new Date().toISOString(),
  };
}

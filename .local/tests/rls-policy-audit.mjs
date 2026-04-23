// RLS POLICY AUDIT — re-runnable any time.
//
// Catches the v1.1.89 class of bug: an UPDATE (or ALL) policy that has a
// non-trivial USING clause but no WITH CHECK clause. Postgres silently
// reuses USING for the new-row check, which causes "new row violates
// row-level security policy" (error 42501) whenever the UPDATE changes
// a column referenced by USING — for example, forwarding a schedule to
// a different PC, reassigning a pilot, etc.
//
// Run: node .local/tests/rls-policy-audit.mjs
// Exit 0 if clean, 1 if any at-risk policy is found.

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = (process.env.SUPABASE_URL || "").match(/https:\/\/([^.]+)/)?.[1];
if (!TOKEN || !REF) { console.error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_URL"); process.exit(2); }

async function q(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`mgmt ${r.status}: ${await r.text()}`);
  return r.json();
}

// At-risk pattern:
//   - polcmd is 'w' (UPDATE) or '*' (ALL)
//   - polqual (USING) is non-null and non-trivial
//   - polwithcheck (WITH CHECK) is NULL
//   - USING is NOT a constant 'false' (those are intentional deny-all rules)
const rows = await q(`
  select n.nspname as schema, c.relname as "table", p.polname as policy,
         case p.polcmd when 'w' then 'UPDATE' when '*' then 'ALL' end as cmd,
         pg_get_expr(p.polqual, p.polrelid) as using_expr
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and p.polcmd in ('w','*')
    and p.polqual is not null
    and p.polwithcheck is null
    and pg_get_expr(p.polqual, p.polrelid) <> 'false'
  order by c.relname, p.polname;
`);

if (rows.length === 0) {
  console.log("\x1b[32mPASS — no at-risk RLS policies. All UPDATE/ALL policies either have explicit WITH CHECK or are deny-all.\x1b[0m");
  process.exit(0);
}

console.error("\x1b[31mFAIL — the following policies are missing WITH CHECK and could cause 'new row violates RLS' errors:\x1b[0m");
console.table(rows);
console.error("\nFix each one with a migration like:");
console.error(`  drop policy if exists <policy> on public.<table>;`);
console.error(`  create policy <policy> on public.<table>`);
console.error(`    for update to authenticated`);
console.error(`    using (<existing using>)`);
console.error(`    with check (true);   -- or a more specific predicate`);
process.exit(1);

import { Badge, Panel } from '@forest/ui';

const API = process.env.API_INTERNAL_URL ?? process.env.API_URL ?? 'http://localhost:4000';

async function readiness(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/ready`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Phase 0 shell: confirms the admin app boots and reaches the API. Real screens arrive in Phase 3. */
export default async function AdminHome() {
  const ready = await readiness();
  return (
    <main className="flex min-h-dvh gap-4 p-4">
      <nav
        aria-label="Asosiy menyu"
        className="hidden w-[248px] shrink-0 rounded-lg bg-ink p-5 text-white lg:block"
      >
        <div className="flex items-center justify-between">
          <span className="text-[28px] font-semibold tracking-[-0.04em]">forest</span>
          <Badge tone="sage">ADMIN</Badge>
        </div>
      </nav>
      <Panel className="flex flex-1 flex-col gap-3 p-8">
        <h1 className="text-[36px] font-medium tracking-[-0.035em]">Dashboard</h1>
        <p className="text-muted">
          API:{' '}
          <Badge tone={ready ? 'good' : 'critical'}>{ready ? 'ulangan' : 'javob bermayapti'}</Badge>
        </p>
      </Panel>
    </main>
  );
}

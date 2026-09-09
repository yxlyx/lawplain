import assert from 'node:assert/strict';
import test from 'node:test';
import { AskSession, SESSION_IDLE_MS, SESSION_RUN_MS } from '../src/server/ask-session.ts';

function fixture() {
 let now = 1_800_000_000_000;
 let state, alarm;
 let failure;
 let next = 0;
 const boxes = new Map(), requests = new Map(), deleted = [], created = [];
 const store = {
  get: async () => state && structuredClone(state),
  put: async value => { state = structuredClone(value); },
  alarm: async at => { alarm = at; },
 };
 const fleet = {
  async create(requestId) {
   if (failure?.create) throw failure.create;
   if (requests.has(requestId)) return requests.get(requestId);
   const id = `cnd_${String(++next).padStart(40,'0')}`;
   requests.set(requestId,id);
   boxes.set(id,{id,state:'running',expiresAt:now / 1000 + 1800});
   created.push(id);
   return id;
  },
  async get(id) {
   if(failure?.get) throw failure.get;
   if(!boxes.has(id)) throw Object.assign(new Error('gone'),{status:404});
   return {...boxes.get(id)};
  },
  async delete(id) {
   if(failure?.delete) throw failure.delete;
   deleted.push(id); boxes.set(id,{...boxes.get(id),state:'terminated'});
  },
 };
 const make = () => new AskSession(store,fleet,()=>now);
 return { make, fleet, boxes, created, deleted,
  get state(){return state}, get alarm(){return alarm}, get now(){return now},
  advance: ms => {now += ms}, fail: value => {failure=value},
 };
}
const owner='owner', thread='thread';

test('two follow-ups reuse one sandbox and keep the runtime installed',async()=>{
 const f=fixture(); const session=f.make();
 const first=await session.acquire(owner,thread,'turn-1');
 await session.release(owner,thread,'turn-1',first.sandboxId,true);
 assert.equal(f.alarm,f.now+SESSION_IDLE_MS);
 f.advance(5000);
 const second=await f.make().acquire(owner,thread,'turn-2');
 assert.equal(second.sandboxId,first.sandboxId);
 assert.equal(second.reused,true);
 assert.equal(second.runtimeReady,true);
 await session.release(owner,thread,'turn-2',second.sandboxId,true);
 const third=await session.acquire(owner,thread,'turn-3');
 assert.equal(third.sandboxId,first.sandboxId);
 assert.equal(f.created.length,1);
 assert.deepEqual(f.deleted,[]);
});

test('same-run reconnect is idempotent, another turn is rejected while active',async()=>{
 const f=fixture(),session=f.make();
 const first=await session.acquire(owner,thread,'turn-1');
 assert.equal((await f.make().acquire(owner,thread,'turn-1')).sandboxId,first.sandboxId);
 await assert.rejects(session.acquire(owner,thread,'turn-2'),e=>e.status===409);
 assert.equal(f.created.length,1);
});

test('late release and stale idle alarms cannot unlock or delete a newer run',async()=>{
 const f=fixture(),session=f.make();
 const box=await session.acquire(owner,thread,'turn-1');
 await session.release(owner,thread,'turn-1',box.sandboxId,true);
 f.advance(1000);
 await session.acquire(owner,thread,'turn-2');
 await session.release(owner,thread,'turn-1',box.sandboxId,true);
 await session.cleanup();
 assert.equal(f.state.activeRunId,'turn-2');
 assert.equal(f.alarm,f.now+SESSION_RUN_MS);
 assert.deepEqual(f.deleted,[]);
});

test('idle expiration destroys only the expired session and a later turn gets a new lease',async()=>{
 const f=fixture(),session=f.make();
 const first=await session.acquire(owner,thread,'turn-1');
 await session.release(owner,thread,'turn-1',first.sandboxId,true);
 f.advance(SESSION_IDLE_MS+1);
 await f.make().cleanup();
 assert.deepEqual(f.deleted,[first.sandboxId]);
 const second=await session.acquire(owner,thread,'turn-2');
 assert.notEqual(second.sandboxId,first.sandboxId);
 assert.equal(second.runtimeReady,false);
});

test('provider outage never creates a replacement or abandons the original identity',async()=>{
 const f=fixture(),session=f.make();
 const first=await session.acquire(owner,thread,'turn-1');
 await session.release(owner,thread,'turn-1',first.sandboxId,true);
 f.fail({get:Object.assign(new Error('temporary'),{status:503})});
 await assert.rejects(session.acquire(owner,thread,'turn-2'));
 assert.equal(f.state.sandboxId,first.sandboxId);
 assert.equal(f.created.length,1);
 assert.deepEqual(f.deleted,[]);
});

test('uncertain creation reuses the persisted request ID across a restart',async()=>{
 const f=fixture();
 const create=f.fleet.create.bind(f.fleet);
 let loseResponse=true;
 f.fleet.create=async request=>{
  const id=await create(request);
  if(loseResponse){loseResponse=false;throw new Error('connection lost after creation')}
  return id;
 };
 await assert.rejects(f.make().acquire(owner,thread,'turn-1'));
 const requestId=f.state.requestId;
 const lease=await f.make().acquire(owner,thread,'turn-1');
 assert.equal(f.state.requestId,requestId);
 assert.equal(lease.sandboxId,f.created[0]);
 assert.equal(f.created.length,1);
});

test('uncertain creation is recovered before watchdog cleanup, not abandoned',async()=>{
 const f=fixture(); const create=f.fleet.create.bind(f.fleet);let loseResponse=true;
 f.fleet.create=async request=>{const id=await create(request);if(loseResponse){loseResponse=false;throw new Error('lost')}return id};
 await assert.rejects(f.make().acquire(owner,thread,'turn-1'));
 f.advance(SESSION_RUN_MS+1);
 await f.make().cleanup();
 assert.equal(f.created.length,1);
 assert.deepEqual(f.deleted,f.created);
 assert.equal(f.state.sandboxId,undefined);
});

test('known capacity rejection does not lock the conversation or create during cleanup',async()=>{
 const f=fixture();f.fail({create:Object.assign(new Error('full'),{status:429})});
 await assert.rejects(f.make().acquire(owner,thread,'turn-1'));
 assert.equal(f.state.activeRunId,undefined);
 assert.equal(f.state.requestId,undefined);
 f.fail(undefined);f.advance(SESSION_RUN_MS+1);await f.make().cleanup();
 assert.equal(f.created.length,0);
 await f.make().acquire(owner,thread,'turn-2');
 assert.equal(f.created.length,1);
});

test('near-expired leases retire before a new turn and failures preserve the old identity',async()=>{
 const f=fixture(),session=f.make();
 const first=await session.acquire(owner,thread,'turn-1');
 await session.release(owner,thread,'turn-1',first.sandboxId,true);
 f.advance(14*60_000);
 await session.acquire(owner,thread,'turn-2');
 await session.release(owner,thread,'turn-2',first.sandboxId,true);
 f.advance(11*60_000);
 f.fail({delete:new Error('uncertain deletion')});
 await assert.rejects(session.acquire(owner,thread,'turn-3'));
 assert.equal(f.state.sandboxId,first.sandboxId);assert.equal(f.created.length,1);
 f.fail(undefined);
 const next=await session.acquire(owner,thread,'turn-3');
 assert.notEqual(next.sandboxId,first.sandboxId);
 assert.equal(f.created.length,2);
});

test('session ownership separates users and conversations; deletion cannot resurrect a session',async()=>{
 const f=fixture(),session=f.make();
 const box=await session.acquire(owner,thread,'turn-1');
 await assert.rejects(session.acquire('other',thread,'turn-1'),e=>e.status===404);
 await assert.rejects(session.acquire(owner,'other-thread','turn-1'),e=>e.status===404);
 await assert.rejects(session.dispose('other',thread),e=>e.status===404);
 assert.deepEqual(f.deleted,[]);
 await session.dispose(owner,thread);
 assert.deepEqual(f.deleted,[box.sandboxId]);
 await assert.rejects(session.acquire(owner,thread,'turn-2'),e=>e.status===410);
});

test('an interrupted run from the previous deployment is adopted without provisioning',async()=>{
 const f=fixture();const old=await f.fleet.create('previous-deployment');
 const lease=await f.make().acquire(owner,thread,'turn-1',old);
 assert.equal(lease.sandboxId,old);assert.equal(lease.reused,true);assert.equal(lease.runtimeReady,true);
 await f.make().release(owner,thread,'turn-1',old,true);
 assert.equal((await f.make().acquire(owner,thread,'turn-2')).sandboxId,old);
 assert.equal(f.created.length,1);assert.deepEqual(f.deleted,[]);
});

test('a dead active lease reports expiration instead of automatically spawning a replacement',async()=>{
 const f=fixture(),session=f.make();const lease=await session.acquire(owner,thread,'turn-1');
 f.boxes.get(lease.sandboxId).state='terminated';
 await assert.rejects(session.acquire(owner,thread,'turn-1'),e=>e.status===410);
 assert.equal(f.created.length,1);assert.equal(f.state.activeRunId,undefined);
 const next=await session.acquire(owner,thread,'turn-2');
 assert.notEqual(next.sandboxId,lease.sandboxId);assert.equal(f.created.length,2);
});

test('legacy retirement cannot destroy a session already handed to the next turn',async()=>{
 const f=fixture(),session=f.make();const lease=await session.acquire(owner,thread,'turn-1');
 await session.release(owner,thread,'turn-1',lease.sandboxId,true);
 await session.acquire(owner,thread,'turn-2');
 await session.retireRun(owner,thread,'turn-1',lease.sandboxId);
 assert.equal(f.state.activeRunId,'turn-2');assert.deepEqual(f.deleted,[]);
});

for (const status of [401, 403, 408, 429, 500, 502, 503, 504]) {
  test(`provider GET ${status} cannot multiply sandboxes`, async () => {
    const f = fixture();
    const lease = await f.make().acquire(owner, thread, "first");
    await f.make().release(owner, thread, "first", lease.sandboxId, true);
    f.fail({ get: Object.assign(new Error("provider failure"), { status }) });
    for (let n = 0; n < 20; n++)
      await assert.rejects(f.make().acquire(owner, thread, "retry"));
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.deleted, []);
    f.fail(undefined);
    assert.equal(
      (await f.make().acquire(owner, thread, "retry")).sandboxId,
      lease.sandboxId,
    );
  });
}

test("failed disposal remains closed and alarm retries cleanup", async () => {
  const f = fixture();
  await f.make().acquire(owner, thread, "first");
  f.fail({ delete: new Error("provider unavailable") });
  await assert.rejects(f.make().dispose(owner, thread));
  await assert.rejects(
    f.make().acquire(owner, thread, "second"),
    (e) => e.status === 410,
  );
  assert.equal(f.created.length, 1);
  f.fail(undefined);
  await f.make().cleanup();
  await f.make().cleanup();
  assert.deepEqual(f.deleted, f.created);
});

test("exact idle deadline retires the VM even if the alarm has not fired", async () => {
  const f = fixture();
  const first = await f.make().acquire(owner, thread, "first");
  await f.make().release(owner, thread, "first", first.sandboxId, true);
  f.advance(SESSION_IDLE_MS);
  const next = await f.make().acquire(owner, thread, "second");
  assert.notEqual(next.sandboxId, first.sandboxId);
  assert.deepEqual(f.deleted, [first.sandboxId]);
});

test("1000 rapid completed turns reuse one VM across session reconstruction", async () => {
  const f = fixture();
  let sid;
  for (let i = 0; i < 1000; i++) {
    const lease = await f.make().acquire(owner, thread, `turn-${i}`);
    sid ??= lease.sandboxId;
    assert.equal(lease.sandboxId, sid);
    await f.make().release(owner, thread, `turn-${i}`, sid, true);
    f.advance(100);
  }
  assert.equal(f.created.length, 1);
  assert.equal(f.deleted.length, 0);
});

test("200 seeded lifecycle sequences preserve ownership and bounded VM count (60000 actions)", async () => {
  for (let seed = 1; seed <= 200; seed++) {
    let rng = seed;
    const random = () => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng;
    };
    const f = fixture();
    const history = [];
    for (let step = 0; step < 300; step++) {
      const before = structuredClone(f.state);
      const createCount = f.created.length;
      const op = random() % 10;
      const active = before?.activeRunId;
      try {
        if (op < 3) {
          const run = op === 0 && active ? active : `${seed}-${step}`;
          if (
            active &&
            run !== active &&
            (before.activeUntil ?? Infinity) > f.now
          ) {
            await assert.rejects(
              f.make().acquire(owner, thread, run),
              (e) => e.status === 409,
            );
            assert.equal(f.created.length, createCount);
          } else {
            const lease = await f.make().acquire(owner, thread, run);
            history.push({ run, sid: lease.sandboxId });
          }
        } else if (op === 3 && active) {
          await f.make().release(owner, thread, active, before.sandboxId, true);
        } else if (op === 4) {
          await f.make().cleanup();
        } else if (op === 5) {
          f.advance(random() % 180001);
        } else if (op === 6 && history.length) {
          const old = history[random() % history.length];
          await f.make().release(owner, thread, old.run, old.sid, true);
          if (old.run !== active || old.sid !== before?.sandboxId)
            assert.deepEqual(f.state, before);
        } else if (op === 7 && before) {
          await assert.rejects(
            f.make().acquire("intruder", thread, "bad"),
            (e) => e.status === 404,
          );
        } else if (op === 8 && before?.sandboxId && !active) {
          f.fail({
            get: Object.assign(new Error("transient"), { status: 503 }),
          });
          // Only test provider lookup while the stored lease remains reusable.
          if (before.expiresAt - f.now >= 360000 && before.idleUntil > f.now) {
            await assert.rejects(f.make().acquire(owner, thread, "outage"));
            assert.equal(f.created.length, createCount);
          }
          f.fail(undefined);
        } else if (op === 9 && active) {
          const again = await f.make().acquire(owner, thread, active);
          assert.equal(again.sandboxId, before.sandboxId);
          assert.equal(f.created.length, createCount);
        }
        const live = [...f.boxes.values()].filter((b) => b.state === "running");
        assert.ok(
          live.length <= 1,
          `seed ${seed} step ${step}: multiple live VMs`,
        );
        if (f.state) {
          assert.equal(f.state.userId, owner);
          assert.equal(f.state.threadId, thread);
        }
      } catch (error) {
        throw new Error(`seed=${seed} step=${step} operation=${op}`, {
          cause: error,
        });
      }
    }
    await f.make().dispose(owner, thread);
    assert.equal(
      [...f.boxes.values()].filter((b) => b.state === "running").length,
      0,
    );
  }
});

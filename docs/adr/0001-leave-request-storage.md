# Store leave requests in the EmployeeLeave actor

Leave requests—including the caller's reason, date range, and approval status—are stored inside the per-employee `EmployeeLeave` actor, using `this.ctx.storage` with keys `requests`, `key/<requestKey>`, and `counters`.

Why an actor and not KV or the Edge Function itself:

1. **Race safety.** Two simultaneous `apply_leave` calls from the same employee must not both spend the last remaining days, and must not both claim non-overlapping dates that actually overlap. Only an actor guarantees single-threaded execution per entity, so the read-modify-write of balance + overlap check + append is safe without a lock.
2. **Entity ownership.** Each employee's data is naturally scoped to that employee. The actor's instance name is the HMAC of the employee number, so no two employees share state.
3. **KV is the wrong primitive.** Telnyx KV is designed for cache, session flags, and read-heavy config. The challenge's own guidance says "Don't use a Stateful Actor where a KV value suffices"—which implies the converse: do use an actor where KV is insufficient. Leave data is write-heavy, transactional, and must not race.

Refs:
- TDD §8.2: EmployeeLeave actor schema (`requests`, `key/<requestKey>`, `counters`).
- TDD §3.1: "Anything two writers can race on → actor."
- Code Challenge §4c: "At least one actor is required... single-threaded per-entity state for a safe read-modify-write."
- Wiki `edge-primitive-selection`: "Can two writers race on it? If yes, use an actor."

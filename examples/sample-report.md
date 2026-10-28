# Project review: sample-angular

Scope: bounded area. Review status: completed.

## Files read

- src/app/orders/orders.store.ts
- src/app/orders/orders.service.ts

## Issues

### MEDIUM: src/app/orders/orders.store.ts:10-10

**Problem:** The subscription may remain active after its owner is destroyed.

**Why:** The service stream remains open, and the subscription has no explicit termination.

**Suggestion:** Tie the subscription to the owner's lifecycle.

## Limitations

- Scope: a selected project area; this is not a full repository audit.

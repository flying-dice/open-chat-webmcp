# Chaos taxonomy — provocations and examples

Read this to go deep on a category. The goal is exhaustion: keep generating until you've genuinely run
out of plausible failure modes, not after the first obvious one.

## Provocations per category

**Invalid input** — numeric field gets letters; date gets `2026-13-45`; email gets `not-an-email`;
leading/trailing whitespace; mixed case; scientific notation (`1e3`); enum value outside the enum.

**Boundaries** — zero, one, max, max+1, min, min−1; empty vs one vs max-size collection; first and last
valid date; the exact day something expires (inclusive or exclusive?).

**Missing data** — each required field omitted one at a time; nested object present but children null;
empty array where one item expected; whitespace-only string passing a naive "is present" check.

**Auth** — anonymous user on an authenticated route; valid login but insufficient role/scope; user A
acting on user B's resource (horizontal privilege); token expired mid-session; token valid but revoked.

**State & order** — perform step 3 before step 2; act on a deleted/cancelled/archived/completed entity;
re-submit after success; back-button replay of a one-time action.

**Duplicates** — same create request twice (two records?); duplicate unique key (same email/SKU);
re-run a job that already completed.

**Concurrency** — two actors editing one record (whose write wins, is the loser told?); two buyers take
the last unit at once; a read between two writes sees an inconsistent intermediate state.

**Dependencies** — downstream returns 500/503/429; downstream times out (slow, not failing); downstream
200s with malformed/partial/empty body; downstream unreachable (DNS / connection refused).

**Limits** — rate limit/throttle hit; quota or plan limit exceeded (seats, storage); payload over the
max; request a page beyond the last.

**Time** — expiry exactly at the boundary second; user in UTC+13 vs UTC−10 acting "today"; DST
transition day; leap day (Feb 29); end-of-month rollover; client/server clock skew.

**Encoding** — accents, CJK, emoji, RTL scripts; very long strings (10k-char name); locale decimal
separators (`1.234,56`) and date orders (`DD/MM` vs `MM/DD`).

**Partial failure** — network drops after request sent but before response read; multi-step transaction
where step 2 of 3 fails (is step 1 rolled back?); payment captured but order fails to save (money taken,
nothing ordered).

## Worked examples

Invalid input (a `Scenario Outline` captures a whole family at once):

```gherkin
@chaos
Scenario Outline: Registration rejects malformed email addresses
  When I register with the email "<email>"
  Then registration should be rejected
  And I should see the error "enter a valid email address"

  Examples:
    | email           |
    | plainaddress    |
    | @no-local.com   |
    | spaces in@x.com |
    | missing-tld@x   |
```

Auth / horizontal privilege:

```gherkin
@chaos
Scenario: A user cannot view another user's order
  Given I am logged in as "alice"
  And "bob" has an order "ORD-77"
  When I request order "ORD-77"
  Then the request should be denied
  And I should not see Bob's order details
```

Dependency failure (assert graceful handling, not just the error):

```gherkin
@chaos
Scenario: Checkout fails gracefully when the payment provider times out
  Given my cart total is 49.99
  And the payment provider is not responding
  When I attempt to pay
  Then I should see "payment could not be processed, please try again"
  And no order should be created
  And I should not be charged
```

Concurrency:

```gherkin
@chaos
Scenario: The last item in stock cannot be sold twice
  Given product "WIDGET" has 1 item in stock
  When "alice" and "bob" check out "WIDGET" at the same time
  Then exactly one checkout should succeed
  And the other should see "out of stock"
  And stock for "WIDGET" should be 0
```

Time / expiry boundary:

```gherkin
@chaos
Scenario Outline: Coupon validity at the expiry boundary
  Given a coupon that expires at "2026-06-30T23:59:59Z"
  When I apply it at "<now>"
  Then the coupon should be <result>

  Examples:
    | now                  | result   |
    | 2026-06-30T23:59:59Z | accepted |
    | 2026-07-01T00:00:00Z | rejected |
```

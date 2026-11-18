# Error_Case

Failures that were hard to diagnose, written down so the next person does not
have to diagnose them twice.

**Not a changelog, and not a list of every bug.** A case earns a file here when
the failure was *expensive to understand* — when the error message pointed
somewhere other than the cause, when the same claim worked by hand, when the fix
turned out to be a header rather than the data. What is worth keeping is the
elimination: what it was NOT, and how that was established.

```
Error_Case/<Platform><Automation>/<what-it-looked-like>.txt
```

## What a case file holds

1. **What it looks like** — the exact message, verbatim, so it can be searched for.
2. **What it is NOT** — every explanation that was ruled out, and how. This is
   the most valuable section and the one most often left out: it is what stops
   the next person re-walking a path that already ended nowhere.
3. **The cause.**
4. **The fix**, with the files.
5. **How to confirm it is really fixed** — honestly, including when it has not
   been proven against the live marketplace.
6. **How to recognise the class of failure next time.**

## Never put a live session in one of these

Diagnosing a marketplace failure usually means capturing a real request, and
that cURL carries cookies, tokens and a signed-in seller. Read it, use it,
discard it. Describe the *shape* — "a base64-ish token, the same string as the
`browser_id` cookie" — never the value. Nothing in this directory should be
anything an attacker could sign in with.

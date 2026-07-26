# Pipedrive bypass launch operations

## Keep bypass live

Set the production environment explicitly and restart or redeploy the backend:

```dotenv
PIPEDRIVE_BYPASS_ENABLED=true
PIPEDRIVE_BYPASS_EMAIL_TO=berg@lippelift.de,caechma@gmail.com
```

Confirm `/api/health` reports `"pipedriveBypass": true` and
`"bypassRecipientCount": 2`. The health response intentionally exposes only the
mode and recipient count.

The complete Pipedrive workflow can continue to run in development or a separate
environment with `PIPEDRIVE_BYPASS_ENABLED=false`.

## Return to full routing

Set:

```dotenv
PIPEDRIVE_BYPASS_ENABLED=false
```

Restart or redeploy, confirm the health response reports bypass disabled, and run
one labeled, non-destructive full-routing smoke test before announcing the
change.

The flag affects new requests. A request that already has a durable
`crm_bypassed` or `crm` journal checkpoint remains pinned to that mode when it is
retried; do not replay checkpointed requests automatically through the other
mode.

## Emergency fallback

If bypass email delivery fails, disable the public chat handoff or show a
temporary contact message until SMTP delivery is restored. Do not fall back
automatically to Pipedrive reads or writes.

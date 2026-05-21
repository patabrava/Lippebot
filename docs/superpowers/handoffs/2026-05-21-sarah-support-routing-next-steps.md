# Sarah Support Routing - Next Steps

Status:
- Support routing, deterministic Pipedrive matching, compact notes, and the chatbot orchestration are implemented and verified.
- Live chat support handoffs now create a compact Pipedrive person note and keep the browser SSE payload sanitized.
- The current backend runtime still reports `email:false`, so the support email to `caechma@gmail.com` cannot be verified until SMTP is configured in the deployment environment.

Next steps:
1. Add SMTP configuration to the backend deployment environment.
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SERVICE_EMAIL_TO=caechma@gmail.com`
2. Restart or redeploy the live Hostinger project so it picks up the new environment variables.
3. Verify `/api/health` returns `email:true`.
4. Run one live support conversation for an existing Pipedrive customer and confirm:
   - one compact note is written to the matched Pipedrive person
   - no deal or activity is created for the support handoff
   - the support summary email is sent to `caechma@gmail.com`
   - the customer-facing SSE stays free of CRM/internal routing details
5. Optionally clean up any clearly labeled test Pipedrive records after the final verification pass.

Verification already completed:
- Full backend test suite: 69/69 passed
- TypeScript build: passed
- Local live support smoke: passed for chat and Pipedrive note creation
- Live support email delivery: pending SMTP configuration

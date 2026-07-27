# Lippebot deployment handoff

Date: 2026-07-26

## Current state

The Hostinger portion is complete.

- `lippebot-demo` is running on VPS `187.124.16.6`.
- Traefik routes `chat.lippelift.xyz` to the `sarah-web` container on port `8080`.
- The route works when DNS is overridden locally:
  - `/api/health` returns HTTP 200.
  - `/sarah-widget.min.js` returns HTTP 200.
- Backend CORS allows `https://www.lippelift.de`.
- The persistent deployment configuration is on `main` in commit `2d9af66`.
- The existing application at `https://lippelift.xyz` is unchanged.

The remaining work is DNS configuration in Spaceship, followed by Webflow
installation and production verification.

## 1. Spaceship: create the chatbot DNS record

`lippelift.xyz` uses these authoritative nameservers:

```text
launch1.spaceship.net
launch2.spaceship.net
```

Therefore, the record must be created in Spaceship rather than Hostinger.

1. Sign in to Spaceship.
2. Open the DNS records for `lippelift.xyz`.
3. Confirm there is no existing `A`, `AAAA`, or `CNAME` record named `chat`.
4. Add:

   ```text
   Type: A
   Host/Name: chat
   Value: 187.124.16.6
   TTL: Automatic or the provider default
   ```

5. Do not change the root (`@`), `www`, MX, SPF, DKIM, DMARC, or nameserver
   records.
6. Wait for the record to resolve:

   ```bash
   dig +short A chat.lippelift.xyz
   ```

   Expected:

   ```text
   187.124.16.6
   ```

7. Traefik should then request a Let's Encrypt certificate automatically.
   Verify:

   ```bash
   curl --fail --silent --show-error https://chat.lippelift.xyz/api/health
   curl --fail --silent --show-error --head \
     https://chat.lippelift.xyz/sarah-widget.min.js
   ```

   Both requests must return HTTP 200 without `-k` or another TLS bypass.

8. Confirm the certificate contains `chat.lippelift.xyz`:

   ```bash
   openssl s_client \
     -connect chat.lippelift.xyz:443 \
     -servername chat.lippelift.xyz </dev/null 2>/dev/null |
     openssl x509 -noout -subject -issuer -dates -ext subjectAltName
   ```

If certificate issuance does not start after DNS resolves, inspect the
`lippebot-demo` and Traefik logs in Hostinger. Do not recreate or replace the
working root-domain router.

## 2. Webflow: install Sarah through the API

### Required access

Webflow Custom Code API endpoints require an OAuth token from a Webflow Data
Client App. A normal Site API token or Workspace token is insufficient.

Required scopes:

```text
sites:read
sites:write
custom_code:read
custom_code:write
```

Required identifiers:

- Webflow site ID for `lippelift.de`
- Custom-domain ID for `www.lippelift.de`
- OAuth access token with the scopes above

Keep the token in a secret manager or environment variable. Do not commit it.

### Register the hosted widget

Do this only after the public HTTPS widget URL works.

1. Download the final widget and calculate its SRI hash:

   ```bash
   curl --fail --silent --show-error \
     https://chat.lippelift.xyz/sarah-widget.min.js \
     -o /tmp/sarah-widget.min.js

   openssl dgst -sha384 -binary /tmp/sarah-widget.min.js |
     openssl base64 -A
   ```

2. Register the hosted script:

   ```http
   POST https://api.webflow.com/v2/sites/{site_id}/registered_scripts/hosted
   Authorization: Bearer {oauth_token}
   Content-Type: application/json
   ```

   Example body:

   ```json
   {
     "hostedLocation": "https://chat.lippelift.xyz/sarah-widget.min.js",
     "integrityHash": "sha384-{base64_hash}",
     "version": "1.0.0",
     "displayName": "Sarah Chatbot",
     "canCopy": false
   }
   ```

3. Save the returned script `id` and `version`.

Webflow script versions are immutable. If `1.0.0` is already registered, use a
new semantic version rather than attempting to overwrite it.

### Apply the widget site-wide

1. Read the currently applied site scripts:

   ```http
   GET https://api.webflow.com/v2/sites/{site_id}/custom_code
   ```

2. Preserve every existing script that must remain active. The upsert request
   represents the full desired list for scripts managed through this endpoint.
3. Add Sarah in the footer:

   ```json
   {
     "id": "{registered_script_id}",
     "location": "footer",
     "version": "1.0.0",
     "attributes": {
       "data-api-url": "https://chat.lippelift.xyz",
       "defer": "true"
     }
   }
   ```

4. Apply the complete list:

   ```http
   PUT https://api.webflow.com/v2/sites/{site_id}/custom_code
   Authorization: Bearer {oauth_token}
   Content-Type: application/json
   ```

5. Read the site custom code again and confirm Sarah appears exactly once with
   the expected location, version, and attributes.

### Publish Webflow

Publish to the production custom domain:

```http
POST https://api.webflow.com/v2/sites/{site_id}/publish
Authorization: Bearer {oauth_token}
Content-Type: application/json
```

Example body:

```json
{
  "customDomains": ["{www_lippelift_de_domain_id}"],
  "publishToWebflowSubdomain": false
}
```

Webflow limits successful publish requests to one per minute. Wait for the
publish to finish before testing the site.

### Manual Webflow fallback

If the available token is not an OAuth App token with Custom Code access, add
this to Webflow's site-wide Footer Custom Code and publish:

```html
<script
  src="https://chat.lippelift.xyz/sarah-widget.min.js"
  data-api-url="https://chat.lippelift.xyz"
  defer>
</script>
```

## 3. Production verification

1. Open `https://www.lippelift.de` in a private browser window.
2. Confirm the Sarah launcher appears once and does not obscure navigation,
   cookie controls, or important mobile content.
3. Open and close the widget.
4. Send a harmless test message that does not complete a lead or service
   request.
5. Confirm responses stream normally.
6. In browser developer tools, verify:
   - the widget script loads from `https://chat.lippelift.xyz`;
   - `/api/chat` is requested over HTTPS;
   - there are no mixed-content, CORS, CSP, SRI, or JavaScript errors.
7. Test desktop and mobile layouts.
8. Recheck:

   ```bash
   curl --fail --silent --show-error \
     -H 'Origin: https://www.lippelift.de' \
     -D - -o /dev/null \
     https://chat.lippelift.xyz/api/health
   ```

   The response must include:

   ```text
   access-control-allow-origin: https://www.lippelift.de
   ```

## Rollback

If the widget causes a production problem:

1. Remove Sarah from the Webflow site custom-code list, preserving other
   scripts, and republish.
2. Alternatively, remove the manual Footer Custom Code and republish.
3. Leave the Hostinger application and DNS record in place while diagnosing;
   they do not affect `lippelift.xyz` without the Webflow embed.

Do not delete the Spaceship DNS record or Hostinger router unless the deployment
is being permanently retired.

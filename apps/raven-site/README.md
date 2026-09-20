# raven-site — Launch Console v1

Static, dependency-free single page. `index.html` is BUILT from
`index.template.html` + `evidence/*.compact.json` (real signed verdicts
captured from the live hosted verifier):

    node -e "$(cat build.js)"   # or: node build.js

Deploy: point Vercel at `apps/raven-site` (output = this directory, no build
step required since index.html is committed). The evidence JSONs are unedited
verifier responses; refresh them by re-running the capture against
https://raven-hosted-verifier.onrender.com with a valid key.

Access intake: `api/request-access.js` is a zero-config Node function. Set
`RAVEN_INTAKE_WEBHOOK_URL` (Vercel env, **never committed**) to the private
operator destination; the function POSTs each validated submission there and
returns a deterministic `RA-xxxxxxxxxx` reference only after delivery. With
the variable unset it answers 503 and the form falls back to email — it never
claims success without delivery, and it refuses secret-looking input (422).

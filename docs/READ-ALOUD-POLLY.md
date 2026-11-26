# Read Aloud with Amazon Polly (built, switched OFF)

Code: `ai-notetaker-backend/src/services/pollySpeech.js`. Database: `scripts/paid-speech-usage-2026-11-26.sql`.

## What it does when on
- `POST /api/tts/generate` picks a Polly voice from the note's language (22 languages). Russian, Romanian and Icelandic use standard voices, the rest neural.
- Everything else uses the own speech worker as before: other languages (Bengali among them), text too short to identify, the unchanged welcome note, `/api/tts/synthesize`, podcasts, any Polly error, the cap.
- Cap: USD 50 per calendar month (UTC) at list price (neural $16, standard $4 per million characters), free tier ignored, reserved in the database before a request is sent. `POLLY_MONTHLY_CAP_USD` can lower it, nothing can raise it. If the ledger cannot be written to, Polly is not used.
- Audio already saved for a note is reused; it is not made again with Polly.

## Switching it on (owner)

1. In the AWS account that should pay, create a user that can do nothing but synthesize speech:

```bash
cat > /tmp/scribeai-polly-policy.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Action": "polly:SynthesizeSpeech", "Resource": "*" } ] }
EOF
aws iam create-policy --policy-name scribeai-polly-synthesize --policy-document file:///tmp/scribeai-polly-policy.json
aws iam create-user --user-name scribeai-polly
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws iam attach-user-policy --user-name scribeai-polly --policy-arn arn:aws:iam::$ACCOUNT:policy/scribeai-polly-synthesize
aws iam create-access-key --user-name scribeai-polly
```

2. Add four NEW Fly secrets (the app's existing `AWS_*` secrets stay untouched and are never used for speech). `import` keeps the values out of the shell history: run it, paste the lines with each `...` replaced by the matching value from step 1 (AccessKeyId, SecretAccessKey), press Ctrl-D. This restarts the machines, so do it when no Read Aloud or transcription is running.

```bash
flyctl secrets import -a ai-notetaker-backend
POLLY_ACCESS_KEY_ID=...
POLLY_SECRET_ACCESS_KEY=...
POLLY_REGION=us-east-1
TTS_POLLY_ENABLED=true
```

3. Recommended: a USD 50 monthly budget alert for Amazon Polly in AWS Billing, as a second check outside this code.

4. Check: play Read Aloud on a non-English note that has no saved audio, then
`select engine, language, characters, cost_usd, status from paid_speech_usage order by id desc limit 5;`

Switch off again: `flyctl secrets set TTS_POLLY_ENABLED=false -a ai-notetaker-backend`.

Not tested: any real Polly request (no key was used). Voice names come from the AWS voice list read on 2026-11-26.

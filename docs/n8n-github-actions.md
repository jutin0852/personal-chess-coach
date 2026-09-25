# n8n Cloud → GitHub Actions

The online workflow is:

```text
n8n Schedule Trigger
  → GitHub workflow dispatch
  → GitHub Actions runner
  → npm run coach-cycle
  → Supabase
```

In n8n, use an HTTP Request node with:

- Method: `POST`
- URL: `https://api.github.com/repos/<OWNER>/<REPO>/actions/workflows/chess-coach.yml/dispatches`
- Headers: `Accept: application/vnd.github+json`, `Authorization: Bearer <GitHub token>`, `X-GitHub-Api-Version: 2022-11-28`
- JSON body: `{ "ref": "master" }`

The GitHub token needs the minimum repository Actions/workflow permission required by the target repository. Keep it in an n8n credential, not in the workflow or request body.

The repository must contain the workflow and the three GitHub repository secrets documented in the main README. The workflow has concurrency protection so two scheduled runs cannot analyze the same next game simultaneously.

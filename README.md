# Job Agent

A personal job-search assistant that:
- evaluates job fit
- tailors resume content
- drafts cover letters
- prepares application answers
- optionally fills applications in the browser

## First steps
1. Copy .env.example to .env
2. Add your OpenAI API key
3. Run: npm run init:project
4. Put your source files into data/

## Local model support (Ollama)

You can run cost-sensitive agents locally using [Ollama](https://ollama.com) with any compatible model (e.g. `deepseek-r1`):
```bash
# Start Ollama and pull the model
ollama pull deepseek-r1
```

Then in your `.env`:
```
JOB_AGENT_LOCAL_MODEL=deepseek-r1
JOB_AGENT_USE_LOCAL=fit,answers
```

**Default routing:**
- `fit` and `answers` → local (fast, structured, lower quality tolerance)
- `tailor` and `cover` → OpenAI (quality-sensitive, complex prompts)

Override by setting `JOB_AGENT_USE_LOCAL=all` to run everything locally, or any comma-separated subset: `fit,answers,cover`.

Ollama must be running at `http://localhost:11434` (the default). Override with `JOB_AGENT_OLLAMA_BASE_URL` if needed.

## Resume strategy
Use one source-of-truth resume plus three baseline resumes:

- `data/resumes/master_resume.md` for all factual source material
- `data/resumes/resume-product-manager.md` for PM roles
- `data/resumes/resume-sales-engineer.md` for sales engineer / solutions roles
- `data/resumes/resume-technical-platform.md` for API / platform / integration roles
- `data/resumes/resume-solutions-architect-media.md` for solutions architect / media workflows roles

The master resume is for fact checking and full experience coverage.
The baseline resume is the starting point for wording, ordering, and emphasis.

## LinkedIn scout workflow

Add these to `.env` before running the scout agent:
```bash
LINKEDIN_EMAIL=you@example.com
LINKEDIN_PASSWORD=your-password

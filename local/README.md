# local/ — research and experiment sandbox

`local/` is the workspace for research, spikes, prototypes, throwaway scripts,
samples, and findings. Work here can be rough; it can also contain serious
conclusions that are not ready for the repo.

Everything under this folder is gitignored **except this README**, which is
tracked so a fresh clone explains what the folder is for. Never commit any
other file from here, and never move a file into the repo without asking.

`MEMORY.md`, if present, is personal to this checkout. It is gitignored too;
do not rely on it existing on another machine.

## Before you start

1. Read the folder index below.
2. Look for an existing folder whose purpose fits. Search by purpose, not by
   exact name; a broader folder with a new subfolder is usually better than a
   near-duplicate.
3. If nothing fits and the work is more than a single disposable file, create a
   lowercase kebab-case topic folder and add it to the index in the same
   change.
4. Keep the root of `local/` for this README and genuinely cross-topic files.
   One-off scripts, outputs, and data belong in a topic folder.

## Outputs

- The deliverable is HTML — `index.html`, `report.html`, or a similarly named
  entry page. Markdown is fine for source notes, pasted material, and a folder
  `README.md`, but do not leave an HTML-first result as Markdown only.
- Each serious folder has a `README.md` with: what it is for, its status and
  date, the entry HTML, and how to reproduce or regenerate the output.
- Keep generated outputs with their source when practical. If a result cannot
  be reproduced, say so in the folder README.
- Use `tmp/` for disposable files; use a topic folder for anything worth
  finding again.
- Name sample images descriptively (`cafe-clean-01.jpg`,
  `takeaway-lowlight-01.jpg`). Keep at least one clean and one difficult menu
  in `samples/menus/` for extraction tests (PLAN.md Phase 3).

## Folder index

| Folder | Use for |
| --- | --- |
| `ab/` | provider A/B extraction harness, fixtures and results |
| `ai-assistant-rnd/` | AI assistant scope, spike and implementation draft |
| `crawler/` | menu-sample downloader and collected samples |
| `email-prototype/` | email template prototype |
| `gate-logs/` | lint/typecheck/test/build logs from earlier steps |
| `issues/` | the local issue log; see `issues/README.md` |
| `logo-concepts/` | logo exploration and exports |
| `notes/` | working notes that do not belong in repo docs |
| `performance/` | performance experiments and results |
| `prototype/` | interactive prototypes |
| `research/` | research reports, including `research/staff-access/` |
| `samples/` | menu images and manual test samples |
| `scratch/` | throwaway experiments and repro files |
| `study/` | UI study captures |
| `theme-studio/` | local theme tooling and backups |
| `tmp/` | disposable files |
| `worktrees/` | local git worktrees |

Add a row when you add a folder. Keep the table current rather than letting
folders become anonymous.

## Serious findings

A finding may live here while it is raw. If it changes product scope,
architecture, security, pricing, or a roadmap decision, also promote a
sanitized summary into the tracked repo docs or the issue log. This folder is
not durable team memory: it is gitignored and will not exist in a fresh clone.

If another agent or a fresh clone would need the result, it belongs in the
repo in a proper place — not only here.

## Cleanup

- Mark superseded work in the folder README instead of silently deleting the
  evidence.
- Keep one clear entry point per folder. Archive old snapshots in a subfolder
  if they still matter.
